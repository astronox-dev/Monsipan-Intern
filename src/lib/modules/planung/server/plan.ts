/**
 * Wochenplanung wie der Zettel im Büro: je Partie eine Spalte, je Tag eine
 * Zeile, in den Feldern Aufträge oder freier Text. Dazu stehen Urlaub und
 * Krankenstand der Leute, und – nur für wer alle Partien sieht – die
 * durchgehende Notizliste („noch einzuplanen") und die Aufträge, die noch
 * keiner Partie zugeteilt sind. Wer so einen Auftrag bei einer Partie
 * einplant, teilt ihn ihr damit zu.
 *
 * Die Partie sieht nur ihre eigene Spalte.
 */
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, max, ne, or, sql } from 'drizzle-orm';
import { can } from '$lib/permissions';
import { db } from '$lib/server/db';
import { leaveRequests, orders, parties, planCrewDays, planCrewWeeks, planEntries, planNotes, sickReports, users, workOrders } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { notify } from '$lib/server/notifications';
import { isoWeek, isValidIsoDate, mondayOf, weekDays } from '$lib/modules/stunden/week';
import { readContent } from '$lib/modules/auftraege/work-order';
import { termDays } from '../days';

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

/**
 * Wer in dieser Woche wo ist: die feste Partie aus dem Benutzerkonto, darüber
 * die Besetzung der Woche, darüber die einzelner Tage. `week` ist die Partie,
 * unter der die Person in der Woche steht; `dayMoves` sind die Tage, an denen
 * sie woanders ist.
 */
export async function weekCrew(weekStart: string) {
	const days = weekDays(weekStart);
	const [weekRows, dayRows] = await Promise.all([
		db.select({ userId: planCrewWeeks.userId, partyId: planCrewWeeks.partyId }).from(planCrewWeeks).where(eq(planCrewWeeks.weekStart, weekStart)).all(),
		db
			.select({ userId: planCrewDays.userId, partyId: planCrewDays.partyId, date: planCrewDays.date })
			.from(planCrewDays)
			.where(and(gte(planCrewDays.date, days[0]), lte(planCrewDays.date, days[6])))
			.all()
	]);
	const moved = [...new Set([...weekRows, ...dayRows].map((r) => r.userId))];
	const people = await db
		.select({ id: users.id, partyId: users.partyId, firstName: users.firstName, lastName: users.lastName, username: users.username })
		.from(users)
		.where(and(activeUser, moved.length ? or(isNotNull(users.partyId), inArray(users.id, moved)) : isNotNull(users.partyId)))
		.orderBy(asc(users.firstName), asc(users.lastName))
		.all();
	const weekOf = new Map(weekRows.map((r) => [r.userId, r.partyId]));
	const persons = people
		.map((p) => ({ id: p.id, name: p.firstName || p.lastName || p.username, home: p.partyId, week: weekOf.get(p.id) ?? p.partyId }))
		.filter((p): p is typeof p & { week: number } => p.week != null);
	const weekParty = new Map(persons.map((p) => [p.id, p.week]));
	const dayMoves = dayRows
		.filter((r) => weekParty.has(r.userId) && weekParty.get(r.userId) !== r.partyId)
		.map((r) => ({ userId: r.userId, date: r.date, partyId: r.partyId, fromPartyId: weekParty.get(r.userId)! }));
	return { persons, dayMoves };
}

