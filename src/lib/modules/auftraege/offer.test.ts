import { describe, expect, it } from 'vitest';
import {
	amountInput,
	discountFrom,
	discountInput,
	discountOf,
	invoiceNo,
	lineNumbers,
	money,
	nextOfferNumber,
	offerState,
	nextProjectNumber,
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
	it('zählt ohne Überschriften 1.1, 1.2 …', () => {
		expect(lineNumbers([pos(1, 1), pos(1, 1), pos(1, 1)])).toEqual(['1.1', '1.2', '1.3']);
	});

	it('beginnt mit jeder Überschrift eine neue Gruppe', () => {
		expect(lineNumbers([titel, pos(1, 1), pos(1, 1), titel, pos(1, 1)])).toEqual(['1', '1.1', '1.2', '2', '2.1']);
		expect(lineNumbers([pos(1, 1), titel, pos(1, 1)])).toEqual(['1.1', '2', '2.1']);
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

	it('schlägt die nächste Angebots- und Projektnummer vor', () => {
		expect(nextOfferNumber(['26659', '26841', 'X1'], 2026)).toBe('26842');
		expect(nextOfferNumber([], 2026)).toBe('26001');
		// Neues Jahr: die Zählung beginnt wieder von vorn
		expect(nextOfferNumber(['25682', '26841'], 2027)).toBe('27001');
		expect(nextOfferNumber(['25999', '25998'], 2026)).toBe('26001');
		expect(nextOfferNumber(['26999'], 2026)).toBe('261000');
		expect(nextProjectNumber(['26-00785', '26-01074', '25-09999'], 2026)).toBe('26-01075');
		expect(nextProjectNumber(['25-00012'], 2026)).toBe('26-00001');
	});
});
