/**
 * Tage für Urlaub und Krankenstand: gesetzliche Feiertage in Österreich und
 * Arbeitstage (Montag bis Freitag ohne Feiertage). Alles als „JJJJ-MM-TT".
 */
import { addDays, isValidIsoDate, weekdayIndex } from '$lib/modules/stunden/week';

/** Ostersonntag nach der Gaußschen Osterformel (gregorianisch) */
export function easterSunday(year: number): string {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const cache = new Map<number, Map<string, string>>();

/** Die gesetzlichen Feiertage eines Jahres: Datum → Name */
export function holidays(year: number): Map<string, string> {
	const hit = cache.get(year);
	if (hit) return hit;
	const easter = easterSunday(year);
	const fixed = (md: string) => `${year}-${md}`;
	const list: [string, string][] = [
		[fixed('01-01'), 'Neujahr'],
		[fixed('01-06'), 'Heilige Drei Könige'],
		[addDays(easter, 1), 'Ostermontag'],
		[fixed('05-01'), 'Staatsfeiertag'],
		[addDays(easter, 39), 'Christi Himmelfahrt'],
		[addDays(easter, 50), 'Pfingstmontag'],
		[addDays(easter, 60), 'Fronleichnam'],
		[fixed('08-15'), 'Mariä Himmelfahrt'],
		[fixed('10-26'), 'Nationalfeiertag'],
		[fixed('11-01'), 'Allerheiligen'],
		[fixed('12-08'), 'Mariä Empfängnis'],
		[fixed('12-25'), 'Christtag'],
		[fixed('12-26'), 'Stefanitag']
	];
	const map = new Map(list);
	cache.set(year, map);
	return map;
}

/** Name des Feiertags an diesem Tag – sonst null */
export function holidayName(iso: string): string | null {
	return holidays(Number(iso.slice(0, 4))).get(iso) ?? null;
}

/** Montag bis Freitag und kein Feiertag */
export function isWorkday(iso: string): boolean {
	return weekdayIndex(iso) < 5 && !holidayName(iso);
}

/** Arbeitstage von–bis (beide eingeschlossen); 0 bei ungültigen Angaben */
export function workdays(from: string, to: string): number {
	if (!isValidIsoDate(from) || !isValidIsoDate(to) || to < from) return 0;
	let n = 0;
	// Obergrenze gegen Tippfehler wie 2062 statt 2026
	for (let d = from, guard = 0; d <= to && guard < 800; d = addDays(d, 1), guard++) if (isWorkday(d)) n++;
	return n;
}

/** „07.10." bzw. „07.10. – 09.10.2026" für Listen */
export function rangeLabel(from: string, to: string | null): string {
	const [y, m, d] = from.split('-');
	if (!to || to === from) return `${d}.${m}.${y}`;
	const [y2, m2, d2] = to.split('-');
	return y === y2 ? `${d}.${m}. – ${d2}.${m2}.${y2}` : `${d}.${m}.${y} – ${d2}.${m2}.${y2}`;
}

/** Überschneiden sich zwei Zeiträume? Ein offenes Ende (null) gilt als „bis auf Weiteres" */
export function overlaps(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
	return aFrom <= (bTo ?? '9999-12-31') && bFrom <= (aTo ?? '9999-12-31');
}