/** Alles für eine Woche – so weit dieser Benutzer es sehen darf */
export async function planWeek(user: SessionUser, weekStart: string) {
	const days = weekDays(weekStart);
	const all = seesAllPlans(user);
	// Alle Partien mit Namen – auch für „aus …" bei Leuten, die aus einer anderen kommen
	const allParties = await db
		.select({ id: parties.id, name: parties.name, active: parties.active })
		.from(parties)
		.orderBy(sql`${parties.planOrder} is null`, asc(parties.planOrder), asc(parties.name))
		.all();
	const partyName = new Map(allParties.map((p) => [p.id, p.name]));
	const partyRows = allParties.filter((p) => (all ? p.active : p.id === user.partyId)).map((p) => ({ id: p.id, name: p.name }));
	const ids = partyRows.map((p) => p.id);
	const [crew, entries] = ids.length
		? await Promise.all([
				weekCrew(weekStart),
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
		: [{ persons: [], dayMoves: [] }, []];

	// Wer in der Woche bei einer sichtbaren Partie steht – und wer an einzelnen Tagen hierher oder weg wechselt
	const visible = new Set(ids);
	const members = crew.persons.filter((p) => visible.has(p.week));
	const nameOf = new Map(crew.persons.map((p) => [p.id, p.name]));
	const dayMoves = crew.dayMoves
		.filter((m) => visible.has(m.partyId) || visible.has(m.fromPartyId))
		.map((m) => ({
			...m,
			name: nameOf.get(m.userId) ?? '',
			partyName: partyName.get(m.partyId) ?? '',
			fromPartyName: partyName.get(m.fromPartyId) ?? ''
		}));

	// Krankenstand anderer sieht nur, wer Krankmeldungen sehen darf – sonst steht „abwesend" da
	const seesSick = can(user.role, 'krankenstand.sehen') || can(user.role, 'krankenstand.alle.sehen');
	const partyOf = new Map(members.map((m) => [m.id, m.week]));
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
				.filter((m) => m.week === p.id)
				.map((m) => ({
					id: m.id,
					name: m.name,
					/** Diese Woche hier, fest aber woanders (oder ohne Partie) */
					fromName: m.home !== p.id ? (m.home ? (partyName.get(m.home) ?? '') : 'ohne Partie') : null
				}))
		})),
		dayMoves,
		entries,
		absences,
		notes: all ? await listNotes() : [],
		unassigned: all ? await unassignedOrders() : []
	};
}

/** Offene Aufträge ohne Partie – die ältesten zuerst */
export function unassignedOrders() {
	return db
		.select({
			id: orders.id,
			number: orders.number,
			title: orders.title,
			location: orders.location,
			customerName: orders.customerName,
			status: orders.status,
			createdAt: orders.createdAt,
			// Termin aus dem Arbeitsauftrag – damit man sieht, wann er dran ist
			startDate: sql<string | null>`(select json_extract(${workOrders.content}, '$.startDate') from ${workOrders} where ${workOrders.orderId} = ${orders.id})`,
			endDate: sql<string | null>`(select json_extract(${workOrders.content}, '$.endDate') from ${workOrders} where ${workOrders.orderId} = ${orders.id})`
		})
		.from(orders)
		.where(and(isNull(orders.partyId), or(eq(orders.status, 'erstellt'), eq(orders.status, 'in_arbeit'))))
		.orderBy(asc(orders.createdAt), asc(orders.id))
		.limit(200)
		.all();
}

/**
 * Beim Einplanen: Hat der Auftrag noch keine Partie, bekommt er diese. Gibt
 * true zurück, wenn er damit zugeteilt wurde – ein schon zugeteilter bleibt,
 * wo er ist (dann hilft die Partie nur aus).
 */
export async function claimOrder(orderId: number, partyId: number): Promise<boolean> {
	const done = await db
		.update(orders)
		.set({ partyId, updatedAt: new Date() })
		.where(and(eq(orders.id, orderId), isNull(orders.partyId)))
		.returning({ id: orders.id });
	return done.length > 0;
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
		.set({ ...input, fromWorkOrder: false, updatedAt: new Date() })
		.where(eq(planEntries.id, id))
		.returning({ id: planEntries.id });
	return done.length ? true : { message: 'Den Eintrag gibt es nicht mehr.' };
}

export async function deleteEntry(id: number) {
	await db.delete(planEntries).where(eq(planEntries.id, id));
}

/**
 * Eintrag per Ziehen auf ein anderes Feld (Tag und Partie) – vor `beforeId`
 * bzw. ans Ende. Die Reihenfolge im Feld wird dabei neu durchnummeriert.
 */
