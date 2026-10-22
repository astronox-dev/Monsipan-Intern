/**
 * Urlaubskonten: Beschäftigungszeiten (An- und Abmeldung), Übertrag zum
 * Stichtag und der Stand je Person – gerechnet wird in ../konto.ts. Sehen darf
 * es, wer den Urlaub der Person sieht; pflegen, wer Urlaubskonten bearbeiten darf.
 */
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { can } from '$lib/permissions';
import { db } from '$lib/server/db';
import { employmentPeriods, leaveAccounts, leaveRequests, parties, users } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { getSettings } from '$lib/server/settings';
import { fullName } from '$lib/format';
import { isValidIsoDate } from '$lib/modules/stunden/week';
import { leaveUsage, overlaps, rangeLabel } from '../days';
import { employmentState, leaveAccount, weeklyAccrual } from '../konto';
import { hoursFor, leaveScope, sickOf } from './urlaub';

const NO_RIGHT = { message: 'Dafür fehlt dir die Berechtigung.' };

/** Wessen Konto jemand sieht: alle Beschäftigten, die der eigenen Partie oder nur das eigene */
export async function accountPeople(user: SessionUser) {
	const scope = leaveScope(user);
	if (!scope) return [];
	const rows = await db
		.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username, partyName: parties.name })
		.from(users)
		.leftJoin(parties, eq(parties.id, users.partyId))
		.where(
			and(
				eq(users.active, true),
				isNull(users.deletedAt),
				ne(users.role, 'viewer'),
				scope === 'all' ? undefined : scope === 'party' ? or(eq(users.partyId, user.partyId!), eq(users.id, user.id)) : eq(users.id, user.id)
			)
		)
		.orderBy(asc(users.firstName), asc(users.lastName))
		.all();
	return rows.map((r) => ({ id: r.id, name: fullName(r), partyName: r.partyName }));
}

/** Stand der Konten heute – je Person Beschäftigungszeiten, Übertrag, Anspruch je Woche und Rest */
export async function leaveAccountsFor(userIds: number[], today: string) {
	if (!userIds.length) return new Map<number, AccountView>();
	const [settings, periods, accounts, leave] = await Promise.all([
		getSettings(),
		db
			.select({ id: employmentPeriods.id, userId: employmentPeriods.userId, from: employmentPeriods.from, to: employmentPeriods.to })
			.from(employmentPeriods)
			.where(inArray(employmentPeriods.userId, userIds))
			.orderBy(asc(employmentPeriods.from))
			.all(),
		db.select().from(leaveAccounts).where(inArray(leaveAccounts.userId, userIds)).all(),
		db
			.select({ userId: leaveRequests.userId, from: leaveRequests.from, to: leaveRequests.to, dayHours: leaveRequests.dayHours })
			.from(leaveRequests)
			.where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.status, 'genehmigt')))
			.all()
	]);
	const sick = await sickOf(leave);
	const weekHours = settings.leaveHours.reduce((s, h) => s + h, 0);
	const out = new Map<number, AccountView>();
	for (const id of userIds) {
		const a = accounts.find((x) => x.userId === id);
		const mine = periods.filter((p) => p.userId === id).map(({ id: pid, from, to }) => ({ id: pid, from, to }));
		const start = a?.startDate ?? null;
		const weeks = a?.weeks ?? settings.leaveWeeks;
		const rate = weeklyAccrual(weeks, weekHours);
		const sickOfPerson = sick.filter((s) => s.userId === id);
		// Genehmigter Urlaub ab dem Stichtag – was davor lag, steckt im Übertrag
		const used = leave
			.filter((l) => l.userId === id && (!start || l.to >= start))
			.reduce((s, l) => s + leaveUsage(start && l.from < start ? start : l.from, l.to, hoursFor('genehmigt', l.dayHours, settings.leaveHours), sickOfPerson).hours, 0);
		out.set(id, {
			setUp: mine.length > 0 || !!a,
			periods: mine,
			carryover: a?.carryover ?? 0,
			start,
			weeks,
			ownWeeks: a?.weeks ?? null,
			rate,
			weekHours,
			state: employmentState(mine, today),
			account: leaveAccount({ periods: mine, carryover: a?.carryover ?? 0, start, rate }, used, today)
		});
	}
	return out;
}

