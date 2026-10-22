import { describe, expect, it } from 'vitest';
import { employedDays, employmentState, hoursToDays, leaveAccount, weeklyAccrual } from './konto';

describe('Urlaubskonto', () => {
	it('erwirbt je Beschäftigungswoche: 5 Wochen × 39 Std. ÷ 52', () => {
		expect(weeklyAccrual(5, 39)).toBe(3.75);
		expect(weeklyAccrual(6, 39)).toBe(4.5);
	});

	it('zählt nur die Tage, an denen jemand angemeldet ist – bis heute', () => {
		const season = [{ from: '2026-03-02', to: '2026-12-18' }];
		// 2. März bis 30. Juni: 121 Tage
		expect(employedDays(season, '2026-06-30')).toBe(121);
		// Ganze Saison, im Winter abgemeldet: 292 Tage, danach nichts mehr
		expect(employedDays(season, '2027-01-15')).toBe(292);
		// Im Frühjahr wieder angemeldet
		expect(employedDays([...season, { from: '2027-03-01', to: null }], '2027-03-14')).toBe(306);
		// Ab dem Stichtag
		expect(employedDays(season, '2026-06-30', '2026-06-01')).toBe(30);
		expect(employedDays([{ from: '2027-03-01', to: null }], '2026-12-31')).toBe(0);
	});

	it('Rest = Übertrag + erworben − genehmigt', () => {
		const a = { periods: [{ from: '2026-01-01', to: null }], carryover: 20, start: null, rate: 3.75 };
		// 1.1. bis 31.12.2026: 365 Tage ÷ 7 × 3,75
		expect(leaveAccount(a, 0, '2026-12-31')).toEqual({ carryover: 20, earned: 195.54, used: 0, rest: 215.54 });
		expect(leaveAccount(a, 39, '2026-01-28')).toEqual({ carryover: 20, earned: 15, used: 39, rest: -4 });
	});

	it('weiß, ob jemand angemeldet ist', () => {
		const periods = [
			{ from: '2026-03-02', to: '2026-12-18' },
			{ from: '2027-03-01', to: null }
		];
		expect(employmentState(periods, '2026-07-01')).toEqual({ state: 'angemeldet', date: '2026-03-02' });
		expect(employmentState(periods, '2027-01-10')).toEqual({ state: 'ab', date: '2027-03-01' });
		expect(employmentState([periods[0]], '2027-01-10')).toEqual({ state: 'abgemeldet', date: '2026-12-19' });
		expect(employmentState([], '2027-01-10')).toBeNull();
	});

	it('rechnet ungefähr in Tage um', () => {
		expect(hoursToDays(39, 39)).toBe(5);
		expect(hoursToDays(120, 39)).toBe(15.4);
	});
});
