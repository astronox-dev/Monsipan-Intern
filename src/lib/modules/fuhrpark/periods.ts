/** Die Zeiträume für Statistik und Ablauf: Tage zurück ab heute */
import { addDays } from '$lib/modules/stunden/week';

export const PERIODS = [
	{ key: 'heute', label: 'Heute', from: 0, to: 0 },
	{ key: 'gestern', label: 'Gestern', from: 1, to: 1 },
	{ key: 'woche', label: '7 Tage', from: 6, to: 0 },
	{ key: 'monat', label: '30 Tage', from: 29, to: 0 }
];

export type Period = (typeof PERIODS)[number];

export const periodByKey = (key: string | null) => PERIODS.find((p) => p.key === key) ?? null;

export const periodRange = (p: Period, today: string) => ({ from: addDays(today, -p.from), to: addDays(today, -p.to) });

/** Welcher Zeitraum genau diese Tage abdeckt – für den Reiter, auch wenn sie von Hand gewählt sind */
export function periodOf(from: string, to: string, today: string): string | null {
	return PERIODS.find((p) => {
		const r = periodRange(p, today);
		return r.from === from && r.to === to;
	})?.key ?? null;
}
