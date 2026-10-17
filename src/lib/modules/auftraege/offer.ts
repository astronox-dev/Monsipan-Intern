/**
 * Angebote und Aufträge – was Browser und Server teilen: Beträge, Nummern,
 * Positionsnummern (1.1, 1.2 …) und die Summen.
 */

export const OFFER_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
	entwurf: { label: 'In Arbeit', tone: '' },
	freigegeben: { label: 'Ausstehend', tone: 'badge-info' },
	aenderung: { label: 'Änderung gewünscht', tone: 'badge-warn' },
	angenommen: { label: 'Angenommen', tone: 'badge-ok' },
	abgerechnet: { label: 'Abgerechnet', tone: 'badge-brand' }
};

/** Stand fürs Anzeigen: ein angenommenes Angebot mit abgerechnetem Auftrag heißt „abgerechnet" */
export const offerState = (o: { status: string; billedAt?: Date | number | null }) => (o.status === 'angenommen' && o.billedAt ? 'abgerechnet' : o.status);

export const ORDER_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
	erstellt: { label: 'Auftrag erstellt', tone: 'badge-info' },
	in_arbeit: { label: 'In Arbeit', tone: 'badge-warn' },
	abgeschlossen: { label: 'Abgeschlossen', tone: 'badge-ok' }
};

export const INVOICE_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
	offen: { label: 'Offen', tone: 'badge-warn' },
	bezahlt: { label: 'Bezahlt', tone: 'badge-ok' }
};

/** „Rechnung" über alles, „Teilrechnung" über einen Teil der Tagesberichte, „Stornorechnung" zu einer ausgestellten */
export const INVOICE_KIND_LABELS: Record<string, string> = { rechnung: 'Rechnung', teilrechnung: 'Teilrechnung', storno: 'Stornorechnung' };
export const invoiceLabel = (kind: string) => INVOICE_KIND_LABELS[kind] ?? 'Rechnung';

/** Steht auf der Rechnung, wenn die Steuerschuld auf den Kunden übergeht */
export const REVERSE_CHARGE_NOTE = 'Übergang der Steuerschuld auf den Leistungsempfänger gemäß § 19 Abs. 1a UStG (Bauleistungen).';

/** Obergrenze, damit ein Angebot nicht ins Uferlose wächst */
export const MAX_OFFER_LINES = 200;

const euro = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });
const amount = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const euroPrice = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const quantityFmt = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 3 });

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** „€ 1.234,56" */
export function money(v: number | null | undefined): string {
	return v == null || !Number.isFinite(v) ? '' : euro.format(v);
}

/** Einheitspreis – auch mit mehr als zwei Nachkommastellen, etwa „€ 0,855" */
export function priceLabel(v: number | null | undefined): string {
	return v == null || !Number.isFinite(v) ? '' : euroPrice.format(v);
}

/** Betrag fürs Eingabefeld: „1234,56" */
export function amountInput(v: number | null | undefined): string {
	return v == null || !Number.isFinite(v) ? '' : amount.format(v).replace(/\./g, '').replace(/\s/g, '');
}

/** Menge: „250", „12,5" */
export function quantityLabel(v: number | null | undefined): string {
	return v == null || !Number.isFinite(v) ? '' : quantityFmt.format(v);
}

/**
 * Zahl aus dem Formular: „1.234,56", „1234,56", „1234.56" und „1 234,5"
 * werden verstanden. Leer oder unlesbar → null.
 */
export function parseAmount(raw: string | null | undefined): number | null {
	let s = String(raw ?? '')
		.trim()
		.replace(/[\s€]/g, '');
	if (!s) return null;
	if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
	// Nur Punkte: „1.234" oder „1.234.567" sind Tausender, „12.5" ist ein Komma
	else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

export interface OfferLine {
	kind: 'position' | 'titel';
	quantity: number | null;
	unitPrice?: number | null;
}

/** Gesamtpreis einer Position, auf Cent gerundet */
export function lineTotal(line: { quantity: number | null; unitPrice?: number | null }): number | null {
	if (line.quantity == null || line.unitPrice == null) return null;
	return round2(line.quantity * line.unitPrice);
}

export function offerTotals(lines: OfferLine[], vatRate: number) {
	const net = round2(lines.reduce((s, l) => s + (l.kind === 'position' ? (lineTotal(l) ?? 0) : 0), 0));
	const vat = round2((net * vatRate) / 100);
	return { net, vat, gross: round2(net + vat) };
}

/** Rechnung: wie beim Angebot – bei Übergang der Steuerschuld ohne Umsatzsteuer */
export function invoiceTotals(lines: OfferLine[], vatRate: number, reverseCharge: boolean) {
	return offerTotals(lines, reverseCharge ? 0 : vatRate);
}

/**
 * Nummern wie im Angebot: Positionen 1.1, 1.2 …; jede Zwischenüberschrift
 * beginnt eine neue Gruppe (2, dann 2.1, 2.2 …). Ohne Überschriften bleibt
 * alles in Gruppe 1.
 */
export function lineNumbers(lines: { kind: 'position' | 'titel' }[]): string[] {
	let group = 1;
	let pos = 0;
	let seen = false;
	return lines.map((l) => {
		if (l.kind === 'titel') {
			// Die erste Überschrift ganz oben ist Gruppe 1, sonst beginnt eine neue
			if (seen) group++;
			seen = true;
			pos = 0;
			return String(group);
		}
		seen = true;
		pos++;
		return `${group}.${pos}`;
	});
}

/** „26659" → „26 659" wie in der Überschrift des Angebots */
export function spacedNumber(n: string): string {
	// Weitere Rechnungen zum Auftrag hängen „-2", „-3" … an
	const m = /^(\d{5,})(-\d+)?$/.exec(n);
	return m ? `${m[1].slice(0, -3)} ${m[1].slice(-3)}${m[2] ?? ''}` : n;
}

/**
 * Nächste Angebotsnummer: Jahr und laufende Nummer, „26001", „26002" … – im
 * neuen Jahr beginnt die Zählung wieder bei „27001".
 */
export function nextOfferNumber(existing: string[], year: number): string {
	const yy = String(year % 100).padStart(2, '0');
	const max = existing.reduce((m, n) => {
		const hit = /^(\d{2})(\d{3,})$/.exec(n);
		return hit && hit[1] === yy && Number(hit[2]) > m ? Number(hit[2]) : m;
	}, 0);
	return `${yy}${String(max + 1).padStart(3, '0')}`;
}

/** Rechnungsnummer, wie sie auf der Rechnung steht: „26 659" bzw. mit Kostenstelle „42 041/9526053" */
export function invoiceNo(i: { number: string; costCenter?: string | null }): string {
	const n = spacedNumber(i.number);
	return i.costCenter ? `${n}/${i.costCenter}` : n;
}

/** Nächste Projektnummer im Jahr: „26-00785" → „26-00786" */
export function nextProjectNumber(existing: string[], year: number): string {
	const yy = String(year % 100).padStart(2, '0');
	const max = existing.reduce((m, n) => {
		const hit = /^(\d{2})-(\d+)$/.exec(n);
		return hit && hit[1] === yy && Number(hit[2]) > m ? Number(hit[2]) : m;
	}, 0);
	return `${yy}-${String(max + 1).padStart(5, '0')}`;
}

/** Anschrift als Zeilen, leere fallen weg */
export function addressLines(c: { name: string; addition: string; street: string; zip: string; city: string }): string[] {
	return [c.name, c.addition, c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter((l) => l.trim());
}
