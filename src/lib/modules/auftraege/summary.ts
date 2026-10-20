/**
 * Summenblatt und Rechnung – was Browser und Server teilen.
 *
 * Summenblatt: Die Mengen aller Tagesberichte eines Auftrags zusammengezählt –
 * in Spalten mit LB-Position je LB-Position und Einheit, in Spalten ohne nach
 * der Bezeichnung der Zeile (Ortsbezeichnung/Markierungsart, z. B. „RRL 0,15
 * MSK C ref") und Einheit. Zeilen ohne Bezeichnung bleiben nach der Stelle der
 * Spalte getrennt (Spalte 1, 2, 3 …). Es zählen nur geprüfte und vom
 * Kunden unterschriebene Berichte; die anderen stehen als Hinweis dabei.
 *
 * Rechnung: Jede Mengenspalte wird einer Angebotsposition zugeordnet – deren
 * Preis gilt, die Menge kommt aus den gewählten Berichten. Die Zuordnung merkt
 * sich der Auftrag für die nächste Rechnung. Jeder Bericht wird nur einmal
 * abgerechnet: entweder alle in einer Rechnung oder nach und nach in Teilrechnungen.
 */
import { lineNumbers } from './offer';

/** Diese Berichte zählen fürs Summenblatt und für die Rechnung */
export const COUNTED_STATUS: readonly string[] = ['geprueft', 'abgeschlossen'];

export interface SummaryReportInput {
	id: number;
	number: string;
	date: string;
	dateTo: string | null;
	site: string;
	partyName: string | null;
	status: string;
	/** Spalten in der Reihenfolge des Berichts */
	positions: { lbPos: string; unit: string }[];
	/** Zeilen: Bezeichnung (Ort bzw. Markierungsart) und die Mengen je Spalte */
	rows: { label?: string; quantities: (number | null)[] }[];
	materials?: { material: string; code: string; filmThickness: string }[];
	/** Schon abgerechnet mit dieser Rechnung */
	invoiceId?: number | null;
	invoiceNumber?: string | null;
}

export interface SummaryColumn {
	key: string;
	lbPos: string;
	unit: string;
	/** Ohne LB-Position: die Bezeichnung der Zeilen, die hier zusammengezählt sind */
	label: string;
	/** Ohne LB-Position und ohne Bezeichnung: die wievielte Spalte im Bericht */
	slot: number | null;
	/** Summe der zählenden Berichte */
	total: number;
}

export interface SummaryReport {
	id: number;
	number: string;
	date: string;
	dateTo: string | null;
	site: string;
	partyName: string | null;
	status: string;
	counted: boolean;
	/** Menge je Spalten-Schlüssel */
	values: Record<string, number>;
	invoiceId: number | null;
	invoiceNumber: string | null;
}

