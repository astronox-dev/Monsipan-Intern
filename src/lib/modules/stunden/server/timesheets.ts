/**
 * Stundenzettel: lesen, anlegen, speichern, freigeben, prüfen.
 *
 * Wer was darf, hängt an zwei Dingen: dem Recht (stunden.*) und der Partie.
 * Sehen hat drei Stufen: nur den eigenen Zettel (stunden.eigene.sehen), die
 * eigene Partie (stunden.sehen) oder alle (stunden.alle.sehen). Bearbeiten gilt
 * für die eigene Partie oder alle. Wer „Keine Stundenzettel" hat (etwa ein
 * Admin-Konto), fehlt in der Wochenliste – außer es gibt für diese Woche schon
 * einen Zettel.
 *
 * Aushilfe: War ein Arbeiter diese Woche mehr Tage bei einer anderen Partie,
 * übernimmt deren Partieführer die Woche und schreibt den ganzen Zettel
 * (writingPartyId). Die eigene Partie sieht ihn dann nur noch.
 */
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { can, PARTY_ROLES, type Role } from '$lib/permissions';
import { db, type Tx } from '$lib/server/db';
import { col } from '$lib/server/db/sql';
import { parties, timesheetDays, timesheets, users } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import type { InkPages } from '$lib/ink';
import { mondayOf, monthsOfWeek, normalizeRanges, parseHours, weekDaysInMonth, type TimeRange, type WEEKDAY_LABELS } from '../week';

/** Darf andere Partien sehen – wer andere bearbeiten darf, darf sie auch sehen */
const seesAll = (user: SessionUser) => can(user.role, 'stunden.alle.sehen') || can(user.role, 'stunden.alle.bearbeiten');
const editsAll = (user: SessionUser) => can(user.role, 'stunden.alle.bearbeiten');
const samePartyAs = (user: SessionUser, partyId: number | null | undefined) => !!user.partyId && user.partyId === partyId;
/** Darf die Zettel der eigenen Partie sehen */
const seesParty = (user: SessionUser) => !!user.partyId && can(user.role, 'stunden.sehen');
/** Darf den eigenen Zettel sehen – jede höhere Stufe schließt das ein */
const seesOwn = (user: SessionUser) => can(user.role, 'stunden.eigene.sehen') || can(user.role, 'stunden.sehen') || seesAll(user);

/** Die Partie, die den Zettel schreibt: bei Aushilfe die übernehmende, sonst die eigene */
export const writerParty = (sheet: { partyId: number | null; writingPartyId?: number | null }) => sheet.writingPartyId ?? sheet.partyId;

export type { WEEKDAY_LABELS };

export interface Staff {
	id: number;
	firstName: string;
	lastName: string;
	username: string;
	role: Role;
	partyId: number | null;
	partyName: string | null;
	timesheetExempt: boolean;
}

const activeUser = and(eq(users.active, true), isNull(users.deletedAt));

const staffFields = {
	id: users.id,
	firstName: users.firstName,
	lastName: users.lastName,
	username: users.username,
	role: users.role,
	partyId: users.partyId,
	partyName: parties.name,
	timesheetExempt: users.timesheetExempt
};

/** Partie, die bei Aushilfe den Zettel schreibt */
const writer = alias(parties, 'writer');

/** Mitarbeiter, deren Zettel diese Person sehen darf */
export async function staffFor(user: SessionUser): Promise<Staff[]> {
	const base = db.select(staffFields).from(users).leftJoin(parties, eq(parties.id, users.partyId));

	if (seesAll(user)) {
		return base.where(activeUser).orderBy(asc(users.lastName), asc(users.firstName)).all();
	}
	if (seesParty(user)) {
		return base
			.where(and(activeUser, eq(users.partyId, user.partyId!)))
			.orderBy(asc(users.lastName), asc(users.firstName))
			.all();
	}
	return seesOwn(user) ? base.where(eq(users.id, user.id)).all() : [];
}

export interface WeekRow {
	user: Staff;
	/** Bei Aushilfe: die Partie, die diese Woche schreibt */
	writingPartyId: number | null;
	writingPartyName: string | null;
	/** Monat dieses Teils als "JJJJ-MM" – über den Monatswechsel gibt es zwei Zeilen */
	month: string;
	sheetId: number | null;
	status: 'entwurf' | 'freigegeben' | 'geprueft' | null;
	total: number;
	allowanceDays: number | null;
}

