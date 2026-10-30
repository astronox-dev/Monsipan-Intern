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
import { leaveRequests, orders, parties, planCrewDays, planCrewWeeks, planEntries, planNotes, settings, sickReports, users, workOrders } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { notify } from '$lib/server/notifications';
import { addDays, isoWeek, isValidIsoDate, mondayOf, today, weekDays } from '$lib/modules/stunden/week';
import { effectiveRole } from '$lib/server/lead';
import { date as dateLabel } from '$lib/format';
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
		.select({
			id: users.id,
			partyId: users.partyId,
			role: users.role,
			leadUntil: users.leadUntil,
			firstName: users.firstName,
			lastName: users.lastName,
			username: users.username
		})
		.from(users)
		.where(and(activeUser, moved.length ? or(isNotNull(users.partyId), inArray(users.id, moved)) : isNotNull(users.partyId)))
		.orderBy(asc(users.firstName), asc(users.lastName))
		.all();
	const weekOf = new Map(weekRows.map((r) => [r.userId, r.partyId]));
	const persons = people
		.map((p) => ({
			id: p.id,
			name: p.firstName || p.lastName || p.username,
			home: p.partyId,
			week: weekOf.get(p.id) ?? p.partyId,
			role: p.role,
			leadUntil: effectiveRole(p.role, p.leadUntil) !== p.role ? p.leadUntil : null
		}))
		.filter((p): p is typeof p & { week: number } => p.week != null);
	const weekParty = new Map(persons.map((p) => [p.id, p.week]));
	const dayMoves = dayRows
		.filter((r) => weekParty.has(r.userId) && weekParty.get(r.userId) !== r.partyId)
		.map((r) => ({ userId: r.userId, date: r.date, partyId: r.partyId, fromPartyId: weekParty.get(r.userId)! }));
	return { persons, dayMoves };
}

/**
 * Wo eine Person an den Tagen einer Woche eingeteilt ist: ihre feste Partie,
 * darüber die der Woche, darüber einzelne Tage – wie in der Wochenplanung.
 */
export async function crewWeek(userId: number, weekStart: string): Promise<{ home: number | null; days: { date: string; partyId: number | null }[] }> {
	const monday = mondayOf(weekStart);
	const days = weekDays(monday);
	const [person, week, dayRows] = await Promise.all([
		db.select({ partyId: users.partyId }).from(users).where(eq(users.id, userId)).get(),
		db
			.select({ partyId: planCrewWeeks.partyId })
			.from(planCrewWeeks)
			.where(and(eq(planCrewWeeks.weekStart, monday), eq(planCrewWeeks.userId, userId)))
			.get(),
		db
			.select({ date: planCrewDays.date, partyId: planCrewDays.partyId })
			.from(planCrewDays)
			.where(and(eq(planCrewDays.userId, userId), gte(planCrewDays.date, days[0]), lte(planCrewDays.date, days[6])))
			.all()
	]);
	const home = person?.partyId ?? null;
	const onDay = new Map(dayRows.map((r) => [r.date, r.partyId]));
	return { home, days: days.map((date) => ({ date, partyId: onDay.get(date) ?? week?.partyId ?? home })) };
}

/** Die Tage der Woche, an denen die Person laut Planung bei dieser Partie aushilft – leer bei ihrer festen */
export async function guestDaysAt(userId: number, weekStart: string, partyId: number | null): Promise<string[]> {
	if (!partyId) return [];
	const c = await crewWeek(userId, weekStart);
	if (c.home === partyId) return [];
	return c.days.filter((d) => d.partyId === partyId).map((d) => d.date);
}

/** Wer in dieser Woche laut Planung bei dieser Partie aushilft (feste Partie woanders) – je Person die Tage */
export async function guestsOfParty(partyId: number, weekStart: string): Promise<Map<number, string[]>> {
	const monday = mondayOf(weekStart);
	const days = weekDays(monday);
	const [weekRows, dayRows] = await Promise.all([
		db.select({ userId: planCrewWeeks.userId }).from(planCrewWeeks).where(and(eq(planCrewWeeks.weekStart, monday), eq(planCrewWeeks.partyId, partyId))).all(),
		db
			.select({ userId: planCrewDays.userId })
			.from(planCrewDays)
			.where(and(eq(planCrewDays.partyId, partyId), gte(planCrewDays.date, days[0]), lte(planCrewDays.date, days[6])))
			.all()
	]);
	const out = new Map<number, string[]>();
	for (const id of new Set([...weekRows, ...dayRows].map((r) => r.userId))) {
		const guest = await guestDaysAt(id, monday, partyId);
		if (guest.length) out.set(id, guest);
	}
	return out;
}