export interface OrderSummary {
	columns: SummaryColumn[];
	reports: SummaryReport[];
	/** Zeitraum der zählenden Berichte – null ohne solche */
	from: string | null;
	to: string | null;
	materials: { material: string; code: string; filmThickness: string }[];
	counted: number;
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;

/**
 * Schlüssel einer Menge, Groß/Klein egal: LB-Position und Einheit; ohne
 * LB-Position die Bezeichnung der Zeile und die Einheit, ohne beides die Stelle der Spalte.
 */
export function columnKey(lbPos: string, unit: string, by: { label?: string; slot?: number | null } = {}): string {
	const u = tidy(unit).toLowerCase();
	if (tidy(lbPos)) return `${tidy(lbPos).toLowerCase()}|${u}`;
	if (by.label && tidy(by.label)) return `~${tidy(by.label).toLowerCase()}|${u}`;
	return by.slot ? `|${u}#${by.slot}` : `|${u}`;
}

/** So heißt die Menge in Listen und Herkunft: LB-Position, sonst die Bezeichnung, sonst „Spalte 2" */
export function columnLabel(c: { lbPos: string; label?: string; slot?: number | null }): string {
	return c.lbPos || c.label || (c.slot ? `Spalte ${c.slot}` : 'ohne LB-Pos.');
}

const filled = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function summarize(input: SummaryReportInput[]): OrderSummary {
	const columns = new Map<string, SummaryColumn>();
	const materials = new Map<string, { material: string; code: string; filmThickness: string }>();
	const reports: SummaryReport[] = [];
	let from: string | null = null;
	let to: string | null = null;

	const sorted = [...input].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'de', { numeric: true }));
	for (const r of sorted) {
		const counted = COUNTED_STATUS.includes(r.status);
		const values: Record<string, number> = {};
		const add = (key: string, col: Omit<SummaryColumn, 'key' | 'total'>, v: number) => {
			values[key] = round3((values[key] ?? 0) + v);
			if (!columns.has(key)) columns.set(key, { key, ...col, total: 0 });
		};
		r.positions.forEach((p, i) => {
			const lbPos = tidy(p.lbPos);
			const unit = tidy(p.unit);
			if (lbPos) {
				// Mit LB-Position: die ganze Spalte – sie steht auch ohne Menge im Blatt
				const sum = r.rows.reduce((s, row) => s + (filled(row.quantities[i]) ? row.quantities[i]! : 0), 0);
				add(columnKey(lbPos, unit), { lbPos, unit, label: '', slot: null }, sum);
				return;
			}
			// Ohne LB-Position: je Bezeichnung der Zeile, Zeilen ohne Bezeichnung je Spalte
			for (const row of r.rows) {
				const q = row.quantities[i];
				if (!filled(q) || q === 0) continue;
				const label = tidy(row.label ?? '');
				if (label) add(columnKey('', unit, { label }), { lbPos: '', unit, label, slot: null }, q);
				else add(columnKey('', unit, { slot: i + 1 }), { lbPos: '', unit, label: '', slot: i + 1 }, q);
			}
		});
		if (counted) {
			for (const [key, v] of Object.entries(values)) {
				const c = columns.get(key)!;
				c.total = round3(c.total + v);
			}
			const last = r.dateTo && r.dateTo > r.date ? r.dateTo : r.date;
			if (!from || r.date < from) from = r.date;
			if (!to || last > to) to = last;
			for (const m of r.materials ?? []) {
				if (!tidy(m.material) && !tidy(m.code)) continue;
				const k = [m.material, m.code, m.filmThickness].map((x) => tidy(x).toLowerCase()).join('|');
				if (!materials.has(k)) materials.set(k, { material: tidy(m.material), code: tidy(m.code), filmThickness: tidy(m.filmThickness) });
			}
		}
		reports.push({
			id: r.id,
			number: r.number,
			date: r.date,
			dateTo: r.dateTo,
			site: r.site,
			partyName: r.partyName,
			status: r.status,
			counted,
			values,
			invoiceId: r.invoiceId ?? null,
			invoiceNumber: r.invoiceNumber ?? null
		});
	}

	// Erst die mit LB-Position (nach Nummer), dann die übrigen, wie sie in den Berichten vorkommen
	const cols = [...columns.values()].sort((a, b) =>
		a.lbPos && b.lbPos
			? a.lbPos.localeCompare(b.lbPos, 'de', { numeric: true }) || a.unit.localeCompare(b.unit, 'de')
			: Number(!a.lbPos) - Number(!b.lbPos)
	);
	return { columns: cols, reports, from, to, materials: [...materials.values()], counted: reports.filter((r) => r.counted).length };
}

/* ------------------------------------------------------------ Rechnung */

/** Die Spalten mit den Summen nur der gewählten Berichte – zählende, versteht sich */
export function selectedColumns(columns: SummaryColumn[], reports: SummaryReport[], selected: ReadonlySet<number>): SummaryColumn[] {
	const chosen = reports.filter((r) => r.counted && selected.has(r.id));
	return columns.map((c) => ({ ...c, total: round3(chosen.reduce((s, r) => s + (r.values[c.key] ?? 0), 0)) }));
}

/** Leistungszeitraum der gewählten Berichte – null ohne Auswahl */
export function selectedPeriod(reports: SummaryReport[], selected: ReadonlySet<number>): { from: string; to: string } | null {
	let from: string | null = null;
	let to: string | null = null;
	for (const r of reports) {
		if (!selected.has(r.id)) continue;
		const last = r.dateTo && r.dateTo > r.date ? r.dateTo : r.date;
		if (!from || r.date < from) from = r.date;
		if (!to || last > to) to = last;
	}
	return from && to ? { from, to } : null;
}

/**
 * Rechnung oder Teilrechnung? Eine Rechnung ist es nur, wenn sie die erste ist,
 * der Auftrag abgeschlossen ist und sie alle Berichte enthält – sonst Teilrechnung.
 */
export function suggestKind(s: { closed: boolean; previous: number; available: number; selected: number; pending: number }): 'rechnung' | 'teilrechnung' {
	return s.previous === 0 && s.closed && s.pending === 0 && s.selected === s.available ? 'rechnung' : 'teilrechnung';
}

