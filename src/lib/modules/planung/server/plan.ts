/**
 * Wochenplanung wie der Zettel im Büro: je Partie eine Spalte, je Tag eine
 * Zeile, in den Feldern Aufträge oder freier Text. Dazu stehen Urlaub und
 * Krankenstand der Leute, und – nur für wer alle Partien sieht – die
 * durchgehende Notizliste („noch einzuplanen").
 *
 * Die Partie sieht nur ihre eigene Spalte.
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, max, or } from 'drizzle-orm';
import { can } from '$lib/permissions';
import { db } from '$lib/server/db';
import { leaveRequests, orders, parties, planEntries, planNotes, sickReports, users } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { notify } from '$lib/server/notifications';
import { isoWeek, isValidIsoDate, weekDays } from '$lib/modules/stunden/week';

export const MAX_ENTRY_TEXT = 200;
export const MAX_NOTE_TEXT = 500;

export const seesAllPlans = (user: Pick<SessionUser, 'role'>) => can(user.role, 'planung.alle.sehen');

const activeUser = and(eq(users.active, true), isNull(users.deletedAt));

/** Urlaub (genehmigt) und Krankenstand von Personen in einem Zeitraum */
export async function absencesFor(userIds: number[], from: string, to: string) {
	if (!userIds.length) return [];
	const [leave, sick] = await Promise.all([
		db
			.select({
				userId: leaveRequests.userId,
				from: leaveRequests.from,
				to: leaveRequests.to
			})
			.from(leaveRequests)
			.where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.status, 'genehmigt'), lte(leaveRequests.from, to), gte(leaveRequests.to, from)))
			.all(),
		db
			.select({
				userId: sickReports.userId,
				from: sickReports.from,
				to: sickReports.to
			})
			.from(sickReports)
			.where(and(inArray(sickReports.userId, userIds), lte(sickReports.from, to), or(isNull(sickReports.to), gte(sickReports.to, from))))
			.all()
	]);
	return [...leave.map((l) => ({ ...l, kind: 'urlaub' as const })), ...sick.map((s) => ({ ...s, kind: 'krank' as const }))];
}

/** Alles für eine Woche – so weit dieser Benutzer es sehen darf */
export async function planWeek(user: SessionUser, weekStart: string) {
	const days = weekDays(weekStart);
	const all = seesAllPlans(user);
	const partyRows = await db
		.select({ id: parties.id, name: parties.name })
		.from(parties)
		.where(all ? eq(parties.active, true) : eq(parties.id, user.partyId ?? -1))
		.orderBy(asc(parties.name))
		.all();
	const ids = partyRows.map((p) => p.id);
	const [members, entries] = ids.length
		? await Promise.all([
				db
					.select({
						id: users.id,
						partyId: users.partyId,
						firstName: users.firstName,
						lastName: users.lastName,
						username: users.username
					})
					.from(users)
					.where(and(activeUser, inArray(users.partyId, ids)))
					.orderBy(asc(users.firstName), asc(users.lastName))
					.all(),
				db
					.select({
						id: planEntries.id,
						date: planEntries.date,
						partyId: planEntries.partyId,
						orderId: planEntries.orderId,
						text: planEntries.text,
						orderNumber: orders.number,
						orderTitle: orders.title,
						orderLocation: orders.location,
						orderStatus: orders.status
					})
					.from(planEntries)
					.leftJoin(orders, eq(orders.id, planEntries.orderId))
					.where(and(inArray(planEntries.partyId, ids), gte(planEntries.date, days[0]), lte(planEntries.date, days[6])))
					.orderBy(asc(planEntries.date), asc(planEntries.sortOrder), asc(planEntries.id))
					.all()
			])
		: [[], []];

	// Krankenstand anderer sieht nur, wer Krankmeldungen sehen darf – sonst steht „abwesend" da
	const seesSick = can(user.role, 'krankenstand.sehen') || can(user.role, 'krankenstand.alle.sehen');
	const partyOf = new Map(members.map((m) => [m.id, m.partyId!]));
	const nameOf = new Map(members.map((m) => [m.id, m.firstName || m.lastName || m.username]));
	const absences = (
		await absencesFor(
			members.map((m) => m.id),
			days[0],
			days[6]
		)
	).map((a) => ({
		...a,
		kind: a.kind === 'krank' && !seesSick && a.userId !== user.id ? ('abwesend' as const) : a.kind,
		partyId: partyOf.get(a.userId)!,
		name: nameOf.get(a.userId) ?? ''
	}));

	return {
		days,
		parties: partyRows.map((p) => ({
			...p,
			members: members
				.filter((m) => m.partyId === p.id)
				.map((m) => ({
					id: m.id,
					name: m.firstName || m.lastName || m.username
				}))
		})),
		entries,
		absences,
		notes: all ? await listNotes() : []
	};
}

export type PlanWeek = Awaited<ReturnType<typeof planWeek>>;

/** Aufträge zur Auswahl: alle offenen, dazu die schon in der Woche eingeplanten */
export async function planOrders(alsoIds: number[] = []) {
	const open = or(eq(orders.status, 'erstellt'), eq(orders.status, 'in_arbeit'));
	return db
		.select({
			id: orders.id,
			number: orders.number,
			title: orders.title,
			location: orders.location,
			partyId: orders.partyId,
			status: orders.status
		})
		.from(orders)
		.where(alsoIds.length ? or(open, inArray(orders.id, alsoIds)) : open)
		.orderBy(desc(orders.createdAt))
		.limit(400)
		.all();
}

/* ------------------------------------------------------------ Einträge */

export interface EntryInput {
	date: string;
	partyId: number;
	orderId: number | null;
	text: string;
}