/** Alles für eine Woche – so weit dieser Benutzer es sehen darf */
export async function planWeek(user: SessionUser, weekStart: string) {
	const days = weekDays(weekStart);
	const all = seesAllPlans(user);
	// Wer bei einer anderen Partie aushilft, sieht deren Spalte – an den Tagen, an denen er dort ist
	const guestDays: Record<number, string[]> = {};
	if (!all) {
		const mine = await crewWeek(user.id, weekStart);
		for (const d of mine.days) if (d.partyId && d.partyId !== mine.home) (guestDays[d.partyId] ??= []).push(d.date);
	}
	// Alle Partien mit Namen – auch für „aus …" bei Leuten, die aus einer anderen kommen
	const allParties = await db
		.select({ id: parties.id, name: parties.name, active: parties.active })
		.from(parties)
		.orderBy(sql`${parties.planOrder} is null`, asc(parties.planOrder), asc(parties.name))
		.all();
	const partyName = new Map(allParties.map((p) => [p.id, p.name]));
	const partyRows = allParties.filter((p) => (all ? p.active : p.id === user.partyId || p.id in guestDays)).map((p) => ({ id: p.id, name: p.name }));
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
					// Bei einer Partie, wo man nur aushilft, nur die eigenen Tage
					.then((rows) => rows.filter((e) => !(e.partyId in guestDays) || guestDays[e.partyId].includes(e.date)))
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
					fromName: m.home !== p.id ? (m.home ? (partyName.get(m.home) ?? '') : 'ohne Partie') : null,
					/** Kann vorübergehend Partieführer werden: ein Arbeiter mit fester Partie */
					canLead: m.role === 'arbeiter' && m.home != null,
					/** Vorübergehend Partieführer bis … */
					leadUntil: m.leadUntil
				}))
		})),
		dayMoves,
		entries,
		/** Partien, bei denen man nur aushilft – mit den Tagen, die man dort sieht */
		guestDays,
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

/**
 * Zurück zu den nicht zugeteilten: Der Auftrag verliert seine Partie, seine
 * Einträge ab heute gehen aus der Planung – der gezogene Eintrag in jedem Fall.
 * Was schon war, bleibt als Nachweis stehen.
 */
