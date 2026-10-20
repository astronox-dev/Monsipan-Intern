import { describe, expect, it } from 'vitest';
import { cmLabel, crossingLayout, metersToCm, mLabel, parkingLayouts } from './rechner';

describe('Parkordnung', () => {
	it('teilt in Strich 2 m und Lücke 1 m, Anfang und Ende gleich lang', () => {
		// 150 + 100 + 200 + 100 + 200 + 100 + 150 = 10 m
		expect(parkingLayouts(1000)).toEqual([{ end: 150, inner: 2, strokes: 4, gaps: 3, marked: 700 }]);
		expect(parkingLayouts(600)).toEqual([{ end: 100, inner: 1, strokes: 3, gaps: 2, marked: 400 }]);
		expect(parkingLayouts(1035)[0].end).toBe(167.5);
	});

	it('hält die Enden zwischen 50 cm und 2 m – für jede Länge ab 2 m gibt es eine Einteilung', () => {
		for (let length = 200; length <= 5000; length += 7) {
			const layouts = parkingLayouts(length);
			expect(layouts.length, `bei ${length} cm`).toBeGreaterThan(0);
			for (const l of layouts) {
				expect(l.end).toBeGreaterThanOrEqual(50);
				expect(l.end).toBeLessThanOrEqual(200);
				expect(2 * l.end + l.inner * 200 + l.gaps * 100).toBeCloseTo(length, 6);
			}
		}
	});

	it('liegt ein Ende genau auf der Grenze, gibt es beide Einteilungen – die längeren Enden zuerst', () => {
		// 2 m + 1 m + 2 m … oder 50 cm mit einem Strich mehr
		expect(parkingLayouts(1100).map((l) => l.end)).toEqual([200, 50]);
	});

	it('unter 2 m geht es sich nicht aus', () => {
		expect(parkingLayouts(199)).toEqual([]);
		expect(parkingLayouts(200)).toEqual([{ end: 50, inner: 0, strokes: 2, gaps: 1, marked: 100 }]);
		expect(parkingLayouts(0)).toEqual([]);
	});
});

describe('Schutzweg', () => {
	it('Riegel und Lücken je 50 cm, zum Randstein 25 bis 50 cm', () => {
		expect(crossingLayout(650).exact).toEqual({ bars: 6, edge: 50, gap: 50 });
		expect(crossingLayout(600).exact).toEqual({ bars: 6, edge: 25, gap: 50 });
		expect(crossingLayout(625).exact).toEqual({ bars: 6, edge: 37.5, gap: 50 });
		expect(crossingLayout(120).exact).toEqual({ bars: 1, edge: 35, gap: 50 });
	});

	it('geht es sich mit 50 cm Lücken nicht aus, stehen die Abstände daneben und die angepasste Lücke', () => {
		const r = crossingLayout(670);
		expect(r.exact).toBeNull();
		expect(r.off).toEqual([
			{ bars: 6, edge: 60, gap: 50 },
			{ bars: 7, edge: 10, gap: 50 }
		]);
		expect(r.adjusted).toEqual([
			{ bars: 6, edge: 50, gap: 54 },
			{ bars: 7, edge: 25, gap: 45 }
		]);
		// Angepasst geht es genau auf
		for (const a of r.adjusted) expect(2 * a.edge + a.bars * 50 + (a.bars - 1) * a.gap).toBeCloseTo(670, 6);
	});

	it('für jede Breite: entweder genau nach Vorgabe oder mit angepasster Lücke', () => {
		for (let width = 100; width <= 3000; width += 3) {
			const r = crossingLayout(width);
			if (r.exact) {
				expect(r.exact.edge).toBeGreaterThanOrEqual(25);
				expect(r.exact.edge).toBeLessThanOrEqual(50);
				expect(2 * r.exact.edge + r.exact.bars * 50 + (r.exact.bars - 1) * 50).toBeCloseTo(width, 6);
			} else {
				expect(r.off.length, `bei ${width} cm`).toBeGreaterThan(0);
			}
		}
	});

	it('zu schmal gibt nichts', () => {
		expect(crossingLayout(0)).toEqual({ exact: null, off: [], adjusted: [] });
		expect(crossingLayout(40).exact).toBeNull();
	});
});

describe('Eingabe und Anzeige', () => {
	it('liest Meter mit Komma oder Punkt', () => {
		expect(metersToCm('12,35')).toBe(1235);
		expect(metersToCm('6.7')).toBe(670);
		expect(metersToCm(' 45 m ')).toBe(4500);
		expect(metersToCm('1,2345')).toBe(123.5);
		expect(metersToCm('')).toBeNull();
		expect(metersToCm('abc')).toBeNull();
		expect(metersToCm('-3')).toBeNull();
	});

	it('zeigt Zentimeter und Meter', () => {
		expect(cmLabel(37.5)).toBe('37,5 cm');
		expect(cmLabel(50)).toBe('50 cm');
		expect(mLabel(167.5)).toBe('1,675 m');
		expect(mLabel(700)).toBe('7,00 m');
	});
});
