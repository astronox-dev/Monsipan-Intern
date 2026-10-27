/**
 * Wochenrechnung für die Stundenzettel. Eine Lohnwoche läuft von Montag bis
 * Sonntag; gespeichert wird immer der Montag als "JJJJ-MM-TT". Gerechnet wird
 * mit UTC-Mitternacht, damit Sommerzeit nichts verschiebt.
 */
export const WEEKDAY_LABELS = ['Mon.', 'Die.', 'Mitt.', 'Donn.', 'Frei.', 'Sam.', 'Sonn.'] as const;

const DAY = 86_400_000;

export function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function toUtc(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

export function isValidIsoDate(iso: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(toUtc(iso).getTime()) && isoDate(toUtc(iso)) === iso;
}

export function addDays(iso: string, days: number): string {
	return isoDate(new Date(toUtc(iso).getTime() + days * DAY));
}

/** Tage von einem Datum zum anderen – rückwärts negativ */
export function daysBetween(from: string, to: string): number {
	return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY);
}

/** Montag der Woche, in der dieses Datum liegt */
export function mondayOf(iso: string): string {
	const d = toUtc(iso);
	const weekday = (d.getUTCDay() + 6) % 7; // Montag = 0
	return isoDate(new Date(d.getTime() - weekday * DAY));
}

export function today(): string {
	return isoDate(new Date());
}

/** Wochentag eines Datums: Montag = 0 … Sonntag = 6 */
export function weekdayIndex(iso: string): number {
	return (toUtc(iso).getUTCDay() + 6) % 7;
}