export interface AccountView {
	/** Beschäftigungszeiten oder Übertrag eingetragen */
	setUp: boolean;
	periods: { id: number; from: string; to: string | null }[];
	carryover: number;
	start: string | null;
	/** Wochen Urlaub im Jahr – eigene oder aus den Einstellungen */
	weeks: number;
	ownWeeks: number | null;
	/** Anspruch je Beschäftigungswoche in Stunden */
	rate: number;
	weekHours: number;
	state: ReturnType<typeof employmentState>;
	account: ReturnType<typeof leaveAccount>;
}

async function personExists(userId: number) {
	return !!(await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).get());
}

/**
 * Beschäftigungszeit anlegen oder ändern (z. B. „abmelden": das Ende eintragen).
 * Zeiten derselben Person dürfen sich nicht überschneiden.
 */
export async function saveEmployment(user: SessionUser, input: { id: number | null; userId: number; from: string; to: string | null }): Promise<true | { message: string }> {
	if (!can(user.role, 'urlaub.konten.bearbeiten')) return NO_RIGHT;
	if (!isValidIsoDate(input.from)) return { message: 'Bitte eintragen, ab wann angemeldet.' };
	if (input.to && (!isValidIsoDate(input.to) || input.to < input.from)) return { message: '„Abgemeldet ab" liegt vor der Anmeldung.' };
	if (!(await personExists(input.userId))) return { message: 'Diese Person gibt es nicht (mehr).' };
	const existing = await db.select().from(employmentPeriods).where(eq(employmentPeriods.userId, input.userId)).all();
	if (input.id != null && !existing.some((e) => e.id === input.id)) return { message: 'Diese Beschäftigungszeit gibt es nicht mehr.' };
	const clash = existing.find((e) => e.id !== input.id && overlaps(e.from, e.to, input.from, input.to));
	if (clash) return { message: `Überschneidet sich mit ${clash.to ? rangeLabel(clash.from, clash.to) : `angemeldet ab ${rangeLabel(clash.from, null)}`}.` };
	if (input.id != null) await db.update(employmentPeriods).set({ from: input.from, to: input.to }).where(eq(employmentPeriods.id, input.id));
	else await db.insert(employmentPeriods).values({ userId: input.userId, from: input.from, to: input.to, createdBy: user.id });
	return true;
}

export async function deleteEmployment(user: SessionUser, id: number): Promise<true | { message: string }> {
	if (!can(user.role, 'urlaub.konten.bearbeiten')) return NO_RIGHT;
	await db.delete(employmentPeriods).where(eq(employmentPeriods.id, id));
	return true;
}

/** Übertrag, Stichtag und eigene Urlaubswochen (leer: wie in den Einstellungen) */
export async function saveLeaveAccount(
	user: SessionUser,
	input: { userId: number; carryover: number; start: string | null; weeks: number | null }
): Promise<true | { message: string }> {
	if (!can(user.role, 'urlaub.konten.bearbeiten')) return NO_RIGHT;
	if (!(await personExists(input.userId))) return { message: 'Diese Person gibt es nicht (mehr).' };
	if (input.start && !isValidIsoDate(input.start)) return { message: 'Der Stichtag ist kein gültiges Datum.' };
	if (Math.abs(input.carryover) > 2000) return { message: 'Der Übertrag ist zu hoch.' };
	if (input.weeks != null && !(input.weeks > 0 && input.weeks <= 10)) return { message: 'Urlaubswochen zwischen 1 und 10.' };
	const values = { carryover: Math.round(input.carryover * 100) / 100, startDate: input.start, weeks: input.weeks, updatedBy: user.id, updatedAt: new Date() };
	await db
		.insert(leaveAccounts)
		.values({ userId: input.userId, ...values })
		.onConflictDoUpdate({ target: leaveAccounts.userId, set: values });
	return true;
}
