import { describe, expect, it } from 'vitest';
import { easterSunday, holidayName, isWorkday, overlaps, rangeLabel, workdays } from './days';

describe('Feiertage', () => {
	it('kennt Ostern', () => {
		expect(easterSunday(2026)).toBe('2026-04-05');
		expect(easterSunday(2027)).toBe('2027-03-28');
		expect(easterSunday(2024)).toBe('2024-03-31');
	});

	it('kennt feste und bewegliche Feiertage', () => {
		expect(holidayName('2026-10-26')).toBe('Nationalfeiertag');
		expect(holidayName('2026-04-06')).toBe('Ostermontag');
		expect(holidayName('2026-05-14')).toBe('Christi Himmelfahrt');
		expect(holidayName('2026-05-25')).toBe('Pfingstmontag');
		expect(holidayName('2026-06-04')).toBe('Fronleichnam');
		// Karfreitag ist seit 2019 kein gesetzlicher Feiertag mehr
		expect(holidayName('2026-04-03')).toBeNull();
	});
});

describe('Arbeitstage', () => {
	it('zählt Montag bis Freitag ohne Feiertage', () => {
		// Mo 19.10. – So 25.10.2026: fünf Arbeitstage
		expect(workdays('2026-10-19', '2026-10-25')).toBe(5);
		// Mo 26.10. ist Nationalfeiertag
		expect(workdays('2026-10-26', '2026-10-30')).toBe(4);
		expect(isWorkday('2026-10-24')).toBe(false);
		expect(workdays('2026-10-30', '2026-10-19')).toBe(0);
	});

	it('schreibt Zeiträume kurz', () => {
		expect(rangeLabel('2026-10-19', '2026-10-23')).toBe('19.10. – 23.10.2026');
		expect(rangeLabel('2026-10-19', null)).toBe('19.10.2026');
		expect(rangeLabel('2026-12-28', '2027-01-08')).toBe('28.12.2026 – 08.01.2027');
	});

	it('erkennt Überschneidungen, auch mit offenem Ende', () => {
		expect(overlaps('2026-10-19', '2026-10-23', '2026-10-23', '2026-10-30')).toBe(true);
		expect(overlaps('2026-10-19', '2026-10-23', '2026-10-24', null)).toBe(false);
		expect(overlaps('2026-10-19', null, '2026-12-01', '2026-12-02')).toBe(true);
	});
});
