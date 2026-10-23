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
	/** Alternativposition: angeboten, aber nicht im Gesamtbetrag */
	alternative?: boolean;
}

/** Gesamtpreis einer Position, auf Cent gerundet */
export function lineTotal(line: { quantity: number | null; unitPrice?: number | null }): number | null {
	if (line.quantity == null || line.unitPrice == null) return null;
	return round2(line.quantity * line.unitPrice);
}

/** GP, wie er im Angebot steht: bei einer Alternativposition 0 – sie zählt nicht zum Gesamtbetrag */
export function shownTotal(line: { quantity: number | null; unitPrice?: number | null; alternative?: boolean }): number | null {
	const total = lineTotal(line);
	return line.alternative && total != null ? 0 : total;
}

/* ------------------------------------------------------------- Nachlass */

/** Nachlass auf die Netto-Summe: in Prozent oder als Betrag – gesetzt ist höchstens eines */
export interface Discount {
	discountPercent?: number | null;
	discountAmount?: number | null;
}

/**
 * Der Nachlass in Euro: der Betrag oder die Prozent der Netto-Summe (auf Cent),
 * nie mehr als die Summe selbst. Bei einer Stornorechnung (negativ) mit Vorzeichen.
 */
export function discountOf(net: number, d: Discount = {}): number {
	const abs = Math.abs(net);
	const raw = (d.discountAmount ?? 0) > 0 ? d.discountAmount! : round2((abs * (d.discountPercent ?? 0)) / 100);
	const off = round2(Math.min(Math.max(raw, 0), abs));
	return net < 0 ? -off : off;
}

/** „abzüglich 5 % Nachlass" bzw. „abzüglich Nachlass" */
export const discountLabel = (d: Discount) =>
	(d.discountAmount ?? 0) > 0 || !(d.discountPercent ?? 0) ? 'abzüglich Nachlass' : `abzüglich ${String(d.discountPercent).replace('.', ',')} % Nachlass`;

/** Nachlass fürs Formular: die Zahl, wie sie im Feld steht, und die Art */
export function discountInput(d: Discount): { value: string; kind: 'prozent' | 'betrag' } {
	if ((d.discountAmount ?? 0) > 0) return { value: amountInput(d.discountAmount), kind: 'betrag' };
	return { value: d.discountPercent ? String(d.discountPercent).replace('.', ',') : '', kind: 'prozent' };
}

/** Nachlass aus dem Formular, wie getippt – fürs Mitrechnen im Browser */
export const discountFrom = (value: string, kind: string): Discount =>
	kind === 'betrag' ? { discountAmount: Math.max(0, parseAmount(value) ?? 0) } : { discountPercent: Math.min(100, Math.max(0, parseAmount(value) ?? 0)) };

/** Nachlass aus dem Formular: nachlass (Zahl) und nachlassart (prozent | betrag) – oder eine Meldung */
export function readDiscount(get: (key: string) => string): { discountPercent: number; discountAmount: number } | { message: string } {
	const raw = get('nachlass').trim();
	const value = raw ? parseAmount(raw) : 0;
	if (value == null || value < 0) return { message: 'Der Nachlass ist keine gültige Zahl.' };
	if (get('nachlassart') === 'betrag') {
		if (value > 100_000_000) return { message: 'Der Nachlass ist zu hoch.' };
		return { discountPercent: 0, discountAmount: round2(value) };
	}
	if (value > 100) return { message: 'Der Nachlass muss zwischen 0 und 100 % liegen.' };
	return { discountPercent: Math.round(value * 100) / 100, discountAmount: 0 };
}

/* --------------------------------------------------------------- Summen */

/**
 * Netto (Summe der Positionen), Nachlass, Netto nach Nachlass, Umsatzsteuer und
 * Gesamtbetrag – bei Übergang der Steuerschuld ohne Umsatzsteuer.
 */
export function offerTotals(lines: OfferLine[], vatRate: number, reverseCharge = false, discount: Discount = {}) {
	const net = round2(lines.reduce((s, l) => s + (l.kind === 'position' ? (shownTotal(l) ?? 0) : 0), 0));
	const off = discountOf(net, discount);
	const taxable = round2(net - off);
	const vat = reverseCharge ? 0 : round2((taxable * vatRate) / 100);
	return { net, discount: off, taxable, vat, gross: round2(taxable + vat) };
}

/** Rechnung: wie beim Angebot */
export function invoiceTotals(lines: OfferLine[], vatRate: number, reverseCharge: boolean, discount: Discount = {}) {
	return offerTotals(lines, vatRate, reverseCharge, discount);
}

/** Die Zeilen unter der Tabelle: [Beschriftung, Betrag, fett] – Nachlass nur, wenn einer gewährt wird */
export function sumRows(totals: ReturnType<typeof offerTotals>, vatRate: number, reverseCharge: boolean, discount: Discount): [string, string, boolean][] {
	return [
		['Gesamt Netto', money(totals.net), false],
		...(totals.discount
			? ([
					[discountLabel(discount), `− ${money(Math.abs(totals.discount))}`, false],
					['Netto nach Nachlass', money(totals.taxable), false]
				] as [string, string, boolean][])
			: []),
		...(reverseCharge ? [] : ([[vatLabel(vatRate, false), money(totals.vat), false]] as [string, string, boolean][])),
		['Gesamtbetrag', money(totals.gross), true]
	];
}