export function readEntry(form: FormData): EntryInput | { message: string } {
	const date = String(form.get('datum') ?? '');
	if (!isValidIsoDate(date)) return { message: 'Das Datum fehlt.' };
	const partyId = Number(form.get('partie'));
	if (!Number.isInteger(partyId) || partyId <= 0) return { message: 'Bitte die Partie wählen.' };
	const rawOrder = String(form.get('auftrag') ?? '');
	const orderId = /^\d+$/.test(rawOrder) ? Number(rawOrder) : null;
	const text = String(form.get('text') ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_ENTRY_TEXT);
	if (!orderId && !text) return { message: 'Bitte einen Auftrag wählen oder etwas eintragen.' };
	return { date, partyId, orderId, text };
}

async function checkRefs(input: EntryInput): Promise<string | null> {
	const party = await db.select({ id: parties.id }).from(parties).where(eq(parties.id, input.partyId)).get();
	if (!party) return 'Die Partie gibt es nicht mehr.';
	if (input.orderId) {
		const order = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId)).get();
		if (!order) return 'Den Auftrag gibt es nicht mehr.';
	}
	return null;
}

/** Neuer Eintrag – hinten im Feld */
export async function addEntry(user: SessionUser, input: EntryInput): Promise<number | { message: string }> {
	const problem = await checkRefs(input);
	if (problem) return { message: problem };
	const last = await db
		.select({ n: max(planEntries.sortOrder) })
		.from(planEntries)
		.where(and(eq(planEntries.partyId, input.partyId), eq(planEntries.date, input.date)))
		.get();
	const row = await db
		.insert(planEntries)
		.values({
			...input,
			sortOrder: (last?.n ?? -1) + 1,
			createdBy: user.id,
			updatedAt: new Date()
		})
		.returning({ id: planEntries.id })
		.get();
	return row.id;
}

/** Ändern – auch auf einen anderen Tag oder zu einer anderen Partie */
export async function updateEntry(id: number, input: EntryInput): Promise<true | { message: string }> {
	const problem = await checkRefs(input);
	if (problem) return { message: problem };
	const done = await db
		.update(planEntries)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(planEntries.id, id))
		.returning({ id: planEntries.id });
	return done.length ? true : { message: 'Den Eintrag gibt es nicht mehr.' };
}

export async function deleteEntry(id: number) {
	await db.delete(planEntries).where(eq(planEntries.id, id));
}

/**
 * Die Woche an die Partien schicken: je Partie mit Einträgen eine
 * Benachrichtigung – statt bei jedem einzelnen Eintrag.
 */
export async function sendWeek(user: SessionUser, weekStart: string): Promise<number> {
	const days = weekDays(weekStart);
	const rows = await db
		.select({ partyId: planEntries.partyId, name: parties.name, n: count() })
		.from(planEntries)
		.innerJoin(parties, eq(parties.id, planEntries.partyId))
		.where(and(gte(planEntries.date, days[0]), lte(planEntries.date, days[6])))
		.groupBy(planEntries.partyId, parties.name)
		.all();
	const { week } = isoWeek(weekStart);
	for (const r of rows) {
		notify({
			event: 'planung.woche',
			title: `Wochenplan KW ${week}`,
			body: `${r.name}: ${r.n} ${r.n === 1 ? 'Eintrag' : 'Einträge'}`,
			url: `/planung?woche=${weekStart}`,
			partyId: r.partyId,
			actorId: user.id
		});
	}
	return rows.length;
}

/* ------------------------------------------------------------ Notizen */

/** Offene zuerst (älteste oben), darunter die zuletzt erledigten */
export async function listNotes() {
	const [open, done] = await Promise.all([
		db
			.select({
				id: planNotes.id,
				text: planNotes.text,
				done: planNotes.done,
				doneAt: planNotes.doneAt
			})
			.from(planNotes)
			.where(eq(planNotes.done, false))
			.orderBy(asc(planNotes.id))
			.all(),
		db
			.select({
				id: planNotes.id,
				text: planNotes.text,
				done: planNotes.done,
				doneAt: planNotes.doneAt
			})
			.from(planNotes)
			.where(eq(planNotes.done, true))
			.orderBy(desc(planNotes.doneAt), desc(planNotes.id))
			.limit(30)
			.all()
	]);
	return [...open, ...done];
}

const noteText = (v: FormDataEntryValue | null) =>
	String(v ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_NOTE_TEXT);

export async function addNote(user: SessionUser, raw: FormDataEntryValue | null): Promise<boolean> {
	const text = noteText(raw);
	if (!text) return false;
	await db.insert(planNotes).values({ text, createdBy: user.id });
	return true;
}

export async function updateNote(id: number, raw: FormDataEntryValue | null): Promise<boolean> {
	const text = noteText(raw);
	if (!text) return false;
	await db.update(planNotes).set({ text }).where(eq(planNotes.id, id));
	return true;
}

export async function setNoteDone(id: number, done: boolean) {
	await db
		.update(planNotes)
		.set({ done, doneAt: done ? new Date() : null })
		.where(eq(planNotes.id, id));
}

export async function deleteNote(id: number) {
	await db.delete(planNotes).where(eq(planNotes.id, id));
}

/** Die eigene Partie heute – für die Übersicht */
export async function todayForParty(partyId: number, day: string) {
	return db
		.select({
			id: planEntries.id,
			text: planEntries.text,
			orderId: planEntries.orderId,
			orderNumber: orders.number,
			orderTitle: orders.title,
			orderLocation: orders.location
		})
		.from(planEntries)
		.leftJoin(orders, eq(orders.id, planEntries.orderId))
		.where(and(eq(planEntries.partyId, partyId), eq(planEntries.date, day)))
		.orderBy(asc(planEntries.sortOrder), asc(planEntries.id))
		.all();
}
