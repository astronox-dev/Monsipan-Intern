import { describe, expect, it } from 'vitest';
import { billedLines, columnKey, columnLabel, invoiceLines, OWN_LINE, OWN_LINES_TITLE, nextInvoiceNumber, selectedColumns, selectedPeriod, suggestKind, suggestMapping, summarize, unitFamily, type PricedLine, type SummaryReportInput } from './summary';

const report = (over: Partial<SummaryReportInput>): SummaryReportInput => ({
	id: 1,
	number: '1',
	date: '2026-10-05',
	dateTo: null,
	site: 'B 17',
	partyName: 'Partie 1',
	status: 'geprueft',
	positions: [],
	rows: [],
	...over
});

describe('summarize', () => {
	const sum = summarize([
		report({
			id: 2,
			number: '12',
			date: '2026-10-06',
			dateTo: '2026-10-08',
			positions: [
				{ lbPos: '01.02.01', unit: 'm' },
				{ lbPos: '01.05', unit: 'm²' }
			],
			rows: [{ quantities: [100, 4] }, { quantities: [50.5, null] }],
			materials: [{ material: 'Weiß', code: 'K-12', filmThickness: '0,6' }]
		}),
		report({
			id: 1,
			number: '11',
			positions: [{ lbPos: ' 01.02.01 ', unit: 'M' }],
			rows: [{ quantities: [20] }],
			materials: [{ material: 'weiß', code: 'k-12', filmThickness: '0,6' }]
		}),
		// In Arbeit: steht dabei, zählt aber nicht
		report({ id: 3, number: '13', status: 'entwurf', date: '2026-10-09', positions: [{ lbPos: '01.02.01', unit: 'm' }], rows: [{ quantities: [999] }] })
	]);

	it('zählt je LB-Position und Einheit zusammen', () => {
		// Geschrieben wird die Spalte wie im ersten Bericht – „M" statt „m"
		expect(sum.columns).toEqual([
			{ key: '01.02.01|m', lbPos: '01.02.01', unit: 'M', label: '', slot: null, total: 170.5 },
			{ key: '01.05|m²', lbPos: '01.05', unit: 'm²', label: '', slot: null, total: 4 }
		]);
	});

	it('nimmt nur geprüfte und abgeschlossene Berichte in die Summe', () => {
		expect(sum.counted).toBe(2);
		expect(sum.reports.map((r) => [r.number, r.counted])).toEqual([
			['11', true],
			['12', true],
			['13', false]
		]);
		expect(sum.reports[2].values['01.02.01|m']).toBe(999);
	});

	it('liefert Zeitraum und Material ohne Doppelte', () => {
		expect([sum.from, sum.to]).toEqual(['2026-10-05', '2026-10-08']);
		expect(sum.materials).toHaveLength(1);
	});

	it('sortiert LB-Positionen nach Zahlen, nicht nach Text', () => {
		const s = summarize([report({ positions: [{ lbPos: '01.10', unit: 'm' }, { lbPos: '01.9', unit: 'm' }], rows: [{ quantities: [1, 1] }] })]);
		expect(s.columns.map((c) => c.lbPos)).toEqual(['01.9', '01.10']);
	});

	it('hält Spalten ohne LB-Position nach ihrer Stelle auseinander', () => {
		const lfm = [{ lbPos: '', unit: 'lfm' }, { lbPos: '', unit: 'lfm' }, { lbPos: '', unit: 'lfm' }];
		const s = summarize([
			report({ id: 1, positions: lfm, rows: [{ quantities: [100, 50, 20] }] }),
			report({ id: 2, positions: lfm, rows: [{ quantities: [10, null, 5] }] })
		]);
		expect(s.columns.map((c) => [c.key, c.slot, c.total])).toEqual([
			['|lfm#1', 1, 110],
			['|lfm#2', 2, 50],
			['|lfm#3', 3, 25]
		]);
		expect(s.columns.map(columnLabel)).toEqual(['Spalte 1', 'Spalte 2', 'Spalte 3']);
	});

	it('zählt ohne LB-Position nach der Bezeichnung der Zeile zusammen', () => {
		const lfm = [{ lbPos: '', unit: 'lfm' }];
		const s = summarize([
			report({ id: 1, positions: lfm, rows: [{ label: 'RRL 0,15 MSK C ref', quantities: [1000] }, { label: 'LL 0,15 MSK C ref', quantities: [3000] }] }),
			report({ id: 2, positions: lfm, rows: [{ label: 'rrl 0,15  MSK C ref', quantities: [150] }, { label: 'LRL 0,12 MSK C ref', quantities: [2000] }, { label: '', quantities: [7] }] })
		]);
		expect(s.columns.map((c) => [columnLabel(c), c.unit, c.total])).toEqual([
			['RRL 0,15 MSK C ref', 'lfm', 1150],
			['LL 0,15 MSK C ref', 'lfm', 3000],
			['LRL 0,12 MSK C ref', 'lfm', 2000],
			['Spalte 1', 'lfm', 7]
		]);
	});

	it('ohne Berichte bleibt alles leer', () => {
		expect(summarize([])).toEqual({ columns: [], reports: [], from: null, to: null, materials: [], counted: 0 });
	});
});