/** Zur Wahl bei der Umsatzsteuer – dazu „Übergang der Steuerschuld" (0 %) */
export const VAT_RATES = [20, 13, 10] as const;

/** „20 % Umsatzsteuer" bzw. „Übergang der Steuerschuld" – für Summen und Listen */
export const vatLabel = (vatRate: number, reverseCharge: boolean) =>
	reverseCharge ? '0 % – Übergang der Steuerschuld (§ 19 Abs. 1a UStG)' : `${String(vatRate).replace('.', ',')} % Umsatzsteuer`;

/* -------------------------------------------------- Zahlungsbedingungen */

export interface PaymentTerms {
	/** Zahlungsziel in Tagen ab Rechnungsdatum */
	paymentDays: number;
	/** Skonto in Prozent bei Zahlung innerhalb von skontoDays Tagen – 0 heißt ohne */
	skontoPercent: number;
	skontoDays: number;
}

/** Skonto gilt nur mit Prozent und Frist */
export const hasSkonto = (t: Pick<PaymentTerms, 'skontoPercent' | 'skontoDays'>) => t.skontoPercent > 0 && t.skontoDays > 0;

/** Was nach Abzug des Skontos zu zahlen ist */
export const afterSkonto = (gross: number, percent: number) => round2(gross * (1 - percent / 100));

const percentLabel = (p: number) => `${String(p).replace('.', ',')} %`;
const daysLabel = (d: number) => (d === 1 ? '1 Tag' : `${d} Tagen`);

/**
 * Zahlungsbedingungen als Sätze. Mit Daten (Rechnung): „Zahlbar bis … ohne
 * Abzug." und „Bei Zahlung bis … 3 % Skonto – zu zahlen sind dann …"; ohne
 * (Angebot) mit der Frist in Tagen ab Rechnungsdatum.
 */
export function paymentTermsText(t: PaymentTerms, gross: number, dates?: { due: string; skonto: string }): string[] {
	const out = [
		dates
			? `Zahlbar bis ${dates.due} ohne Abzug.`
			: t.paymentDays > 0
				? `Zahlbar innerhalb von ${daysLabel(t.paymentDays)} ab Rechnungsdatum ohne Abzug.`
				: 'Zahlbar sofort nach Erhalt der Rechnung ohne Abzug.'
	];
	if (hasSkonto(t)) {
		const net = money(afterSkonto(gross, t.skontoPercent));
		out.push(
			dates
				? `Bei Zahlung bis ${dates.skonto} gewähren wir ${percentLabel(t.skontoPercent)} Skonto – zu zahlen sind dann ${net}.`
				: `Bei Zahlung innerhalb von ${daysLabel(t.skontoDays)} ab Rechnungsdatum gewähren wir ${percentLabel(t.skontoPercent)} Skonto – das sind ${net}.`
		);
	}
	return out;
}

/** Zahlungsbedingungen aus dem Formular (ziel, skonto, skontotage) – oder eine Meldung */
export function readPaymentTerms(get: (key: string) => string): PaymentTerms | { message: string } {
	const days = Number(get('ziel').trim() || 0);
	if (!Number.isInteger(days) || days < 0 || days > 365) return { message: 'Das Zahlungsziel muss zwischen 0 und 365 Tagen liegen.' };
	const percent = parseAmount(get('skonto')) ?? 0;
	if (percent < 0 || percent > 20) return { message: 'Das Skonto muss zwischen 0 und 20 % liegen.' };
	const skontoDays = Number(get('skontotage').trim() || 0);
	if (!Number.isInteger(skontoDays) || skontoDays < 0 || skontoDays > 365) return { message: 'Die Frist fürs Skonto muss zwischen 0 und 365 Tagen liegen.' };
	if (percent > 0 && !skontoDays) return { message: 'Bitte eintragen, innerhalb wie vieler Tage das Skonto gilt.' };
	if (percent > 0 && skontoDays > days) return { message: 'Die Frist fürs Skonto ist länger als das Zahlungsziel.' };
	// Ohne Prozent kein Skonto – die Frist wäre sonst ein Überbleibsel
	return { paymentDays: days, skontoPercent: percent > 0 ? Math.round(percent * 100) / 100 : 0, skontoDays: percent > 0 ? skontoDays : 0 };
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

/** BV eines neuen Angebots – vorausgefüllt, zum Weiterschreiben bzw. Ändern */
export const OFFER_TITLE_DEFAULT = 'Bodenmarkierungen ';

/** Ins noch unveränderte BV geklickt: Cursor ans Ende – zum Weiterschreiben */
export function titleToEnd(e: FocusEvent) {
	const el = e.currentTarget as HTMLInputElement;
	// Erst nach dem Klick – der setzt den Cursor sonst wieder dorthin, wo geklickt wurde
	if (el.value === OFFER_TITLE_DEFAULT) setTimeout(() => el.setSelectionRange(el.value.length, el.value.length));
}

/** Rechnungsnummer, wie sie auf der Rechnung steht: „26 659" bzw. mit Kostenstelle „42 041/9526053" */
export function invoiceNo(i: { number: string; costCenter?: string | null }): string {
	const n = spacedNumber(i.number);
	return i.costCenter ? `${n}/${i.costCenter}` : n;
}

/** Anschrift als Zeilen, leere fallen weg */
export function addressLines(c: { name: string; addition: string; street: string; zip: string; city: string }): string[] {
	return [c.name, c.addition, c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter((l) => l.trim());
}
