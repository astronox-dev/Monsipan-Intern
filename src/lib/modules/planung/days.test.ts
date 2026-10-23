import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LEAVE_HOURS,
	easterSunday,
	holidayName,
	hoursText,
	isWorkday,
	leaveDays,
	leaveUsage,
	overlaps,
	rangeLabel,
	sickSpells,
	termDays,
	validLeaveHours,
	workdays
} from './days';

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

describe('Urlaub in Stunden', () => {
	const H = [8, 8, 8, 8, 7, 0, 0];

	it('verbraucht je Wochentag die eingestellten Stunden, Feiertage nicht', () => {
		// Mo 19.10. – So 25.10.2026: 4 × 8 + 7
		expect(leaveUsage('2026-10-19', '2026-10-25', H, [])).toMatchObject({ days: 5, hours: 39, sickDays: 0 });
		// Mo 26.10. ist Nationalfeiertag
		expect(leaveDays('2026-10-26', '2026-10-30', H).map((d) => d.hours)).toEqual([8, 8, 8, 7]);
		// Samstag nur mit Stunden
		expect(leaveDays('2026-10-24', '2026-10-24', H)).toEqual([]);
		expect(leaveDays('2026-10-24', '2026-10-24', [8, 8, 8, 8, 7, 4.5, 0])).toEqual([{ date: '2026-10-24', hours: 4.5 }]);
	});

	it('Krankenstand von mehr als drei Tagen unterbricht den Urlaub', () => {
		// Krank Mi 21. – Sa 24.10. (4 Tage): Mi, Do, Fr zählen nicht – 23 Stunden zurück
		const u = leaveUsage('2026-10-19', '2026-10-23', H, [{ from: '2026-10-21', to: '2026-10-24' }]);
		expect(u).toMatchObject({ days: 2, hours: 16, sickDays: 3, sickHours: 23 });
		expect(u.interruptions).toEqual([{ from: '2026-10-21', to: '2026-10-23' }]);
		// Schon vorher krank und noch offen: ab Urlaubsbeginn bis zum Ende
		expect(leaveUsage('2026-10-19', '2026-10-23', H, [{ from: '2026-10-15', to: null }], '2026-10-20')).toMatchObject({
			days: 0,
			hours: 0,
			sickDays: 5,
			sickHours: 39,
			interruptions: [{ from: '2026-10-19', to: '2026-10-23' }]
		});
		// Krankenstand außerhalb zählt nicht
		expect(leaveUsage('2026-10-19', '2026-10-23', H, [{ from: '2026-10-26', to: '2026-10-29' }]).interruptions).toEqual([]);
	});

	it('bis zu drei Tage krank: der Urlaub läuft weiter', () => {
		// Mi 21. – Fr 23.10.: genau drei Kalendertage
		expect(leaveUsage('2026-10-19', '2026-10-23', H, [{ from: '2026-10-21', to: '2026-10-23' }])).toMatchObject({ days: 5, hours: 39, sickDays: 0, interruptions: [] });
		// Noch offen, aber bis heute erst zwei Tage – (noch) keine Unterbrechung
		expect(leaveUsage('2026-10-19', '2026-10-23', H, [{ from: '2026-10-21', to: null }], '2026-10-22')).toMatchObject({ days: 5, sickDays: 0 });
		expect(leaveUsage('2026-10-19', '2026-10-23', H, [{ from: '2026-10-21', to: null }], '2026-10-24')).toMatchObject({ days: 2, sickDays: 3 });
	});

	it('aneinander anschließende Meldungen sind ein Krankenstand', () => {
		const sick = [
			{ from: '2026-10-23', to: '2026-10-24' },
			{ from: '2026-10-21', to: '2026-10-22' }
		];
		expect(sickSpells(sick)).toEqual([{ from: '2026-10-21', to: '2026-10-24', days: 4, interrupts: true }]);
		expect(leaveUsage('2026-10-19', '2026-10-23', H, sick)).toMatchObject({ days: 2, sickDays: 3, interruptions: [{ from: '2026-10-21', to: '2026-10-23' }] });
		// Mit einem Tag Pause: zwei kurze
		expect(
			sickSpells([
				{ from: '2026-10-19', to: '2026-10-20' },
				{ from: '2026-10-22', to: '2026-10-23' }
			]).map((s) => s.interrupts)
		).toEqual([false, false]);
	});

	it('nimmt nur gültige Wochenstunden', () => {
		expect(validLeaveHours([8, 8, 8, 8, 7.5, 0, 0])).toEqual([8, 8, 8, 8, 7.5, 0, 0]);
		expect(validLeaveHours([8, 8])).toEqual([...DEFAULT_LEAVE_HOURS]);
		expect(validLeaveHours([8, 8, 8, 8, 30, 0, 0])).toEqual([...DEFAULT_LEAVE_HOURS]);
		expect(validLeaveHours(null)).toEqual([...DEFAULT_LEAVE_HOURS]);
		expect(hoursText(7.5)).toBe('7,5 Std.');
	});
});

describe('Tage eines Termins', () => {
	it('Arbeitstage dazwischen, erster und letzter Tag immer', () => {
		// Fr 23.10., Wochenende und Nationalfeiertag (Mo 26.10.) fallen weg
		expect(termDays('2026-10-23', '2026-10-27')).toEqual(['2026-10-23', '2026-10-27']);
		expect(termDays('2026-10-19', '2026-10-21')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
		// Ausdrücklich am Samstag
		expect(termDays('2026-10-24', '')).toEqual(['2026-10-24']);
		expect(termDays('2026-10-22', '2026-10-24')).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
		// Ende vor dem Anfang zählt nicht, ohne gültigen Anfang gibt es nichts
		expect(termDays('2026-10-21', '2026-10-19')).toEqual(['2026-10-21']);
		expect(termDays('', '2026-10-19')).toEqual([]);
		expect(termDays('2026-01-01', '2026-12-31')).toHaveLength(60);
	});
});