describe('Zuordnung und Rechnungszeilen', () => {
	const lines: PricedLine[] = [
		{ id: 10, kind: 'titel', text: 'Markierung', quantity: null, unit: '', unitPrice: null },
		{ id: 11, kind: 'position', text: 'Leitlinie 15 cm weiß, LB 01.02.01', quantity: 200, unit: 'lfd. m', unitPrice: 1.2 },
		{ id: 12, kind: 'position', text: 'Sperrflächen', quantity: 10, unit: 'm²', unitPrice: 14 },
		{ id: 13, kind: 'position', text: 'Pfeile', quantity: 5, unit: 'm²', unitPrice: 20 },
		{ id: 14, kind: 'titel', text: 'Sonstiges', quantity: null, unit: '', unitPrice: null },
		{ id: 15, kind: 'position', text: 'Baustelleneinrichtung', quantity: 1, unit: 'Pauschal', unitPrice: 350 },
		{ id: 16, kind: 'position', text: 'Regie', quantity: 4, unit: 'h', unitPrice: 55 }
	];
	const columns = [
		{ key: columnKey('01.02.01', 'm'), lbPos: '01.02.01', unit: 'm', label: '', slot: null, total: 170.5 },
		{ key: columnKey('01.05', 'm²'), lbPos: '01.05', unit: 'm²', label: '', slot: null, total: 4 }
	];

	it('schlägt über LB-Position im Text und eindeutige Einheit vor', () => {
		// m² passt auf zwei Positionen – da muss jemand wählen
		expect(suggestMapping(columns, lines, null)).toEqual({ '01.02.01|m': 11, '01.05|m²': undefined });
	});

	it('nimmt die gemerkte Zuordnung, auch „nicht abrechnen"', () => {
		expect(suggestMapping(columns, lines, { '01.02.01|m': null, '01.05|m²': 13 })).toEqual({ '01.02.01|m': null, '01.05|m²': 13 });
		// Eine gemerkte Position, die es nicht mehr gibt, zählt nicht
		expect(suggestMapping(columns, lines, { '01.05|m²': 99 })['01.05|m²']).toBeUndefined();
	});

	it('setzt Mengen aus den Berichten, Pauschalen aus dem Angebot', () => {
		const out = invoiceLines(lines, columns, { '01.02.01|m': 11, '01.05|m²': 12 });
		expect(out.map((l) => l.quantity)).toEqual([null, 170.5, 4, null, null, 1, null]);
		expect(out[1].source).toBe('01.02.01 (m)');
		expect(out[1].unitPrice).toBe(1.2);
	});

	it('lässt leere Positionen und Überschriften ohne Inhalt weg', () => {
		const out = billedLines(invoiceLines(lines, columns, { '01.02.01|m': 11 }));
		expect(out.map((l) => l.text)).toEqual(['Markierung', 'Leitlinie 15 cm weiß, LB 01.02.01', 'Sonstiges', 'Baustelleneinrichtung']);
	});

	it('ordnet nach der Angebotsnummer in der LB-Pos. zu', () => {
		const cols = [
			{ key: columnKey('1.3', 'm²'), lbPos: '1.3', unit: 'm²', label: '', slot: null, total: 2 },
			{ key: columnKey('', 'lfm', { slot: 2 }), lbPos: '', unit: 'lfm', label: '', slot: 2, total: 5 }
		];
		// Bisherige Zählung: 1.3 = Pfeile; die Spalte ohne LB-Pos. passt per Einheit eindeutig auf die Leitlinie
		expect(suggestMapping(cols, lines, null, true)).toEqual({ '1.3|m²': 13, '|lfm#2': 11 });
		// Neue Zählung: die Überschriften zählen mit, ohne Unterpositionen sind die Pfeile 4
		const neu = [{ ...cols[0], key: columnKey('4', 'm²'), lbPos: '4' }, cols[1]];
		expect(suggestMapping(neu, lines, null)).toEqual({ '4|m²': 13, '|lfm#2': 11 });
		// … als Unterpositionen der Überschrift 1.3
		const unter = lines.map((l) => ({ ...l, sub: true }));
		expect(suggestMapping(cols, unter, null)).toEqual({ '1.3|m²': 13, '|lfm#2': 11 });
		expect(invoiceLines(lines, cols, { '|lfm#2': 11 })[1].source).toBe('Spalte 2 (lfm)');
	});

	it('ordnet Bezeichnungen der Position mit allen ihren Wörtern zu', () => {
		const marking: PricedLine[] = [
			{ id: 1, kind: 'position', text: 'RRL 0,15 MSK C ref', quantity: 5680, unit: 'lfd. m', unitPrice: 3.5 },
			{ id: 2, kind: 'position', text: 'LRL 0,12 MSK C ref', quantity: 5680, unit: 'lfd. m', unitPrice: 3.5 },
			{ id: 3, kind: 'position', text: 'LL 0,15 MSK C ref', quantity: 5680, unit: 'lfd. m', unitPrice: 3.5 }
		];
		const col = (label: string) => ({ key: columnKey('', 'lfm', { label }), lbPos: '', unit: 'lfm', label, slot: null, total: 1 });
		const cols = [col('RRL 0,15 MSK C ref'), col('LRL 0,12'), col('ll 0,15'), col('MSK C ref')];
		expect(Object.values(suggestMapping(cols, marking, null))).toEqual([1, 2, 3, undefined]);
	});

	it('kennt gleichbedeutende Einheiten', () => {
		expect(unitFamily('lfd. m')).toBe('m');
		expect(unitFamily('M2')).toBe('m²');
		expect(unitFamily('Pauschal')).toBe('pauschal');
		expect(unitFamily('h')).toBe('h');
	});
});

