/**
 * Tage für Urlaub und Krankenstand: gesetzliche Feiertage in Österreich und
 * Arbeitstage (Montag bis Freitag ohne Feiertage). Alles als „JJJJ-MM-TT".
 */
import { addDays, daysBetween, isValidIsoDate, today as todayIso, weekdayIndex } from '$lib/modules/stunden/week';

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

/** Urlaubsstunden je Wochentag, Montag zuerst – Vorgabe: 39-Stunden-Woche */
export const DEFAULT_LEAVE_HOURS: readonly number[] = [8, 8, 8, 8, 7, 0, 0];

/** Sieben Zahlen von 0 bis 24 – sonst die Vorgabe */
export function validLeaveHours(value: unknown): number[] {
	const ok = Array.isArray(value) && value.length === 7 && value.every((h) => typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 24);
	return ok ? [...value] : [...DEFAULT_LEAVE_HOURS];
}

/** „7,5 Std." */
export const hoursText = (h: number) => `${String(Math.round(h * 100) / 100).replace('.', ',')} Std.`;

/**
 * Die Tage eines Urlaubs mit den Stunden, die sie verbrauchen. Feiertage und
 * Wochentage ohne Urlaubsstunden zählen nicht.
 */
export function leaveDays(from: string, to: string, hours: readonly number[]): { date: string; hours: number }[] {
	if (!isValidIsoDate(from) || !isValidIsoDate(to) || to < from) return [];
	const out: { date: string; hours: number }[] = [];
	for (let d = from, guard = 0; d <= to && guard < 800; d = addDays(d, 1), guard++) {
		const h = hours[weekdayIndex(d)] ?? 0;
		if (h > 0 && !holidayName(d)) out.push({ date: d, hours: h });
	}
	return out;
}

export interface LeaveUsage {
	/** Verbrauchte Urlaubstage und -stunden */
	days: number;
	hours: number;
	/** Durch Krankenstand unterbrochen – diese Tage und Stunden zählen nicht */
	sickDays: number;
	sickHours: number;
	/** Die Krankenstände im Urlaub, die ihn unterbrechen – auf seinen Zeitraum gekürzt */
	interruptions: { from: string; to: string }[];
}

/** Ein Krankenstand unterbricht den Urlaub erst, wenn er länger als so viele Kalendertage dauert (§ 5 Urlaubsgesetz) */
export const SICK_INTERRUPTS_AFTER = 3;

export interface SickSpell {
	from: string;
	/** null: noch krank */
	to: string | null;
	/** Kalendertage – bei offenem Ende bis heute */
	days: number;
	/** Länger als drei Kalendertage: unterbricht einen Urlaub */
	interrupts: boolean;
}

/**
 * Krankenstände als zusammenhängende Zeiten: Meldungen, die direkt
 * aneinander anschließen, gelten als ein Krankenstand. Er unterbricht einen
 * Urlaub nur, wenn er länger als drei Kalendertage dauert – sonst läuft der
 * Urlaub weiter. Ein offenes Ende („noch krank") zählt bis heute.
 */
export function sickSpells(sick: readonly { from: string; to: string | null }[], today = todayIso()): SickSpell[] {
	const spells: SickSpell[] = [];
	for (const s of [...sick].sort((a, b) => a.from.localeCompare(b.from))) {
		const last = spells.at(-1);
		if (last && (last.to == null || s.from <= addDays(last.to, 1))) last.to = last.to == null || s.to == null ? null : s.to > last.to ? s.to : last.to;
		else spells.push({ from: s.from, to: s.to, days: 0, interrupts: false });
	}
	for (const s of spells) {
		s.days = daysBetween(s.from, s.to ?? (today > s.from ? today : s.from)) + 1;
		s.interrupts = s.days > SICK_INTERRUPTS_AFTER;
	}
	return spells;
}

/** Der zusammenhängende Krankenstand, in dem dieser Tag liegt */
export function spellOf(spells: readonly SickSpell[], date: string): SickSpell | undefined {
	return spells.find((s) => s.from <= date && (s.to == null || date <= s.to));
}

/**
 * Was ein Urlaub verbraucht. Ein Krankenstand von mehr als drei Kalendertagen
 * unterbricht ihn: Tage, an denen jemand krank gemeldet ist, zählen dann nicht.
 * Ein kürzerer zählt nicht – der Urlaub läuft weiter. Ein offenes Ende
 * („noch krank") gilt bis zum Urlaubsende, sobald er bis heute länger dauert.
 */
export function leaveUsage(from: string, to: string, hours: readonly number[], sick: readonly { from: string; to: string | null }[], today = todayIso()): LeaveUsage {
	const interruptions = sickSpells(sick, today)
		.filter((s) => s.interrupts && overlaps(s.from, s.to, from, to))
		.map((s) => ({ from: s.from < from ? from : s.from, to: !s.to || s.to > to ? to : s.to }))
		.sort((a, b) => a.from.localeCompare(b.from));
	const usage: LeaveUsage = { days: 0, hours: 0, sickDays: 0, sickHours: 0, interruptions };
	for (const d of leaveDays(from, to, hours)) {
		if (interruptions.some((s) => s.from <= d.date && d.date <= s.to)) {
			usage.sickDays++;
			usage.sickHours += d.hours;
		} else {
			usage.days++;
			usage.hours += d.hours;
		}
	}
	usage.hours = Math.round(usage.hours * 100) / 100;
	usage.sickHours = Math.round(usage.sickHours * 100) / 100;
	return usage;
}

/**
 * Die Tage eines Termins von–bis (etwa aus dem Arbeitsauftrag): die Arbeitstage
 * dazwischen. Erster und letzter Tag zählen immer – auch an einem Samstag oder
 * Feiertag ist dann ausdrücklich gearbeitet. Höchstens 60 Tage.
 */
export function termDays(from: string, to: string): string[] {
	if (!isValidIsoDate(from)) return [];
	const end = isValidIsoDate(to) && to >= from ? to : from;
	const out: string[] = [];
	for (let d = from; d <= end && out.length < 60; d = addDays(d, 1)) if (d === from || d === end || isWorkday(d)) out.push(d);
	return out;
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