/**
 * Übersicht einer Woche: je Mitarbeiter ein Eintrag pro Monat, in den die Woche fällt.
 * Dazu kommen Aushilfen, die die eigene Partie diese Woche übernommen hat.
 */
export async function weekOverview(user: SessionUser, weekStart: string): Promise<WeekRow[]> {
	const staff = await staffFor(user);
	// Aushilfen, die die eigene Partie schreibt – nur für die, die ihre Partie sehen
	if (seesParty(user)) {
		const borrowed = await db
			.selectDistinct(staffFields)
			.from(timesheets)
			.innerJoin(users, eq(users.id, timesheets.userId))
			.leftJoin(parties, eq(parties.id, users.partyId))
			.where(and(eq(timesheets.weekStart, weekStart), eq(timesheets.writingPartyId, user.partyId!)))
			.all();
		for (const b of borrowed) if (!staff.some((s) => s.id === b.id)) staff.push(b);
	}
	if (!staff.length) return [];
	const ids = staff.map((s) => s.id);
	const sheets = await db
		.select({
			id: timesheets.id,
			userId: timesheets.userId,
			month: timesheets.month,
			status: timesheets.status,
			allowanceDays: timesheets.allowanceDays,
			writingPartyId: timesheets.writingPartyId,
			writingPartyName: writer.name,
			// Spalten mit Tabellennamen: in der Unterabfrage zeigt ein nacktes "id" sonst auf timesheet_days
			total: sql<number>`coalesce((
				select sum(${col(timesheetDays.normalHours)} + ${col(timesheetDays.overtime50)} + ${col(timesheetDays.overtime100)}
					+ ${col(timesheetDays.vacationHours)} + ${col(timesheetDays.holidayHours)} + ${col(timesheetDays.rainHours)}
					+ ${col(timesheetDays.sickHours)})
				from ${timesheetDays} where ${col(timesheetDays.timesheetId)} = ${col(timesheets.id)}), 0)`
		})
		.from(timesheets)
		.leftJoin(writer, eq(writer.id, timesheets.writingPartyId))
		.where(and(eq(timesheets.weekStart, weekStart), inArray(timesheets.userId, ids)))
		.all();

	const rows: WeekRow[] = [];
	for (const s of staff) {
		for (const month of monthsOfWeek(weekStart)) {
			const sheet = sheets.find((x) => x.userId === s.id && x.month === month);
			// Ausgenommene nur zeigen, wenn es schon einen Zettel gibt – sonst gingen die Stunden verloren
			if (s.timesheetExempt && !sheet) continue;
			rows.push({
				user: s,
				writingPartyId: sheet?.writingPartyId ?? null,
				writingPartyName: sheet?.writingPartyName ?? null,
				month,
				sheetId: sheet?.id ?? null,
				status: sheet?.status ?? null,
				total: Number(sheet?.total ?? 0),
				allowanceDays: sheet?.allowanceDays ?? null
			});
		}
	}
	return rows;
}

/**
 * Zettel eines Monatsteils samt Tagen; legt ihn an, wenn es ihn noch nicht gibt.
 * Angelegt werden nur die Tage der Woche, die in diesen Monat fallen.
 */
export async function openSheet(
	userId: number,
	weekStart: string,
	month: string,
	createdBy: number,
	writingPartyId: number | null = null
): Promise<number> {
	const monday = mondayOf(weekStart);
	const existing = await db
		.select({ id: timesheets.id })
		.from(timesheets)
		.where(and(eq(timesheets.userId, userId), eq(timesheets.weekStart, monday), eq(timesheets.month, month)))
		.get();
	if (existing) return existing.id;

	return db.transaction(async (tx) => {
		const row = await tx
			.insert(timesheets)
			.values({ userId, weekStart: monday, month, createdBy, writingPartyId, updatedAt: new Date() })
			.returning({ id: timesheets.id })
			.get();
		await createDays(tx, row.id, monday, month);
		return row.id;
	});
}

async function createDays(tx: Tx, timesheetId: number, weekStart: string, month: string) {
	for (const date of weekDaysInMonth(weekStart, month)) {
		await tx.insert(timesheetDays).values({ timesheetId, date }).onConflictDoNothing();
	}
}

/** Wer freigegeben (und unterschrieben) hat */
const releaser = alias(users, 'releaser');
/** Wer geprüft (und unterschrieben) hat */
const checker = alias(users, 'checker');

