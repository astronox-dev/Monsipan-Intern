import { describe, expect, it } from 'vitest';
import { amountInput, invoiceNo, lineNumbers, money, nextOfferNumber, offerState, nextProjectNumber, offerTotals, parseAmount, spacedNumber } from './offer';

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
		expect(t).toEqual({ net: 1035.83, vat: 207.17, gross: 1243 });
	});

	it('übergeht Positionen ohne Menge oder Preis', () => {
		expect(offerTotals([pos(null, 10), pos(3, null)], 20)).toEqual({ net: 0, vat: 0, gross: 0 });
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
