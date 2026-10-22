/**
 * Urlaubskonto: Wer angemeldet ist, erwirbt je Woche Urlaub – rein rechnerisch
 * 5 Wochen × 39 Std. = 195 Std. im Jahr, also 195 ÷ 52 = 3,75 Std. je
 * Beschäftigungswoche (anteilig je Tag). Wer über den Winter abgemeldet ist,
 * erwirbt in der Zeit nichts. Genehmigter Urlaub geht ab – ohne die Tage mit
 * Krankenstand –, der Rest bleibt stehen und zählt im nächsten Jahr weiter.
 */
import { addDays, daysBetween } from '$lib/modules/stunden/week';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export interface EmploymentPeriod {
	from: string;
	/** Ohne Ende: laufend */
	to: string | null;
}

/** Urlaubsstunden je Beschäftigungswoche: Wochen Urlaub im Jahr × Wochenstunden ÷ 52 */
export const weeklyAccrual = (weeks: number, weekHours: number) => (weeks * weekHours) / 52;

/** Beschäftigte Tage ab dem Stichtag bis einschließlich heute */
export function employedDays(periods: readonly EmploymentPeriod[], today: string, start: string | null = null): number {
	let days = 0;
	for (const p of periods) {
		const from = start && start > p.from ? start : p.from;
		const to = p.to && p.to < today ? p.to : today;
		if (to >= from) days += daysBetween(from, to) + 1;
	}
	return days;
}

export interface LeaveAccount {
	/** Übertrag zum Stichtag */
	carryover: number;
	/** Seit dem Stichtag bis heute erworben */
	earned: number;
	/** Genehmigter Urlaub seit dem Stichtag (ohne Krankenstandstage) */
	used: number;
	/** Was noch bleibt – negativ, wenn mehr genehmigt ist als erworben */
	rest: number;
}

/** Stand des Kontos heute: Übertrag + erworben − genehmigt */
export function leaveAccount(a: { periods: readonly EmploymentPeriod[]; carryover: number; start: string | null; rate: number }, used: number, today: string): LeaveAccount {
	const earned = round2((employedDays(a.periods, today, a.start) / 7) * a.rate);
	const carryover = round2(a.carryover);
	used = round2(used);
	return { carryover, earned, used, rest: round2(carryover + earned - used) };
}

/** Angemeldet seit …, abgemeldet seit … oder angemeldet ab … (künftig) – null ohne Beschäftigungszeiten */
export function employmentState(periods: readonly EmploymentPeriod[], today: string): { state: 'angemeldet' | 'abgemeldet' | 'ab'; date: string } | null {
	const current = periods.find((p) => p.from <= today && (!p.to || p.to >= today));
	if (current) return { state: 'angemeldet', date: current.from };
	const past = periods.filter((p) => p.to && p.to < today).sort((a, b) => b.to!.localeCompare(a.to!))[0];
	const next = periods.filter((p) => p.from > today).sort((a, b) => a.from.localeCompare(b.from))[0];
	if (next) return { state: 'ab', date: next.from };
	if (past) return { state: 'abgemeldet', date: addDays(past.to!, 1) };
	return null;
}

/** Ungefähr in Tagen – ein Tag mit dem Durchschnitt der Woche (39 Std. ÷ 5 = 7,8 Std.) */
export const hoursToDays = (hours: number, weekHours: number) => (weekHours > 0 ? Math.round((hours / (weekHours / 5)) * 10) / 10 : 0);