describe('Teilrechnungen', () => {
	const pos = [{ lbPos: '01.02', unit: 'm' }];
	const sum = summarize([
		report({ id: 1, number: '1', date: '2026-10-01', positions: pos, rows: [{ quantities: [100] }] }),
		report({ id: 2, number: '2', date: '2026-10-03', dateTo: '2026-10-04', positions: pos, rows: [{ quantities: [50] }], invoiceId: 7, invoiceNumber: '2026-015' }),
		report({ id: 3, number: '3', date: '2026-10-08', positions: pos, rows: [{ quantities: [25] }] }),
		report({ id: 4, number: '4', date: '2026-10-09', status: 'freigegeben', positions: pos, rows: [{ quantities: [9] }] })
	]);

	it('merkt sich, mit welcher Rechnung ein Bericht abgerechnet ist', () => {
		expect(sum.reports.map((r) => r.invoiceNumber)).toEqual([null, '2026-015', null, null]);
	});

	it('zählt nur die gewählten, geprüften Berichte', () => {
		expect(selectedColumns(sum.columns, sum.reports, new Set([1, 3]))[0].total).toBe(125);
		// Nicht geprüft zählt auch gewählt nicht
		expect(selectedColumns(sum.columns, sum.reports, new Set([3, 4]))[0].total).toBe(25);
		expect(selectedColumns(sum.columns, sum.reports, new Set())[0].total).toBe(0);
	});

	it('nimmt den Zeitraum der gewählten Berichte', () => {
		expect(selectedPeriod(sum.reports, new Set([2, 3]))).toEqual({ from: '2026-10-03', to: '2026-10-08' });
		expect(selectedPeriod(sum.reports, new Set())).toBeNull();
	});

	it('schlägt Rechnung nur für alles auf einmal vor', () => {
		const all = { closed: true, previous: 0, available: 3, selected: 3, pending: 0 };
		expect(suggestKind(all)).toBe('rechnung');
		expect(suggestKind({ ...all, selected: 2 })).toBe('teilrechnung');
		expect(suggestKind({ ...all, closed: false })).toBe('teilrechnung');
		expect(suggestKind({ ...all, previous: 1 })).toBe('teilrechnung');
		expect(suggestKind({ ...all, pending: 1 })).toBe('teilrechnung');
	});

	it('nummeriert weitere Rechnungen zum Auftrag durch', () => {
		expect(nextInvoiceNumber('2026-015', new Set())).toBe('2026-015');
		expect(nextInvoiceNumber('2026-015', new Set(['2026-015']))).toBe('2026-015-2');
		expect(nextInvoiceNumber('2026-015', new Set(['2026-015', '2026-015-2']))).toBe('2026-015-3');
	});

	it('rechnet eine Pauschale nur einmal ab', () => {
		const lines: PricedLine[] = [{ id: 15, kind: 'position', text: 'Baustelleneinrichtung', quantity: 1, unit: 'Pauschal', unitPrice: 350 }];
		expect(invoiceLines(lines, [], {})[0].quantity).toBe(1);
		expect(invoiceLines(lines, [], {}, [15])[0].quantity).toBeNull();
	});
});