/** Erste Rechnung mit der Nummer des Auftrags, weitere mit „-2", „-3" … */
export function nextInvoiceNumber(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Einheiten, die dasselbe meinen – für den Vorschlag der Zuordnung */
export function unitFamily(unit: string): string {
	const u = tidy(unit).toLowerCase().replace(/\s/g, '');
	if (['m', 'lfm', 'lfd.m', 'lfdm', 'lm', 'laufmeter', 'meter'].includes(u)) return 'm';
	if (['m²', 'm2', 'qm', 'quadratmeter'].includes(u)) return 'm²';
	if (['stk', 'stk.', 'stück', 'st', 'st.'].includes(u)) return 'stk';
	if (['pauschal', 'pa', 'psch', 'psch.', 'pausch.', 'pauschale', 'pau'].includes(u)) return 'pauschal';
	return u;
}

export interface PricedLine {
	id: number;
	kind: 'position' | 'titel';
	text: string;
	/** Bemerkung zur Position – geht mit auf die Rechnung */
	note?: string;
	quantity: number | null;
	unit: string;
	unitPrice: number | null;
	/** Alternativposition im Angebot – kommt nur, wenn sie gemacht wurde */
	alternative?: boolean;
}

/** Zuordnung „eigene Position": steht nicht im Auftrag, kommt mit Menge aus den Berichten und eigenem Preis */
export const OWN_LINE = 'eigene';
/** Was der Auftrag sich je Spalte merkt */
export type MappingTarget = number | null | typeof OWN_LINE;
/** Zuordnung je Spalte: Positions-ID, null = nicht abrechnen, „eigene" = eigene Position, undefined = noch offen */
export type Mapping = Record<string, MappingTarget | undefined>;
/** Überschrift über den eigenen Positionen */
export const OWN_LINES_TITLE = 'Zusätzliche Leistungen lt. Tagesbericht';

/** Wörter eines Textes – klein, ohne Satzzeichen am Rand */
const words = (s: string) =>
	new Set(
		tidy(s)
			.toLowerCase()
			.split(' ')
			.map((w) => w.replace(/^[.,;:()"„“]+|[.,;:()"„“]+$/g, ''))
			.filter(Boolean)
	);

/**
 * Vorschlag: was der Auftrag sich gemerkt hat; bei einer Bezeichnung die
 * einzige Position, in deren Text alle Wörter der Bezeichnung stehen („RRL
 * 0,15" → „RRL 0,15 MSK C ref"); sonst die Position mit genau dieser Nummer
 * (steht in der LB-Pos. die Angebotsposition, z. B. „1.2"); sonst die
 * Position, in deren Text die LB-Position steht; sonst die einzige Position
 * mit passender Einheit.
 */
export function suggestMapping(columns: SummaryColumn[], lines: PricedLine[], saved: Record<string, MappingTarget> | null | undefined): Mapping {
	const numbers = lineNumbers(lines);
	const positions = lines.filter((l) => l.kind === 'position');
	const byNumber = new Map(lines.map((l, i) => [numbers[i], l]).filter(([, l]) => (l as PricedLine).kind === 'position') as [string, PricedLine][]);
	const out: Mapping = {};
	for (const c of columns) {
		const remembered = saved?.[c.key];
		if (remembered === null || remembered === OWN_LINE || (remembered != null && positions.some((p) => p.id === remembered))) {
			out[c.key] = remembered;
			continue;
		}
		if (c.label) {
			const want = [...words(c.label)];
			const hits = positions.filter((p) => {
				const have = words(p.text);
				return want.every((w) => have.has(w));
			});
			if (hits.length === 1) {
				out[c.key] = hits[0].id;
				continue;
			}
		}
		const numbered = c.lbPos ? byNumber.get(c.lbPos.replace(/\.$/, '')) : undefined;
		if (numbered) {
			out[c.key] = numbered.id;
			continue;
		}
		const byText = c.lbPos ? positions.filter((p) => p.text.includes(c.lbPos)) : [];
		if (byText.length === 1) {
			out[c.key] = byText[0].id;
			continue;
		}
		const byUnit = positions.filter((p) => unitFamily(p.unit) === unitFamily(c.unit));
		out[c.key] = byUnit.length === 1 ? byUnit[0].id : undefined;
	}
	return out;
}

export interface InvoiceLineDraft {
	/** Positionsnummer wie im Angebot */
	number: string;
	/** Die Angebotsposition, aus der die Zeile stammt – null bei eigenen Positionen */
	offerLineId: number | null;
	/** Eigene Position: die Menge aus den Berichten, deren Schlüssel */
	columnKey: string | null;
	/** Die Überschrift über den eigenen Positionen */
	ownTitle?: boolean;
	kind: 'position' | 'titel';
	text: string;
	note?: string;
	/** Im Angebot eine Alternativposition */
	alternative?: boolean;
	quantity: number | null;
	unit: string;
	unitPrice: number | null;
	/** Menge laut Angebot – zum Vergleich */
	offerQuantity: number | null;
	/** Woher die Menge kommt, z. B. „01.02.01 (m)" */
	source: string;
}

/**
 * Rechnungszeilen aus dem Angebot: zugeordnete Positionen bekommen die Summe
 * ihrer Spalten, Pauschalen die Menge aus dem Angebot – außer sie stehen schon
 * auf einer früheren Rechnung (flatBilled). Der Rest bleibt leer und wird also
 * nicht abgerechnet, solange niemand eine Menge einträgt.
 *
 * Mengen, die als „eigene Position" zugeordnet sind (im Auftrag nicht
 * vorgesehen, aber gemacht und vom Kunden unterschrieben), kommen ans Ende
 * unter eine eigene Überschrift – mit Bezeichnung und Menge aus den Berichten,
 * den Einheitspreis trägt man selbst ein.
 */
export function invoiceLines(lines: PricedLine[], columns: SummaryColumn[], mapping: Mapping, flatBilled: readonly number[] = []): InvoiceLineDraft[] {
	const own = columns.filter((c) => mapping[c.key] === OWN_LINE);
	const numbers = lineNumbers([...lines, ...(own.length ? [{ kind: 'titel' as const }, ...own.map(() => ({ kind: 'position' as const }))] : [])]);
	const out: InvoiceLineDraft[] = lines.map((l, i) => {
		const number = numbers[i];
		if (l.kind === 'titel')
			return { number, offerLineId: l.id, columnKey: null, kind: 'titel', text: l.text, quantity: null, unit: '', unitPrice: null, offerQuantity: null, source: '' };
		const mapped = columns.filter((c) => mapping[c.key] === l.id);
		let quantity: number | null = null;
		let source = '';
		if (mapped.length) {
			quantity = round3(mapped.reduce((s, c) => s + c.total, 0));
			source = mapped.map((c) => `${columnLabel(c)} (${c.unit || 'ohne Einheit'})`).join(', ');
		} else if (unitFamily(l.unit) === 'pauschal' && !flatBilled.includes(l.id) && !l.alternative) {
			// Pauschale: die Menge laut Angebot – dazu steht in der Zeile ohnehin „lt. Angebot“
			quantity = l.quantity;
		}
		return {
			number,
			offerLineId: l.id,
			columnKey: null,
			kind: 'position',
			text: l.text,
			...(l.note ? { note: l.note } : {}),
			...(l.alternative ? { alternative: true } : {}),
			quantity,
			unit: l.unit,
			unitPrice: l.unitPrice,
			offerQuantity: l.quantity,
			source
		};
	});
	if (own.length) {
		const at = lines.length;
		out.push({ number: numbers[at], offerLineId: null, columnKey: null, ownTitle: true, kind: 'titel', text: OWN_LINES_TITLE, quantity: null, unit: '', unitPrice: null, offerQuantity: null, source: '' });
		own.forEach((c, j) =>
			out.push({
				number: numbers[at + 1 + j],
				offerLineId: null,
				columnKey: c.key,
				kind: 'position',
				text: columnLabel(c),
				quantity: c.total ? c.total : null,
				unit: c.unit,
				unitPrice: null,
				offerQuantity: null,
				source: `${columnLabel(c)} (${c.unit || 'ohne Einheit'})`
			})
		);
	}
	return out;
}

/** Was in die Rechnung kommt: Positionen mit Menge, Überschriften nur, wenn darunter etwas steht */
export function billedLines<T extends { kind: 'position' | 'titel'; quantity: number | null }>(lines: T[]): T[] {
	const out: T[] = [];
	let pendingTitle: T | null = null;
	for (const l of lines) {
		if (l.kind === 'titel') {
			pendingTitle = l;
			continue;
		}
		if (l.quantity == null || l.quantity === 0) continue;
		if (pendingTitle) {
			out.push(pendingTitle);
			pendingTitle = null;
		}
		out.push(l);
	}
	return out;
}
