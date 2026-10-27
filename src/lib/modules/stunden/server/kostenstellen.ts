/**
 * Kostenstellen-Auswertung: die Tage aller Stundenzettel im Zeitraum, an denen
 * gearbeitet wurde, zusammengefasst je Kostenstelle (siehe ../kostenstellen.ts).
 * Die Partie ist die, die den Zettel schreibt – bei Aushilfe die andere Partie.
 */
import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { col } from '$lib/server/db/sql';
import { parties, timesheetDays, timesheets, users } from '$lib/server/db/schema';
import { costCenterKey, sumByCostCenter } from '../kostenstellen';
import { entryLines, isValidIsoDate, today } from '../week';
import type { TimesheetStatus } from '$lib/server/db/schema';

/** Welche Zettel zählen: alle, freigegebene und geprüfte, oder nur geprüfte */
export type CostCenterScope = 'alle' | 'freigegeben' | 'geprueft';
const STATUS: Record<CostCenterScope, TimesheetStatus[]> = {
	alle: ['entwurf', 'freigegeben', 'geprueft'],
	freigegeben: ['freigegeben', 'geprueft'],
	geprueft: ['geprueft']
};

/** Zeitraum und Stand aus der Adresse – ohne Angabe: dieses Jahr bis heute, alle Zettel */
export function readCostCenterFilter(params: URLSearchParams) {
	const now = today();
	const raw = (k: string) => params.get(k) ?? '';
	let from = isValidIsoDate(raw('von')) ? raw('von') : `${now.slice(0, 4)}-01-01`;
	let to = isValidIsoDate(raw('bis')) ? raw('bis') : now;
	if (to < from) [from, to] = [to, from];
	const stand = raw('stand');
	const scope: CostCenterScope = stand === 'freigegeben' || stand === 'geprueft' ? stand : 'alle';
	return { from, to, scope };
}

export async function costCenterHours(from: string, to: string, scope: CostCenterScope = 'alle') {
	const worked = sql`${timesheetDays.normalHours} + ${timesheetDays.overtime50} + ${timesheetDays.overtime100}`;
	// Die schreibende Partie, sonst die des Mitarbeiters
	const partyName = sql<string | null>`(select ${col(parties.name)} from ${parties} where ${col(parties.id)} = coalesce(${timesheets.writingPartyId}, ${users.partyId}))`;
	const rows = await db
		.select({
			costCenter: timesheetDays.costCenter,
			date: timesheetDays.date,
			normal: timesheetDays.normalHours,
			o50: timesheetDays.overtime50,
			o100: timesheetDays.overtime100,
			userId: timesheets.userId,
			party: partyName
		})
		.from(timesheetDays)
		.innerJoin(timesheets, sql`${timesheets.id} = ${timesheetDays.timesheetId}`)
		.innerJoin(users, sql`${users.id} = ${timesheets.userId}`)
		.where(and(gte(timesheetDays.date, from), lte(timesheetDays.date, to), inArray(timesheets.status, STATUS[scope]), sql`${worked} > 0`))
		.all();
	// Mehrere Kostenstellen an einem Tag: die Stunden zu gleichen Teilen
	return sumByCostCenter(
		rows.flatMap((r) => {
			const costs = entryLines(r.costCenter);
			if (costs.length < 2) return [{ ...r, costCenter: costs[0] ?? '' }];
			return costs.map((costCenter) => ({ ...r, costCenter, normal: r.normal / costs.length, o50: r.o50 / costs.length, o100: r.o100 / costs.length }));
		})
	);
}

/**
 * Bekannte Kostenstellen als Vorschlag beim Eintragen – je Kostenstelle eine
 * Schreibweise, dieselbe wie in der Auswertung (die häufigste, bei Gleichstand
 * die kürzere). Die zuletzt benutzten, alphabetisch.
 */
export async function knownCostCenters(limit = 200): Promise<string[]> {
	const rows = await db
		.select({ costCenter: timesheetDays.costCenter, uses: sql<number>`count(*)`.mapWith(Number), last: sql<string>`max(${timesheetDays.date})` })
		.from(timesheetDays)
		.where(sql`trim(${timesheetDays.costCenter}) <> ''`)
		.groupBy(timesheetDays.costCenter)
		.all();
	const best = new Map<string, { label: string; uses: number; last: string }>();
	for (const r of rows.flatMap((row) => entryLines(row.costCenter).map((costCenter) => ({ ...row, costCenter })))) {
		const key = costCenterKey(r.costCenter);
		const label = r.costCenter.trim().replace(/\s+/g, ' ');
		const had = best.get(key);
		const better = !had || r.uses > had.uses || (r.uses === had.uses && label.length < had.label.length);
		const last = had && had.last > r.last ? had.last : r.last;
		best.set(key, better ? { label, uses: r.uses, last } : { ...had, last });
	}
	return [...best.values()]
		.sort((a, b) => b.last.localeCompare(a.last))
		.slice(0, limit)
		.map((b) => b.label)
		.sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
}