describe('Eigene Positionen aus den Tagesberichten', () => {
	const lines: PricedLine[] = [
		{ id: 1, kind: 'titel', text: 'Markierung', quantity: null, unit: '', unitPrice: null },
		{ id: 2, kind: 'position', text: 'RRL 0,15 MSK C ref', quantity: 5680, unit: 'lfd. m', unitPrice: 3.5, sub: true }
	];
	const col = (label: string, unit: string, total: number) => ({ key: columnKey('', unit, { label }), lbPos: '', unit, label, slot: null, total });
	const cols = [col('RRL 0,15 MSK C ref', 'lfm', 1150), col('Absperrung', 'Std', 4), col('Pfeil', 'Stk', 0)];

	it('hängt sie mit Menge und ohne Preis unter einer eigenen Überschrift an', () => {
		const out = invoiceLines(lines, cols, { [cols[0].key]: 2, [cols[1].key]: OWN_LINE, [cols[2].key]: OWN_LINE });
		expect(out.map((l) => [l.number, l.kind, l.text, l.quantity, l.unit, l.unitPrice])).toEqual([
			['1', 'titel', 'Markierung', null, '', null],
			['1.1', 'position', 'RRL 0,15 MSK C ref', 1150, 'lfd. m', 3.5],
			['2', 'titel', OWN_LINES_TITLE, null, '', null],
			['2.1', 'position', 'Absperrung', 4, 'Std', null],
			['2.2', 'position', 'Pfeil', null, 'Stk', null]
		]);
		expect(out[3].columnKey).toBe(cols[1].key);
		// Ohne Menge bleibt auch die Überschrift draußen, wenn nichts darunter steht
		expect(billedLines(out.slice(2).filter((l) => l.text !== 'Absperrung')).length).toBe(0);
	});

	it('merkt sich „eigene Position" wie eine Zuordnung', () => {
		expect(suggestMapping(cols, lines, { [cols[1].key]: OWN_LINE })[cols[1].key]).toBe(OWN_LINE);
	});
});