/** Die sieben Tage einer Woche, beginnend beim Montag */
export function weekDays(weekStart: string): string[] {
	return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/* ------------------------------------------------------------ Monatsschnitt */

/** Monat eines Tages als "JJJJ-MM" */
export function monthOf(iso: string): string {
	return iso.slice(0, 7);
}

/**
 * Die Monate, in die eine Woche fällt – meist einer, über den Monatswechsel zwei.
 * Für jeden Monat gibt es einen eigenen Stundenzettel, weil der Lohn monatlich
 * abgerechnet wird.
 */
export function monthsOfWeek(weekStart: string): string[] {
	const out: string[] = [];
	for (const d of weekDays(weekStart)) {
		const m = monthOf(d);
		if (!out.includes(m)) out.push(m);
	}
	return out;
}

/** Die Tage einer Woche, die in diesen Monat fallen */
export function weekDaysInMonth(weekStart: string, month: string): string[] {
	return weekDays(weekStart).filter((d) => monthOf(d) === month);
}

const monthFmt = new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "September 2026" */
export function monthLabel(month: string): string {
	return monthFmt.format(toUtc(`${month}-01`));
}

/** Zeitraum eines Monatsteils: "28.09.–30.09.2026" */
export function segmentLabel(weekStart: string, month: string): string {
	const days = weekDaysInMonth(weekStart, month);
	if (!days.length) return '';
	const first = days[0];
	const last = days.at(-1)!;
	return first === last ? fmtFull.format(toUtc(first)) : `${fmt.format(toUtc(first))}–${fmtFull.format(toUtc(last))}`;
}

/** Kalenderwoche nach ISO 8601 */
export function isoWeek(iso: string): { year: number; week: number } {
	const d = toUtc(iso);
	const weekday = (d.getUTCDay() + 6) % 7;
	const thursday = new Date(d.getTime() + (3 - weekday) * DAY);
	const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
	const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
	const firstMonday = new Date(firstThursday.getTime() - firstWeekday * DAY);
	return { year: thursday.getUTCFullYear(), week: Math.round((thursday.getTime() - firstMonday.getTime()) / (7 * DAY)) + 1 };
}

const fmt = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const fmtFull = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

export function dayLabel(iso: string): string {
	return fmtFull.format(toUtc(iso));
}

/** "KW 40 · 29.09.–05.10.2026" */
export function weekLabel(weekStart: string): string {
	const { week } = isoWeek(weekStart);
	const end = addDays(weekStart, 6);
	return `KW ${week} · ${fmt.format(toUtc(weekStart))}–${fmtFull.format(toUtc(end))}`;
}

/** Stunden deutsch: 8,5 statt 8.5 – leere Werte bleiben leer */
export function hoursLabel(value: number | null | undefined): string {
	if (value == null || value === 0) return '';
	return String(Math.round(value * 100) / 100).replace('.', ',');
}

/** "8,5" oder "8:30" als Zahl lesen; alles andere wird 0 */
export function parseHours(input: string | null | undefined): number {
	const s = String(input ?? '').trim();
	if (!s) return 0;
	const colon = s.match(/^(\d{1,2}):(\d{1,2})$/);
	if (colon) return Number(colon[1]) + Number(colon[2]) / 60;
	const n = Number(s.replace(',', '.'));
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.min(24, Math.round(n * 100) / 100);
}

/** Minuten seit Mitternacht; null, wenn die Eingabe keine Uhrzeit ist */
export function minutesOf(input: string | null | undefined): number | null {
	const t = parseTime(input);
	if (!t) return null;
	const [h, m] = t.split(':').map(Number);
	return h * 60 + m;
}

/** Ein Arbeitszeitraum Beginn – Ende, jeweils "HH:MM" */
export type TimeRange = { from: string; to: string };

/** Zeiträume säubern: Uhrzeiten vereinheitlichen, ganz leere weglassen */
export function normalizeRanges(ranges: readonly TimeRange[] | null | undefined): TimeRange[] {
	return (ranges ?? [])
		.map((r) => ({ from: parseTime(r.from), to: parseTime(r.to) }))
		.filter((r) => r.from || r.to);
}

/**
 * Stunden eines Zeitraums. Endet er vor seinem Beginn, geht er über
 * Mitternacht (18:00 – 04:00 = 10 Stunden). Unvollständig oder gleich: null.
 */
export function rangeHours(r: TimeRange): number | null {
	const s = minutesOf(r.from);
	const e = minutesOf(r.to);
	if (s == null || e == null || s === e) return null;
	const minutes = e > s ? e - s : e + 24 * 60 - s;
	return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Arbeitszeit eines Tages: Summe aller Zeiträume. Solange ein Zeitraum nur halb
 * ausgefüllt ist oder gar keiner vollständig, gibt es null – dann bleibt die
 * Norm-Spalte, wie sie ist.
 */
export function workedHours(ranges: readonly TimeRange[] | null | undefined): number | null {
	const filled = normalizeRanges(ranges);
	if (!filled.length) return null;
	let total = 0;
	for (const r of filled) {
		const h = rangeHours(r);
		if (h == null) return null;
		total += h;
	}
	return Math.round(total * 100) / 100;
}

/** "07:00 – 13:00, 18:00 – 04:00" für Ausdruck und PDF */
export function timeRangeLabel(ranges: readonly TimeRange[] | null | undefined): string {
	return normalizeRanges(ranges)
		.map((r) => [r.from, r.to].filter(Boolean).join(' – '))
		.join(', ');
}

/** Höchstens so viele Baustellen (mit Kostenstelle) an einem Tag */
export const MAX_PLACES = 5;

/**
 * Mehrere Baustellen bzw. Kostenstellen eines Tages stehen zeilenweise im
 * selben Feld – Zeile 1 der Baustelle gehört zu Zeile 1 der Kostenstelle.
 * Hier nur die ausgefüllten, ohne Leerzeichen am Rand.
 */
export function entryLines(value: string | null | undefined): string[] {
	return String(value ?? '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
}

/** Die Paare Baustelle – Kostenstelle eines Tages; mindestens eines (zum Ausfüllen) */
export function placesOf(site: string | null | undefined, costCenter: string | null | undefined): { site: string; costCenter: string }[] {
	const sites = String(site ?? '').split('\n');
	const costs = String(costCenter ?? '').split('\n');
	const pairs = Array.from({ length: Math.max(sites.length, costs.length) }, (_, i) => ({ site: (sites[i] ?? '').trim(), costCenter: (costs[i] ?? '').trim() }));
	const used = pairs.filter((p) => p.site || p.costCenter).slice(0, MAX_PLACES);
	return used.length ? used : [{ site: '', costCenter: '' }];
}

/** Zurück in die beiden Felder – leere Paare fallen weg */
export function joinPlaces(places: readonly { site: string; costCenter: string }[]): { site: string; costCenter: string } {
	const used = places.map((p) => ({ site: p.site.trim(), costCenter: p.costCenter.trim() })).filter((p) => p.site || p.costCenter).slice(0, MAX_PLACES);
	const join = (key: 'site' | 'costCenter') => (used.some((p) => p[key]) ? used.map((p) => p[key]).join('\n') : '');
	return { site: join('site'), costCenter: join('costCenter') };
}

/**
 * Kostenstelle für Ausdruck und PDF: Was nach dem ersten „/" kommt, steht in
 * einer zweiten Zeile – "24117/Halle 3" wird zu "24117/" und "Halle 3".
 * Mehrere Kostenstellen am Tag stehen je in einer eigenen Zeile.
 */
export function costCenterLines(value: string | null | undefined): string[] {
	const lines = entryLines(value);
	if (lines.length > 1) return lines;
	const text = lines[0] ?? '';
	const cut = text.indexOf('/');
	if (cut < 0) return text ? [text] : [];
	const rest = text.slice(cut + 1).trim();
	return rest ? [text.slice(0, cut + 1).trim(), rest] : [text];
}

/** Uhrzeit "7:30" oder "0730" auf "07:30" bringen; ungültiges wird leer */
export function parseTime(input: string | null | undefined): string {
	const s = String(input ?? '').trim();
	if (!s) return '';
	const m = s.match(/^(\d{1,2})[:.]?(\d{2})$/);
	if (!m) return '';
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return '';
	return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