export async function unplanOrder(entryId: number, today: string): Promise<{ orderId: number; number: string } | { message: string }> {
	const entry = await db.select({ orderId: planEntries.orderId }).from(planEntries).where(eq(planEntries.id, entryId)).get();
	if (!entry) return { message: 'Den Eintrag gibt es nicht mehr.' };
	const orderId = entry.orderId;
	if (!orderId) return { message: 'Nur Einträge mit Auftrag lassen sich zurücklegen.' };
	const order = await db.select({ number: orders.number, status: orders.status }).from(orders).where(eq(orders.id, orderId)).get();
	if (!order) return { message: 'Den Auftrag gibt es nicht mehr.' };
	if (order.status === 'abgeschlossen') return { message: 'Der Auftrag ist schon abgeschlossen.' };
	await db.transaction(async (tx) => {
		await tx.delete(planEntries).where(or(eq(planEntries.id, entryId), and(eq(planEntries.orderId, orderId), gte(planEntries.date, today))));
		await tx.update(orders).set({ partyId: null, updatedAt: new Date() }).where(eq(orders.id, orderId));
	});
	return { orderId, number: order.number };
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
	if (!order) return null;
	// Ohne Arbeitsauftrag (etwa gelöscht) gibt es keinen Termin – seine Einträge gehen
	const c = work ? readContent(work.content) : null;
	const days = c?.startDate ? termDays(c.startDate, c.endDate) : [];
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

/** Offene Aufträge mit Arbeitsauftrag abgleichen (alle oder die genannten) – gibt zurück, wie viele jetzt eingeplant sind */
export async function syncWorkOrderPlans(orderIds?: number[]): Promise<number> {
	if (orderIds && !orderIds.length) return 0;
	const rows = await db
		.select({ id: orders.id })
		.from(workOrders)
		.innerJoin(orders, eq(orders.id, workOrders.orderId))
		.where(and(ne(orders.status, 'abgeschlossen'), orderIds ? inArray(orders.id, orderIds) : undefined))
		.all();
	let planned = 0;
	for (const r of rows) if (await syncWorkOrderPlan(r.id, null)) planned++;
	return planned;
}

const BACKFILL_KEY = 'planung.arbeitsauftraege-nachgetragen';

/**
 * Einmalig: Arbeitsaufträge, die schon Termin und Partie hatten, bevor das von
 * selbst in die Wochenplanung ging, kommen nachträglich hinein. Nur einmal –
 * wer danach einen Eintrag in der Planung löscht, bekommt ihn nicht wieder.
 */
export async function backfillWorkOrderPlans(): Promise<number | null> {
	if (await db.select({ key: settings.key }).from(settings).where(eq(settings.key, BACKFILL_KEY)).get()) return null;
	const planned = await syncWorkOrderPlans();
	await db.insert(settings).values({ key: BACKFILL_KEY, value: JSON.stringify(new Date().toISOString()) }).onConflictDoNothing();
	return planned;
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
const dayFmt = new Intl.DateTimeFormat('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const dayName = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00Z`));

/**
 * Hat sich die Einteilung einer Person in einer Woche geändert, bekommt sie
 * Bescheid: wo sie jetzt woanders ist – oder dass sie wieder ganz bei ihrer
 * Partie ist. `before` ist crewWeek vor der Änderung.
 */
export async function notifyCrewChange(actor: SessionUser | null, userId: number, before: Awaited<ReturnType<typeof crewWeek>>, weekStart: string) {
	const after = await crewWeek(userId, weekStart);
	if (after.days.every((d, i) => d.partyId === before.days[i].partyId)) return;
	const names = new Map((await db.select({ id: parties.id, name: parties.name }).from(parties).all()).map((p) => [p.id, p.name]));
	const away = new Map<number, string[]>();
	for (const d of after.days) if (d.partyId && d.partyId !== after.home) away.set(d.partyId, [...(away.get(d.partyId) ?? []), d.date]);
	const { week } = isoWeek(weekStart);
	const homeName = after.home ? (names.get(after.home) ?? 'deiner Partie') : 'deiner Partie';
	const body = away.size
		? [...away].map(([party, days]) => `${names.get(party) ?? 'Andere Partie'}: ${days.length === 7 ? 'die ganze Woche' : days.map(dayName).join(', ')}`).join(' · ')
		: `Wieder die ganze Woche bei ${homeName}`;
	notify({
		event: 'planung.einteilung',
		title: away.size ? `KW ${week}: bei einer anderen Partie eingeteilt` : `KW ${week}: wieder bei ${homeName}`,
		body,
		url: `/planung?woche=${mondayOf(weekStart)}`,
		userIds: [userId],
		actorId: actor?.id ?? null
	});
}

/**
 * Vorübergehend Partieführer machen – bis einschließlich `until` – bzw. mit
 * null wieder beenden. Nur für Arbeiter mit fester Partie; die Person bekommt
 * Bescheid.
 */
export async function setActingLead(actor: SessionUser, userId: number, until: string | null): Promise<true | { message: string }> {
	const person = await db.select({ role: users.role, partyId: users.partyId, leadUntil: users.leadUntil }).from(users).where(and(eq(users.id, userId), activeUser)).get();
	if (!person) return { message: 'Diese Person gibt es nicht (mehr).' };
	if (person.role !== 'arbeiter') return { message: 'Vorübergehend Partieführer werden kann nur ein Arbeiter.' };
	if (!person.partyId) return { message: 'Ohne feste Partie geht das nicht – erst im Benutzerkonto eine Partie eintragen.' };
	const day = today();
	if (until != null) {
		if (!isValidIsoDate(until) || until < day) return { message: 'Bitte ein Datum ab heute wählen.' };
		if (until > addDays(day, 366)) return { message: 'Höchstens ein Jahr – sonst im Benutzerkonto die Rolle ändern.' };
	}
	const wasLead = effectiveRole(person.role, person.leadUntil, day) !== person.role;
	await db.update(users).set({ leadUntil: until }).where(eq(users.id, userId));
	if (until || wasLead) {
		notify({
			event: 'planung.partiefuehrer',
			title: until ? `Bis ${dateLabel(until)} vorübergehend Partieführer` : 'Nicht mehr vorübergehend Partieführer',
			body: until ? 'Du kannst Tagesberichte und Stundenzettel deiner Partie schreiben und freigeben.' : '',
			url: until ? '/tagesberichte' : '/',
			userIds: [userId],
			actorId: actor.id
		});
	}
	return true;
}

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