export async function sheetDetail(id: number) {
	const sheet = await db
		.select({
			id: timesheets.id,
			userId: timesheets.userId,
			weekStart: timesheets.weekStart,
			month: timesheets.month,
			status: timesheets.status,
			allowanceDays: timesheets.allowanceDays,
			allowanceAmount: timesheets.allowanceAmount,
			vaz: timesheets.vaz,
			vazPercent: timesheets.vazPercent,
			note: timesheets.note,
			releasedAt: timesheets.releasedAt,
			releaseSignature: timesheets.releaseSignature,
			releasedByFirst: releaser.firstName,
			releasedByLast: releaser.lastName,
			checkedAt: timesheets.checkedAt,
			checkSignature: timesheets.checkSignature,
			ink: timesheets.ink,
			checkedByFirst: checker.firstName,
			checkedByLast: checker.lastName,
			firstName: users.firstName,
			lastName: users.lastName,
			username: users.username,
			partyId: users.partyId,
			partyName: parties.name,
			writingPartyId: timesheets.writingPartyId,
			writingPartyName: writer.name
		})
		.from(timesheets)
		.innerJoin(users, eq(users.id, timesheets.userId))
		.leftJoin(parties, eq(parties.id, users.partyId))
		.leftJoin(writer, eq(writer.id, timesheets.writingPartyId))
		.leftJoin(releaser, eq(releaser.id, timesheets.releasedBy))
		.leftJoin(checker, eq(checker.id, timesheets.checkedBy))
		.where(eq(timesheets.id, id))
		.get();
	if (!sheet) return null;

	const days = await db.select().from(timesheetDays).where(eq(timesheetDays.timesheetId, id)).orderBy(asc(timesheetDays.date)).all();
	// Fehlende Tage ergänzen, etwa nach einer Änderung am Aufbau
	const expected = weekDaysInMonth(sheet.weekStart, sheet.month);
	if (days.length < expected.length) {
		await db.transaction((tx) => createDays(tx, id, sheet.weekStart, sheet.month));
		return sheetDetail(id);
	}
	/** Die anderen Monatsteile derselben Woche – für den Wechsel zwischen den Zetteln */
	const siblings = await db
		.select({ id: timesheets.id, month: timesheets.month })
		.from(timesheets)
		.where(and(eq(timesheets.userId, sheet.userId), eq(timesheets.weekStart, sheet.weekStart)))
		.all();
	return { ...sheet, days, siblings: siblings.filter((s) => s.id !== id) };
}

export type SheetDetail = NonNullable<Awaited<ReturnType<typeof sheetDetail>>>;

export interface DayInput {
	date: string;
	costCenter: string;
	site: string;
	/** Zeiträume Beginn – Ende, beliebig viele */
	times: TimeRange[];
	normalHours: string;
	overtime50: string;
	overtime100: string;
	vacationHours: string;
	holidayHours: string;
	rainHours: string;
	sickHours: string;
}

export interface HeadInput {
	allowanceDays: string;
	allowanceAmount: string;
	vazPercent: string;
	note: string;
}

