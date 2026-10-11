/**
 * Urlaub: Jeder beantragt für sich, die Leitung genehmigt oder lehnt ab.
 * Wer genehmigen darf, kann auch für andere eintragen – das gilt dann gleich
 * als genehmigt. Gezählt werden Arbeitstage (Mo–Fr ohne Feiertage).
 *
 * Sehen: die eigenen, die der eigenen Partie oder alle – je nach Recht.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { can } from '$lib/permissions';
import { db } from '$lib/server/db';
import { leaveRequests, parties, users, type LeaveStatus } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { notify } from '$lib/server/notifications';
import { fullName } from '$lib/format';
import { isValidIsoDate } from '$lib/modules/stunden/week';
import { overlaps, rangeLabel, workdays } from '../days';

/** Längster Antrag am Stück – schützt vor Tippfehlern im Jahr */
export const MAX_LEAVE_DAYS = 92;

const decider = alias(users, 'decider');
const activeUser = and(eq(users.active, true), isNull(users.deletedAt));

export type Scope = 'self' | 'party' | 'all';

/** Wie weit jemand Urlaub sieht – null: gar nicht */
export function leaveScope(user: Pick<SessionUser, 'role' | 'partyId'>): Scope | null {
	if (can(user.role, 'urlaub.alle.sehen')) return 'all';
	if (can(user.role, 'urlaub.sehen') && user.partyId) return 'party';
	if (can(user.role, 'urlaub.eigene.sehen')) return 'self';
	return null;
}

function scopeWhere(user: SessionUser): SQL | undefined {
	const scope = leaveScope(user);
	if (scope === 'all') return undefined;
	if (scope === 'party') return or(eq(users.partyId, user.partyId!), eq(leaveRequests.userId, user.id));
	return eq(leaveRequests.userId, user.id);
}

/** Anträge eines Jahres – so weit sichtbar; offene zuerst */
export async function listLeave(user: SessionUser, year: number) {
	const rows = await db
		.select({
			id: leaveRequests.id,
			userId: leaveRequests.userId,
			firstName: users.firstName,
			lastName: users.lastName,
			username: users.username,
			partyName: parties.name,
			from: leaveRequests.from,
			to: leaveRequests.to,
			days: leaveRequests.days,
			note: leaveRequests.note,
			status: leaveRequests.status,
			decisionNote: leaveRequests.decisionNote,
			decidedAt: leaveRequests.decidedAt,
			deciderFirst: decider.firstName,
			deciderLast: decider.lastName,
			createdAt: leaveRequests.createdAt,
			createdBy: leaveRequests.createdBy
		})
		.from(leaveRequests)
		.innerJoin(users, eq(users.id, leaveRequests.userId))
		.leftJoin(parties, eq(parties.id, users.partyId))
		.leftJoin(decider, eq(decider.id, leaveRequests.decidedBy))
		.where(and(scopeWhere(user), lte(leaveRequests.from, `${year}-12-31`), gte(leaveRequests.to, `${year}-01-01`)))
		.orderBy(sql`case ${leaveRequests.status} when 'beantragt' then 0 else 1 end`, desc(leaveRequests.from), desc(leaveRequests.id))
		.all();
	return rows.map(({ firstName, lastName, username, deciderFirst, deciderLast, ...r }) => ({
		...r,
		name: fullName({ firstName, lastName, username }),
		decidedByName: fullName({
			firstName: deciderFirst,
			lastName: deciderLast
		})
	}));
}

export type LeaveRow = Awaited<ReturnType<typeof listLeave>>[number];

/** Genehmigte Arbeitstage je Person im Jahr (nur die Tage in diesem Jahr) */
export function approvedDays(rows: LeaveRow[], year: number): Map<number, number> {
	const out = new Map<number, number>();
	for (const r of rows) {
		if (r.status !== 'genehmigt') continue;
		const from = r.from < `${year}-01-01` ? `${year}-01-01` : r.from;
		const to = r.to > `${year}-12-31` ? `${year}-12-31` : r.to;
		out.set(r.userId, (out.get(r.userId) ?? 0) + workdays(from, to));
	}
	return out;
}

/** Wer im Formular gewählt werden kann: sonst nur man selbst */
export async function leavePeople(user: SessionUser) {
	if (!can(user.role, 'urlaub.genehmigen')) return [];
	const rows = await db
		.select({
			id: users.id,
			firstName: users.firstName,
			lastName: users.lastName,
			username: users.username,
			partyName: parties.name
		})
		.from(users)
		.leftJoin(parties, eq(parties.id, users.partyId))
		.where(and(activeUser, ne(users.role, 'viewer')))
		.orderBy(asc(users.firstName), asc(users.lastName))
		.all();
	return rows.map((r) => ({
		id: r.id,
		name: fullName(r),
		partyName: r.partyName
	}));
}

export interface LeaveInput {
	userId: number;
	from: string;
	to: string;
	note: string;
}