export async function moveEntry(id: number, target: { date: string; partyId: number; beforeId: number | null }): Promise<{ orderId: number | null } | { message: string }> {
	const entry = await db.select({ id: planEntries.id, orderId: planEntries.orderId }).from(planEntries).where(eq(planEntries.id, id)).get();
	if (!entry) return { message: 'Den Eintrag gibt es nicht mehr.' };
	const party = await db.select({ id: parties.id }).from(parties).where(eq(parties.id, target.partyId)).get();
	if (!party) return { message: 'Die Partie gibt es nicht mehr.' };
	const others = await db
		.select({ id: planEntries.id })
		.from(planEntries)
		.where(and(eq(planEntries.partyId, target.partyId), eq(planEntries.date, target.date), ne(planEntries.id, id)))
		.orderBy(asc(planEntries.sortOrder), asc(planEntries.id))
		.all();
	const order = others.map((o) => o.id);
	const at = target.beforeId == null ? -1 : order.indexOf(target.beforeId);
	order.splice(at < 0 ? order.length : at, 0, id);
	await db.transaction(async (tx) => {
		await tx.update(planEntries).set({ date: target.date, partyId: target.partyId, fromWorkOrder: false, updatedAt: new Date() }).where(eq(planEntries.id, id));
		for (const [i, entryId] of order.entries()) await tx.update(planEntries).set({ sortOrder: i }).where(eq(planEntries.id, entryId));
	});
	return { orderId: entry.orderId };
}

/**
 * Termin aus dem Arbeitsauftrag in die Wochenplanung: Hat der Auftrag eine
 * Partie und der Arbeitsauftrag ein Ausführungsdatum, steht der Auftrag an
 * diesen Tagen (bis zum Endtermin, siehe termDays) bei der Partie. Was jemand
 * selbst eingetragen oder verschoben hat, bleibt, wie es ist; die Einträge vom
 * Arbeitsauftrag ziehen mit, wenn sich Termin oder Partie ändern.
 * Gibt zurück, wo der Auftrag jetzt steht – ohne Partie oder Termin null.
 */
export async function syncWorkOrderPlan(orderId: number, userId: number | null): Promise<{ partyName: string; days: string[] } | null> {
	const [order, work] = await Promise.all([
		db.select({ partyId: orders.partyId, partyName: parties.name }).from(orders).leftJoin(parties, eq(parties.id, orders.partyId)).where(eq(orders.id, orderId)).get(),
		db.select({ content: workOrders.content }).from(workOrders).where(eq(workOrders.orderId, orderId)).get()
	]);
	if (!order || !work) return null;
	const c = readContent(work.content);
	const days = c.startDate ? termDays(c.startDate, c.endDate) : [];
	const partyId = order.partyId;
	// Was vom Arbeitsauftrag kam und nicht mehr passt, geht weg
	const auto = await db
		.select({ id: planEntries.id, date: planEntries.date, partyId: planEntries.partyId })
		.from(planEntries)
		.where(and(eq(planEntries.orderId, orderId), eq(planEntries.fromWorkOrder, true)))
		.all();
	const stale = auto.filter((e) => e.partyId !== partyId || !days.includes(e.date)).map((e) => e.id);
	if (stale.length) await db.delete(planEntries).where(inArray(planEntries.id, stale));
	if (!partyId || !days.length) return null;
	// Steht er an einem Tag schon bei der Partie (auch selbst eingetragen), bleibt es dabei
	const have = new Set(
		(
			await db
				.select({ date: planEntries.date })
				.from(planEntries)
				.where(and(eq(planEntries.orderId, orderId), eq(planEntries.partyId, partyId), inArray(planEntries.date, days)))
				.all()
		).map((r) => r.date)
	);
	for (const date of days) {
		if (have.has(date)) continue;
		const last = await db
			.select({ n: max(planEntries.sortOrder) })
			.from(planEntries)
			.where(and(eq(planEntries.partyId, partyId), eq(planEntries.date, date)))
			.get();
		await db.insert(planEntries).values({ date, partyId, orderId, text: '', sortOrder: (last?.n ?? -1) + 1, fromWorkOrder: true, createdBy: userId, updatedAt: new Date() });
	}
	return { partyName: order.partyName ?? '', days };
}

/** An welchen Tagen und bei welchen Partien ein Auftrag in der Wochenplanung steht */
export async function orderPlanDays(orderId: number): Promise<{ days: string[]; parties: string[] }> {
	const rows = await db
		.select({ date: planEntries.date, party: parties.name })
		.from(planEntries)
		.innerJoin(parties, eq(parties.id, planEntries.partyId))
		.where(eq(planEntries.orderId, orderId))
		.orderBy(asc(planEntries.date))
		.all();
	return { days: [...new Set(rows.map((r) => r.date))], parties: [...new Set(rows.map((r) => r.party))] };
}

