import { describe, expect, it } from 'vitest';
import {
	amountInput,
	discountFrom,
	discountInput,
	discountOf,
	invoiceNo,
	canBeSub,
	effectiveSub,
	lineNumbers,
	money,
	moveItem,
	nextLineNumber,
	offerState,
	offerTotals,
	parseAmount,
	readDiscount,
	spacedNumber,
	sumRows
} from './offer';

const pos = (quantity: number | null, unitPrice: number | null) => ({ kind: 'position' as const, quantity, unitPrice });
const titel = { kind: 'titel' as const, quantity: null };

describe('Beträge', () => {
	it('liest Beträge in allen üblichen Schreibweisen', () => {
		expect(parseAmount('1.234,56')).toBe(1234.56);
		expect(parseAmount('1234,5')).toBe(1234.5);
		expect(parseAmount('12.5')).toBe(12.5);
		expect(parseAmount('1.234')).toBe(1234);
		expect(parseAmount('€ 2 500,00')).toBe(2500);
		expect(parseAmount('')).toBeNull();
		expect(parseAmount('abc')).toBeNull();
	});

	it('schreibt Euro und Eingabewerte österreichisch', () => {
		expect(money(1234.5)).toMatch(/1\.234,50/);
		expect(money(null)).toBe('');
		expect(amountInput(1234.5)).toBe('1234,50');
	});
});

describe('offerTotals', () => {
	it('rechnet Netto, Umsatzsteuer und Gesamt auf Cent', () => {
		const t = offerTotals([pos(1, 450), pos(250, 1.85), titel, pos(10, 12.333)], 20);
		// 450 + 462,50 + 123,33
		expect(t).toEqual({ net: 1035.83, discount: 0, taxable: 1035.83, vat: 207.17, gross: 1243 });
	});

	it('übergeht Positionen ohne Menge oder Preis', () => {
		expect(offerTotals([pos(null, 10), pos(3, null)], 20)).toMatchObject({ net: 0, vat: 0, gross: 0 });
	});
});

describe('Nachlass', () => {
	it('geht vor der Umsatzsteuer ab – in Prozent oder als Betrag', () => {
		// 10.000 netto, 5 % Nachlass: 9.500, darauf 20 %
		expect(offerTotals([pos(1, 10000)], 20, false, { discountPercent: 5 })).toEqual({ net: 10000, discount: 500, taxable: 9500, vat: 1900, gross: 11400 });
		expect(offerTotals([pos(1, 10000)], 20, false, { discountAmount: 250 })).toMatchObject({ discount: 250, taxable: 9750, gross: 11700 });
		// Übergang der Steuerschuld: ohne Umsatzsteuer
		expect(offerTotals([pos(1, 1000)], 20, true, { discountPercent: 10 })).toMatchObject({ taxable: 900, vat: 0, gross: 900 });
		// Prozent auf Cent gerundet, nie mehr als die Summe, Stornorechnung mit Vorzeichen
		expect(discountOf(1035.83, { discountPercent: 3 })).toBe(31.07);
		expect(discountOf(100, { discountAmount: 250 })).toBe(100);
		expect(discountOf(-10000, { discountPercent: 5 })).toBe(-500);
		expect(discountOf(-10000, { discountAmount: 250 })).toBe(-250);
		expect(discountOf(100, {})).toBe(0);
	});

	it('steht zwischen Netto und Umsatzsteuer – nur, wenn einer gewährt wird', () => {
		const d = { discountPercent: 5 };
		const rows = sumRows(offerTotals([pos(1, 10000)], 20, false, d), 20, false, d);
		expect(rows.map((r) => r[0])).toEqual(['Gesamt Netto', 'abzüglich 5 % Nachlass', 'Netto nach Nachlass', '20 % Umsatzsteuer', 'Gesamtbetrag']);
		expect(rows[1][1]).toBe('− ' + money(500));
		expect(sumRows(offerTotals([pos(1, 100)], 20, false), 20, false, {}).map((r) => r[0])).toEqual(['Gesamt Netto', '20 % Umsatzsteuer', 'Gesamtbetrag']);
		expect(sumRows(offerTotals([pos(1, 100)], 20, false, { discountAmount: 10 }), 20, false, { discountAmount: 10 })[1][0]).toBe('abzüglich Nachlass');
	});

	it('kommt aus dem Formular und wieder hinein', () => {
		const read = (v: Record<string, string>) => readDiscount((k) => v[k] ?? '');
		expect(read({ nachlass: '5', nachlassart: 'prozent' })).toEqual({ discountPercent: 5, discountAmount: 0 });
		expect(read({ nachlass: '1.250,50', nachlassart: 'betrag' })).toEqual({ discountPercent: 0, discountAmount: 1250.5 });
		expect(read({})).toEqual({ discountPercent: 0, discountAmount: 0 });
		expect(read({ nachlass: '120', nachlassart: 'prozent' })).toHaveProperty('message');
		expect(read({ nachlass: 'viel' })).toHaveProperty('message');
		expect(discountInput({ discountAmount: 1250.5 })).toEqual({ value: '1250,50', kind: 'betrag' });
		expect(discountInput({ discountPercent: 2.5 })).toEqual({ value: '2,5', kind: 'prozent' });
		expect(discountFrom('2,5', 'prozent')).toEqual({ discountPercent: 2.5 });
	});
});