export function readLeave(form: FormData, user: SessionUser): LeaveInput | { message: string } {
	const from = String(form.get('von') ?? '');
	const to = String(form.get('bis') ?? '') || from;
	if (!isValidIsoDate(from) || !isValidIsoDate(to)) return { message: 'Bitte von und bis eintragen.' };
	if (to < from) return { message: '„Bis" liegt vor „von".' };
	const person = Number(form.get('person'));
	return {
		userId: Number.isInteger(person) && person > 0 ? person : user.id,
		from,
		to,
		note: String(form.get('notiz') ?? '')
			.trim()
			.slice(0, 500)
	};
}

/** Neuer Antrag – für andere (nur mit „genehmigen") gleich genehmigt */
export async function createLeave(user: SessionUser, input: LeaveInput): Promise<number | { message: string }> {
	const forOther = input.userId !== user.id;
	const mayDecide = can(user.role, 'urlaub.genehmigen');
	if (forOther && !mayDecide) return { message: 'Urlaub beantragen geht nur für dich selbst.' };
	if (!forOther && !can(user.role, 'urlaub.beantragen')) return { message: 'Dafür fehlt dir die Berechtigung.' };
	const person = await db
		.select({ id: users.id, partyId: users.partyId })
		.from(users)
		.where(and(activeUser, eq(users.id, input.userId)))
		.get();
	if (!person) return { message: 'Diese Person gibt es nicht (mehr).' };
	const days = workdays(input.from, input.to);
	if (!days) return { message: 'In diesem Zeitraum liegt kein Arbeitstag.' };
	if (days > MAX_LEAVE_DAYS)
		return {
			message: `Höchstens ${MAX_LEAVE_DAYS} Arbeitstage am Stück – bitte das Datum prüfen.`
		};
	const existing = await db
		.select({ from: leaveRequests.from, to: leaveRequests.to })
		.from(leaveRequests)
		.where(and(eq(leaveRequests.userId, input.userId), inArray(leaveRequests.status, ['beantragt', 'genehmigt'])))
		.all();
	const clash = existing.find((e) => overlaps(e.from, e.to, input.from, input.to));
	if (clash)
		return {
			message: `Für ${rangeLabel(clash.from, clash.to)} gibt es schon einen Antrag.`
		};

	const status: LeaveStatus = forOther ? 'genehmigt' : 'beantragt';
	const row = await db
		.insert(leaveRequests)
		.values({
			...input,
			days,
			status,
			decidedBy: forOther ? user.id : null,
			decidedAt: forOther ? new Date() : null,
			createdBy: user.id,
			updatedAt: new Date()
		})
		.returning({ id: leaveRequests.id })
		.get();
	if (status === 'beantragt') {
		notify({
			event: 'urlaub.beantragt',
			title: `Urlaub beantragt: ${fullName(user)}`,
			body: `${rangeLabel(input.from, input.to)} · ${days} ${days === 1 ? 'Arbeitstag' : 'Arbeitstage'}`,
			url: '/urlaub',
			partyId: person.partyId,
			actorId: user.id
		});
	}
	return row.id;
}

async function leaveById(id: number) {
	return db
		.select({
			id: leaveRequests.id,
			userId: leaveRequests.userId,
			from: leaveRequests.from,
			to: leaveRequests.to,
			days: leaveRequests.days,
			status: leaveRequests.status
		})
		.from(leaveRequests)
		.where(eq(leaveRequests.id, id))
		.get();
}

/** Genehmigen oder ablehnen – nur offene Anträge */
export async function decideLeave(user: SessionUser, id: number, status: 'genehmigt' | 'abgelehnt', note: string): Promise<true | { message: string }> {
	if (!can(user.role, 'urlaub.genehmigen')) return { message: 'Dafür fehlt dir die Berechtigung.' };
	const leave = await leaveById(id);
	if (!leave) return { message: 'Den Antrag gibt es nicht mehr.' };
	if (leave.status !== 'beantragt') return { message: 'Über diesen Antrag ist schon entschieden.' };
	await db
		.update(leaveRequests)
		.set({
			status,
			decisionNote: note.trim().slice(0, 500),
			decidedBy: user.id,
			decidedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(leaveRequests.id, id));
	notify({
		event: 'urlaub.entschieden',
		title: `Urlaub ${status === 'genehmigt' ? 'genehmigt' : 'abgelehnt'}`,
		body: [rangeLabel(leave.from, leave.to), note.trim()].filter(Boolean).join(' · '),
		url: '/urlaub',
		userIds: [leave.userId],
		actorId: user.id
	});
	return true;
}

/** Löschen: der eigene, solange offen – oder mit „genehmigen" jeder (z. B. stornierter Urlaub) */
export async function deleteLeave(user: SessionUser, id: number): Promise<true | { message: string }> {
	const leave = await leaveById(id);
	if (!leave) return true;
	const own = leave.userId === user.id && leave.status === 'beantragt';
	if (!own && !can(user.role, 'urlaub.genehmigen')) return { message: 'Diesen Antrag kannst du nicht mehr zurückziehen.' };
	await db.delete(leaveRequests).where(eq(leaveRequests.id, id));
	return true;
}

/** Offene Anträge – für „Zu erledigen" auf der Übersicht */
export async function countOpenLeave(): Promise<number> {
	const row = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(leaveRequests)
		.where(eq(leaveRequests.status, 'beantragt'))
		.get();
	return row?.n ?? 0;
}