const num = (v: string) => {
	const n = Number(String(v ?? '').replace(',', '.'));
	return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

export async function saveSheet(id: number, head: HeadInput, days: DayInput[]) {
	await db.transaction(async (tx) => {
		await tx
			.update(timesheets)
			.set({
				allowanceDays: num(head.allowanceDays),
				allowanceAmount: num(head.allowanceAmount),
				vazPercent: num(head.vazPercent),
				note: String(head.note ?? '').slice(0, 2000),
				updatedAt: new Date()
			})
			.where(eq(timesheets.id, id));

		for (const d of days) {
			await tx
				.update(timesheetDays)
				.set({
					costCenter: String(d.costCenter ?? '').slice(0, 60),
					site: String(d.site ?? '').slice(0, 200),
					// Mehr als 12 Zeiträume am Tag sind ein Tippfehler, keine Arbeitszeit
					times: normalizeRanges(d.times).slice(0, 12),
					normalHours: parseHours(d.normalHours),
					overtime50: parseHours(d.overtime50),
					overtime100: parseHours(d.overtime100),
					vacationHours: parseHours(d.vacationHours),
					holidayHours: parseHours(d.holidayHours),
					rainHours: parseHours(d.rainHours),
					sickHours: parseHours(d.sickHours)
				})
				.where(and(eq(timesheetDays.timesheetId, id), eq(timesheetDays.date, d.date)));
		}
	});
}

/**
 * Status setzen. Beim Freigeben kann die Unterschrift des Vorarbeiters
 * mitkommen, beim Prüfen die des Prüfers. Wird die Woche wieder geöffnet,
 * verfallen beide – der Inhalt kann sich danach ja noch ändern.
 */
export async function setStatus(
	id: number,
	status: 'entwurf' | 'freigegeben' | 'geprueft',
	userId: number,
	signature: string | null = null
) {
	const now = new Date();
	const set: Record<string, unknown> = { status, updatedAt: now };
	if (status === 'freigegeben') {
		set.releasedBy = userId;
		set.releasedAt = now;
		set.releaseSignature = signature;
		set.checkedBy = null;
		set.checkedAt = null;
		set.checkSignature = null;
	} else if (status === 'geprueft') {
		set.checkedBy = userId;
		set.checkedAt = now;
		set.checkSignature = signature;
	} else {
		set.releasedBy = null;
		set.releasedAt = null;
		set.releaseSignature = null;
		set.checkedBy = null;
		set.checkedAt = null;
		set.checkSignature = null;
	}
	await db.update(timesheets).set(set).where(eq(timesheets.id, id));
}

/** Prüfung zurücknehmen: zurück auf freigegeben, die Freigabe samt Unterschrift bleibt */
export async function undoCheck(id: number) {
	await db
		.update(timesheets)
		.set({ status: 'freigegeben', checkedBy: null, checkedAt: null, checkSignature: null, updatedAt: new Date() })
		.where(eq(timesheets.id, id));
}

export async function deleteSheet(id: number) {
	await db.delete(timesheets).where(eq(timesheets.id, id));
}

type SheetParties = { partyId: number | null; writingPartyId?: number | null };

/**
 * Darf diese Person den Zettel öffnen? Bei Aushilfe sehen ihn beide Partien –
 * die schreibende und die eigene des Mitarbeiters (nur lesend).
 */
export function mayView(user: SessionUser, sheet: SheetParties & { userId: number }): boolean {
	if (sheet.userId === user.id && seesOwn(user)) return true;
	if (seesAll(user)) return true;
	return seesParty(user) && (samePartyAs(user, sheet.partyId) || samePartyAs(user, sheet.writingPartyId));
}

/** Darf die Stundenzettel überhaupt öffnen – mindestens den eigenen */
export const maySeeTimesheets = seesOwn;

/** Freigegebene Zettel, die noch auf die Prüfung warten – so weit diese Person sie sieht */
export async function countReleased(user: SessionUser): Promise<number> {
	const where = [eq(timesheets.status, 'freigegeben')];
	if (!seesAll(user)) {
		if (!seesParty(user)) return 0;
		where.push(or(eq(users.partyId, user.partyId!), eq(timesheets.writingPartyId, user.partyId!))!);
	}
	const row = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(timesheets)
		.innerJoin(users, eq(users.id, timesheets.userId))
		.where(and(...where))
		.get();
	return row?.n ?? 0;
}

/** Ob diese Person die Zettel ihrer Partie oder alle sieht – sonst nur den eigenen */
export const seesOthers = (user: SessionUser) => seesAll(user) || seesParty(user);

/**
 * Darf diese Person Stunden für diesen Mitarbeiter eintragen? „Bearbeiten" gilt
 * für die eigene Partie, „alle bearbeiten" für jede. Maßgeblich ist die
 * schreibende Partie – bei Aushilfe also die übernehmende.
 */
export function mayRecordFor(user: SessionUser, sheet: SheetParties): boolean {
	if (editsAll(user)) return true;
	return can(user.role, 'stunden.bearbeiten') && samePartyAs(user, writerParty(sheet));
}

/** Arbeiter und Partieführer anderer Partien, die diese Person als Aushilfe übernehmen könnte */
export async function borrowCandidates(user: SessionUser): Promise<Staff[]> {
	if (!user.partyId || !can(user.role, 'stunden.aushilfe') || !can(user.role, 'stunden.bearbeiten')) return [];
	return db
		.select(staffFields)
		.from(users)
		.innerJoin(parties, eq(parties.id, users.partyId))
		.where(
			and(
				activeUser,
				eq(users.timesheetExempt, false),
				inArray(users.role, [...PARTY_ROLES]),
				ne(users.partyId, user.partyId)
			)
		)
		.orderBy(asc(users.lastName), asc(users.firstName))
		.all();
}

/**
 * Woche eines Arbeiters übernehmen: Für jeden Monatsteil wird der Zettel angelegt
 * (oder der vorhandene genommen) und der eigenen Partie zugeschrieben. Was die
 * eigene Partie schon eingetragen hat, bleibt stehen.
 */
export async function borrowWeek(user: SessionUser, personId: number, weekStart: string): Promise<{ id: number } | { error: string }> {
	if (!user.partyId) return { error: 'Übernehmen kann nur, wer selbst zu einer Partie gehört.' };
	const person = (await borrowCandidates(user)).find((c) => c.id === personId);
	if (!person) return { error: 'Diese Person lässt sich nicht übernehmen.' };
	const monday = mondayOf(weekStart);
	const existing = await db
		.select({ status: timesheets.status, writingPartyId: timesheets.writingPartyId, writingPartyName: writer.name })
		.from(timesheets)
		.leftJoin(writer, eq(writer.id, timesheets.writingPartyId))
		.where(and(eq(timesheets.userId, personId), eq(timesheets.weekStart, monday)))
		.all();
	if (existing.some((e) => e.status !== 'entwurf')) {
		return { error: 'Diese Woche ist schon freigegeben – übernehmen geht nicht mehr.' };
	}
	const other = existing.find((e) => e.writingPartyId && e.writingPartyId !== user.partyId);
	if (other) return { error: `Diese Woche hat schon ${other.writingPartyName ?? 'eine andere Partie'} übernommen.` };

	const ids: number[] = [];
	for (const month of monthsOfWeek(monday)) {
		const id = await openSheet(personId, monday, month, user.id, user.partyId);
		await db.update(timesheets).set({ writingPartyId: user.partyId, updatedAt: new Date() }).where(eq(timesheets.id, id));
		ids.push(id);
	}
	return { id: ids[0] };
}

/** Übernommene Woche zurückgeben – dann schreibt wieder die eigene Partie */
export async function handBackWeek(personId: number, weekStart: string): Promise<string | null> {
	const parts = await db
		.select({ status: timesheets.status })
		.from(timesheets)
		.where(and(eq(timesheets.userId, personId), eq(timesheets.weekStart, weekStart)))
		.all();
	if (parts.some((p) => p.status !== 'entwurf')) return 'Ein Teil der Woche ist schon freigegeben – zurückgeben geht nicht mehr.';
	await db
		.update(timesheets)
		.set({ writingPartyId: null, updatedAt: new Date() })
		.where(and(eq(timesheets.userId, personId), eq(timesheets.weekStart, weekStart)));
	return null;
}

/**
 * Darf diese Person Zeilen ändern? Nach dem Freigeben nur noch, wer prüfen
 * darf – der Partieführer selbst nicht mehr. Geprüfte Wochen sind zu.
 */
export function mayEdit(user: SessionUser, sheet: SheetParties & { userId: number; status: string }): boolean {
	if (sheet.status === 'geprueft') return false;
	if (sheet.status === 'freigegeben') return can(user.role, 'stunden.pruefen');
	return mayRecordFor(user, sheet);
}

/** Handschrift vom Tablet speichern – leer heißt: keine Handschrift mehr */
export async function saveSheetInk(id: number, ink: InkPages) {
	await db
		.update(timesheets)
		.set({ ink: Object.keys(ink).length ? ink : null, updatedAt: new Date() })
		.where(eq(timesheets.id, id));
}

/** Zuletzt verwendete Baustellen als Vorschlagsliste (später kommen hier Aufträge her) */
export async function recentSites(limit = 50): Promise<string[]> {
	const rows = await db
		.selectDistinct({ site: timesheetDays.site })
		.from(timesheetDays)
		.where(sql`${timesheetDays.site} <> ''`)
		.orderBy(sql`${timesheetDays.date} desc`)
		.limit(limit)
		.all();
	return rows.map((r) => r.site);
}

export function totals(days: { [k: string]: unknown }[]) {
	const sum = (key: string) => days.reduce((s, d) => s + Number(d[key] ?? 0), 0);
	const normal = sum('normalHours');
	const o50 = sum('overtime50');
	const o100 = sum('overtime100');
	const vacation = sum('vacationHours');
	const holiday = sum('holidayHours');
	const rain = sum('rainHours');
	const sick = sum('sickHours');
	return { normal, o50, o100, vacation, holiday, rain, sick, total: normal + o50 + o100 + vacation + holiday + rain + sick };
}