describe('lineNumbers', () => {
	const unter = { ...pos(1, 1), sub: true };

	it('zählt ohne Überschriften 1, 2, 3', () => {
		expect(lineNumbers([pos(1, 1), pos(1, 1), pos(1, 1)])).toEqual(['1', '2', '3']);
	});

	it('Unterpunkte nur nach Überschriften – danach geht es normal weiter', () => {
		// Pos. 1 normal, 2 Überschrift, 2.1 Unterposition, 3 wieder normal
		expect(lineNumbers([pos(1, 1), titel, unter, pos(1, 1)])).toEqual(['1', '2', '2.1', '3']);
		expect(lineNumbers([titel, unter, unter, titel, unter])).toEqual(['1', '1.1', '1.2', '2', '2.1']);
		// Eine Überschrift ohne Unterpositionen zählt wie eine Position
		expect(lineNumbers([titel, pos(1, 1), pos(1, 1)])).toEqual(['1', '2', '3']);
	});

	it('nach einer eigenständigen Position ist die Gruppe zu Ende', () => {
		// „Unterposition" ohne Überschrift davor zählt normal
		expect(lineNumbers([unter, titel, unter, pos(1, 1), unter])).toEqual(['1', '2', '2.1', '3', '4']);
		expect(effectiveSub([unter, titel, unter, pos(1, 1), unter])).toEqual([false, false, true, false, false]);
	});

	it('weiß, wo eine Unterposition möglich ist', () => {
		const lines = [pos(1, 1), titel, unter, pos(1, 1)];
		expect([0, 1, 2, 3].map((i) => canBeSub(lines, i))).toEqual([false, false, true, true]);
		expect(canBeSub([pos(1, 1), pos(1, 1)], 1)).toBe(false);
	});

	it('bisherige Zählung für ältere Angebote: 1.1, 1.2 …, jede Überschrift eine neue Gruppe', () => {
		expect(lineNumbers([pos(1, 1), pos(1, 1), pos(1, 1)], true)).toEqual(['1.1', '1.2', '1.3']);
		expect(lineNumbers([titel, pos(1, 1), pos(1, 1), titel, pos(1, 1)], true)).toEqual(['1', '1.1', '1.2', '2', '2.1']);
		expect(lineNumbers([pos(1, 1), titel, pos(1, 1)], true)).toEqual(['1.1', '2', '2.1']);
	});

	it('schlägt die nächste Nummer vor', () => {
		expect(nextLineNumber('2.1')).toBe('2.2');
		expect(nextLineNumber('3')).toBe('4');
		expect(nextLineNumber('1.9')).toBe('1.10');
		expect(nextLineNumber('')).toBe('');
	});

	it('verschiebt Zeilen', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
		expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
		expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
	});
});

describe('Nummern', () => {
	it('schreibt die Angebotsnummer mit Abstand', () => {
		expect(spacedNumber('26659')).toBe('26 659');
		expect(spacedNumber('A-12')).toBe('A-12');
		expect(spacedNumber('26659-2')).toBe('26 659-2');
	});

	it('hängt an die Rechnungsnummer die Kostenstelle an', () => {
		expect(invoiceNo({ number: '42041', costCenter: '9526053' })).toBe('42 041/9526053');
		expect(invoiceNo({ number: '26659-2', costCenter: '' })).toBe('26 659-2');
	});

	it('nennt ein angenommenes, abgerechnetes Angebot „abgerechnet“', () => {
		expect(offerState({ status: 'angenommen', billedAt: new Date() })).toBe('abgerechnet');
		expect(offerState({ status: 'angenommen', billedAt: null })).toBe('angenommen');
		expect(offerState({ status: 'freigegeben', billedAt: new Date() })).toBe('freigegeben');
	});
});
