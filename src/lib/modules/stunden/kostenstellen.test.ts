import { describe, expect, it } from 'vitest';
import { costCenterKey, sumByCostCenter, type CostCenterDay } from './kostenstellen';

const day = (costCenter: string, date: string, normal: number, userId: number, party: string | null, o50 = 0, o100 = 0): CostCenterDay => ({
	costCenter,
	date,
	normal,
	o50,
	o100,
	userId,
	party
});

describe('Kostenstellen', () => {
	it('fasst Schreibweisen zusammen', () => {
		expect(costCenterKey(' 24117 ')).toBe('24117');
		expect(costCenterKey('24 117')).toBe('24117');
		expect(costCenterKey('24117 / Halle  3')).toBe('24117/halle 3');
		expect(costCenterKey('Lager')).toBe(costCenterKey('lager'));
		expect(costCenterKey(null)).toBe('');
	});

	it('summiert alle Partien je Kostenstelle – Norm und Überstunden', () => {
		const rows = sumByCostCenter([
			day('24117', '2026-10-19', 8, 1, 'Nord', 1.5),
			day('24117 ', '2026-10-19', 8, 2, 'Nord'),
			day('24 117', '2026-10-20', 7.5, 3, 'Süd', 0, 2),
			day('Lager', '2026-10-21', 4, 1, 'Nord'),
			day('9526053', '2026-10-22', 9, 2, null),
			day('', '2026-10-23', 6, 3, 'Süd')
		]);
		// Nach Kostenstelle, Zahlen der Größe nach, ohne Kostenstelle am Ende
		expect(rows.map((r) => r.label)).toEqual(['24117', '9526053', 'Lager', '']);
		expect(rows[0]).toMatchObject({ key: '24117', normal: 23.5, o50: 1.5, o100: 2, total: 27, days: 2, people: 3, first: '2026-10-19', last: '2026-10-20' });
		expect(rows[0].parties).toEqual([
			{ name: 'Nord', hours: 17.5 },
			{ name: 'Süd', hours: 9.5 }
		]);
		expect(rows[1].parties).toEqual([{ name: '', hours: 9 }]);
		expect(rows[3]).toMatchObject({ key: '', total: 6 });
	});

	it('nimmt die häufigste Schreibweise als Namen', () => {
		const [r] = sumByCostCenter([day('halle 3', '2026-10-19', 8, 1, null), day('Halle 3', '2026-10-20', 8, 1, null), day('Halle 3', '2026-10-21', 8, 1, null)]);
		expect(r.label).toBe('Halle 3');
	});
});
