import { describe, expect, it } from 'vitest';
import {
	addDays,
	costCenterLines,
	entryLines,
	joinPlaces,
	placesOf,
	hoursLabel,
	isoWeek,
	mondayOf,
	monthLabel,
	monthsOfWeek,
	parseHours,
	parseTime,
	segmentLabel,
	weekDays,
	weekDaysInMonth,
	weekLabel
} from './week';

describe('Lohnwoche', () => {
	it('findet den Montag der Woche', () => {
		expect(mondayOf('2026-10-02')).toBe('2026-09-28'); // Freitag
		expect(mondayOf('2026-09-28')).toBe('2026-09-28'); // Montag selbst
		expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // Sonntag gehört noch dazu
	});

	it('zählt Tage auch über Monats- und Jahreswechsel', () => {
		expect(addDays('2026-12-28', 6)).toBe('2027-01-03');
		expect(weekDays('2026-12-28').at(-1)).toBe('2027-01-03');
	});

	it('rechnet die Kalenderwoche nach ISO', () => {
		expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
		expect(isoWeek('2026-09-28').week).toBe(40);
		// 1. Jänner 2027 ist ein Freitag und gehört noch zur KW 53 von 2026
		expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
	});

	it('beschriftet die Woche für den Kopf des Zettels', () => {
		expect(weekLabel('2026-09-28')).toBe('KW 40 · 28.09.–04.10.2026');
	});

	it('erkennt Wochen über den Monatswechsel', () => {
		// KW 40 2026 läuft von Montag 28.09. bis Sonntag 04.10.
		expect(monthsOfWeek('2026-09-28')).toEqual(['2026-09', '2026-10']);
		expect(weekDaysInMonth('2026-09-28', '2026-09')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
		expect(weekDaysInMonth('2026-09-28', '2026-10')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
	});

	it('lässt Wochen innerhalb eines Monats ungeteilt', () => {
		expect(monthsOfWeek('2026-10-05')).toEqual(['2026-10']);
		expect(weekDaysInMonth('2026-10-05', '2026-10')).toHaveLength(7);
	});

	it('beschriftet Monat und Monatsteil', () => {
		expect(monthLabel('2026-09')).toBe('September 2026');
		expect(segmentLabel('2026-09-28', '2026-09')).toBe('28.09.–30.09.2026');
		expect(segmentLabel('2026-09-28', '2026-10')).toBe('01.10.–04.10.2026');
		// Ein einzelner Tag braucht keinen Bindestrich
		expect(segmentLabel('2026-11-30', '2026-11')).toBe('30.11.2026');
	});

	it('liest Stunden deutsch und als Uhrzeit', () => {
		expect(parseHours('8,5')).toBe(8.5);
		expect(parseHours('8.5')).toBe(8.5);
		expect(parseHours('8:30')).toBe(8.5);
		expect(parseHours('')).toBe(0);
		expect(parseHours('abc')).toBe(0);
		expect(parseHours('-3')).toBe(0);
		expect(parseHours('99')).toBe(24);
		expect(hoursLabel(8.5)).toBe('8,5');
		expect(hoursLabel(0)).toBe('');
	});

	it('bringt Uhrzeiten in eine Form', () => {
		expect(parseTime('7:30')).toBe('07:30');
		expect(parseTime('0730')).toBe('07:30');
		expect(parseTime('16.00')).toBe('16:00');
		expect(parseTime('25:00')).toBe('');
		expect(parseTime('')).toBe('');
	});
});

describe('Kostenstelle', () => {
	it('bricht nach dem ersten Schrägstrich in eine zweite Zeile um', () => {
		expect(costCenterLines('24117/Halle 3')).toEqual(['24117/', 'Halle 3']);
		expect(costCenterLines('A / B / C')).toEqual(['A /', 'B / C']);
	});
	it('lässt alles ohne Schrägstrich in einer Zeile', () => {
		expect(costCenterLines('24117')).toEqual(['24117']);
		expect(costCenterLines('24117/')).toEqual(['24117/']);
		expect(costCenterLines('  ')).toEqual([]);
		expect(costCenterLines(null)).toEqual([]);
		// Mehrere Kostenstellen am Tag: je eine Zeile
		expect(costCenterLines('24117\nLager')).toEqual(['24117', 'Lager']);
	});

	it('mehrere Baustellen am Tag – zeilenweise, paarweise mit der Kostenstelle', () => {
		expect(placesOf('Halle\nLager', '24117')).toEqual([
			{ site: 'Halle', costCenter: '24117' },
			{ site: 'Lager', costCenter: '' }
		]);
		expect(placesOf('', '')).toEqual([{ site: '', costCenter: '' }]);
		// Leere Paare fallen weg, die Zuordnung bleibt
		expect(
			joinPlaces([
				{ site: 'A', costCenter: '' },
				{ site: ' ', costCenter: '' },
				{ site: 'B', costCenter: ' 2 ' }
			])
		).toEqual({ site: 'A\nB', costCenter: '\n2' });
		expect(joinPlaces([{ site: 'A', costCenter: '' }])).toEqual({ site: 'A', costCenter: '' });
		expect(placesOf('A\nB', '\n2')).toEqual([
			{ site: 'A', costCenter: '' },
			{ site: 'B', costCenter: '2' }
		]);
		expect(entryLines(' A \n\n B ')).toEqual(['A', 'B']);
	});
});