/** Reihenfolge der Spalten – für alle, auch im PDF; nicht genannte Partien bleiben alphabetisch dahinter */
export async function setPartyOrder(ids: number[]) {
	await db.transaction(async (tx) => {
		for (const [i, id] of ids.entries()) await tx.update(parties).set({ planOrder: i }).where(eq(parties.id, id));
	});
}

/**
 * Person einer anderen Partie zuteilen – für die ganze Woche (`weekStart`) oder
 * nur einen Tag (`date`). Zurück auf die eigene (Woche: die feste Partie, Tag:
 * die der Woche) löscht die Abweichung. Die feste Partie im Konto bleibt.
 */
export async function setCrew(
	user: SessionUser,
	input: { userId: number; partyId: number } & ({ weekStart: string; date?: undefined } | { date: string; weekStart?: undefined })
): Promise<string | null> {
	const person = await db.select({ id: users.id, partyId: users.partyId }).from(users).where(and(eq(users.id, input.userId), activeUser)).get();
	if (!person) return 'Die Person gibt es nicht mehr.';
	const party = await db.select({ id: parties.id }).from(parties).where(and(eq(parties.id, input.partyId), eq(parties.active, true))).get();
	if (!party) return 'Die Partie gibt es nicht mehr.';

	if (input.weekStart) {
		const where = and(eq(planCrewWeeks.weekStart, input.weekStart), eq(planCrewWeeks.userId, person.id));
		if (input.partyId === person.partyId) await db.delete(planCrewWeeks).where(where);
		else
			await db
				.insert(planCrewWeeks)
				.values({ weekStart: input.weekStart, userId: person.id, partyId: input.partyId, createdBy: user.id })
				.onConflictDoUpdate({ target: [planCrewWeeks.weekStart, planCrewWeeks.userId], set: { partyId: input.partyId, createdBy: user.id } });
		return null;
	}

	const date = input.date!;
	const week = await db
		.select({ partyId: planCrewWeeks.partyId })
		.from(planCrewWeeks)
		.where(and(eq(planCrewWeeks.weekStart, mondayOf(date)), eq(planCrewWeeks.userId, person.id)))
		.get();
	const where = and(eq(planCrewDays.date, date), eq(planCrewDays.userId, person.id));
	if (input.partyId === (week?.partyId ?? person.partyId)) await db.delete(planCrewDays).where(where);
	else
		await db
			.insert(planCrewDays)
			.values({ date, userId: person.id, partyId: input.partyId, createdBy: user.id })
			.onConflictDoUpdate({ target: [planCrewDays.date, planCrewDays.userId], set: { partyId: input.partyId, createdBy: user.id } });
	return null;
}

/** Abweichung aufheben: zurück zur festen Partie (Woche) bzw. zur Partie der Woche (Tag) */
export async function resetCrew(input: { userId: number } & ({ weekStart: string; date?: undefined } | { date: string; weekStart?: undefined })) {
	if (input.weekStart) await db.delete(planCrewWeeks).where(and(eq(planCrewWeeks.weekStart, input.weekStart), eq(planCrewWeeks.userId, input.userId)));
	else await db.delete(planCrewDays).where(and(eq(planCrewDays.date, input.date!), eq(planCrewDays.userId, input.userId)));
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

/** Bei welcher Partie jemand an einem Tag laut Planung ist: Tag, sonst Woche, sonst die feste */
export async function partyOnDay(userId: number, homePartyId: number | null, day: string): Promise<number | null> {
	const [onDay, inWeek] = await Promise.all([
		db.select({ partyId: planCrewDays.partyId }).from(planCrewDays).where(and(eq(planCrewDays.date, day), eq(planCrewDays.userId, userId))).get(),
		db
			.select({ partyId: planCrewWeeks.partyId })
			.from(planCrewWeeks)
			.where(and(eq(planCrewWeeks.weekStart, mondayOf(day)), eq(planCrewWeeks.userId, userId)))
			.get()
	]);
	return onDay?.partyId ?? inWeek?.partyId ?? homePartyId;
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
