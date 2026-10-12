/**
 * Angebot und Auftrag als PDF – im Aufbau der Angebote aus dem Büro:
 * Briefkopf, Anschrift links, Angebotsdaten rechts, Überschrift mit Nummer
 * und BV, Einleitung, Positionen (Nr., Bezeichnung, Menge, Einheit, EP, GP),
 * Summen, Schlusstext und unten Anschrift, Bankverbindung und Kontakt.
 *
 * Der Auftrag sieht gleich aus, aber ohne Preise und ohne die Texte für den
 * Kunden – dafür mit Partie, Ansprechpartner und Hinweis.
 */
import QRCode from 'qrcode';
import { dateTime } from '$lib/format';
import { bufferResponse, drawLogo, startPdf } from '$lib/server/pdf';
import { getSettings } from '$lib/server/settings';
import { letterheadPath } from '$lib/server/letterhead';
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '$lib/modules/stunden/signature';
import { LETTERHEAD, reportDateLabel } from '$lib/modules/tagesberichte/sheet';
import {
	addressLines,
	invoiceLabel,
	invoiceTotals,
	lineNumbers,
	lineTotal,
	money,
	offerTotals,
	priceLabel,
	quantityLabel,
	REVERSE_CHARGE_NOTE,
	spacedNumber
} from '../offer';
import type { SummaryColumn, SummaryReport } from '../summary';
// Zertifizierung (Bureau Veritas, ISO 9001 und ISO 45001) – als Daten-URL mitgebaut, kein Pfad nötig
import CERTIFICATE from './zertifikat.png?inline';
import type { InvoiceDetail } from './invoices';
import type { OfferDetail } from './offers';
import type { OrderDetail } from './orders';

const MM = 72 / 25.4;
const INK = '#1d2127';
const MUTED = '#5c626b';
const LINE = '#b9bdc3';

const LEFT = 25 * MM;
const RIGHT = 190 * MM;
const WIDTH = RIGHT - LEFT;
/** Ab hier beginnt die Fußzeile – darunter wird nichts mehr gesetzt */
const FOOTER_TOP = 297 * MM - 30 * MM;

const isoDate = (iso: string) => {
	const [y, m, d] = iso.split('-');
	return `${d}.${m}.${y}`;
};

type Doc = PDFKit.PDFDocument;

/**
 * Briefkopf: das hochgeladene Bild oder – ohne Bild – aus Text gesetzt. Auf
 * Angebot und Rechnung steht wie auf dem Briefpapier rechts neben der Anschrift
 * die Zertifizierung.
 */
function letterhead(doc: Doc, image: string | null, { certificate = false } = {}) {
	const top = 10 * MM;
	if (image) {
		doc.image(image, LEFT, top, { fit: [WIDTH, 34 * MM], align: 'center', valign: 'center' });
		return;
	}
	// Logo mittig, darunter Firma und Anschrift
	const logoW = 85 * MM;
	const y = top + drawLogo(doc, (doc.page.width - logoW) / 2, top, logoW) + 5;
	const center = (t: string, yy: number, size: number, bold = false) => {
		doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(INK);
		doc.text(t, LEFT, yy, { width: WIDTH, align: 'center', lineBreak: false });
	};
	center('BAUTENSCHUTZ GESELLSCHAFT M. B. H.', y, 6.5, true);
	center('Bodenmarkierungen', y + 9, 9, true);
	center(`${LETTERHEAD.lines[1]}, ${LETTERHEAD.lines[2]}`, y + 21, 6.5);
	center(LETTERHEAD.lines[3], y + 29, 6.5);
	if (certificate) doc.image(CERTIFICATE, doc.page.width / 2 + 47 * MM, y - 1, { width: 31 * MM });
}

/** Anschrift links, Angaben rechts – gibt die Unterkante zurück */
function addressAndFacts(doc: Doc, address: string[], facts: [string, string][]): number {
	const top = 52 * MM;
	doc.font('Helvetica').fontSize(10).fillColor(INK);
	let y = top;
	for (const l of address) {
		doc.text(l, LEFT, y, { width: 90 * MM, lineBreak: false, ellipsis: true });
		y += 13;
	}
	let fy = top + 4 * MM;
	for (const [label, value] of facts) {
		doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(label, 122 * MM, fy, { width: 40 * MM, lineBreak: false });
		doc.text(value, 162 * MM, fy, { width: RIGHT - 162 * MM, lineBreak: false, ellipsis: true });
		fy += 11.5;
	}
	return Math.max(y, fy);
}

/** Signatur (SVG-Pfad aus dem 600×200-Feld) in ein Kästchen setzen */
function signature(doc: Doc, path: string, x: number, y: number, w: number, h: number) {
	const scale = Math.min(w / SIGNATURE_WIDTH, h / SIGNATURE_HEIGHT);
	doc.save();
	doc.translate(x + (w - SIGNATURE_WIDTH * scale) / 2, y + (h - SIGNATURE_HEIGHT * scale) / 2);
	doc.scale(scale);
	doc.path(path).lineWidth(4).lineCap('round').lineJoin('round').strokeColor(INK).stroke();
	doc.restore();
}

interface Column {
	label: string;
	x: number;
	w: number;
	align?: 'left' | 'right';
}

interface Row {
	kind: 'position' | 'titel';
	nr: string;
	text: string;
	cells: string[];
}

/**
 * Positionstabelle mit Kopf. Reicht der Platz nicht, geht es auf der nächsten
 * Seite weiter – mit Kopf. Gibt die Unterkante zurück.
 */
function table(doc: Doc, y: number, columns: Column[], rows: Row[], continued: string): number {
	const textCol = columns[1];
	const head = (yy: number) => {
		doc.font('Helvetica').fontSize(8).fillColor(MUTED);
		for (const c of columns) doc.text(c.label, c.x, yy, { width: c.w, align: c.align ?? 'left', lineBreak: false });
		doc
			.moveTo(LEFT, yy + 12)
			.lineTo(RIGHT, yy + 12)
			.lineWidth(0.8)
			.strokeColor(INK)
			.stroke();
		return yy + 18;
	};
	y = head(y);
	for (const row of rows) {
		const titel = row.kind === 'titel';
		doc.font('Helvetica-Bold').fontSize(titel ? 10.5 : 9.5);
		const textW = titel ? RIGHT - textCol.x : textCol.w;
		const height = Math.max(12, doc.heightOfString(row.text || ' ', { width: textW, lineGap: 1 })) + (titel ? 10 : 8);
		if (y + height > FOOTER_TOP - 6 * MM) {
			doc.addPage();
			doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(continued, LEFT, 15 * MM, { width: WIDTH, lineBreak: false });
			y = head(23 * MM);
		}
		const top = y + (titel ? 6 : 2);
		doc.font(titel ? 'Helvetica-Bold' : 'Helvetica').fontSize(titel ? 10.5 : 9).fillColor(INK);
		doc.text(row.nr, columns[0].x, top + (titel ? 0 : 0.5), { width: columns[0].w, lineBreak: false });
		doc.font('Helvetica-Bold').fontSize(titel ? 10.5 : 9.5).text(row.text, textCol.x, top, { width: textW, lineGap: 1 });
		if (!titel) {
			doc.font('Helvetica').fontSize(9.5);
			columns.slice(2).forEach((c, i) => {
				doc.text(row.cells[i] ?? '', c.x, top, { width: c.w, align: c.align ?? 'left', lineBreak: false });
			});
		}
		y += height;
		if (!titel) {
			doc
				.moveTo(LEFT, y - 3)
				.lineTo(RIGHT, y - 3)
				.lineWidth(0.4)
				.strokeColor(LINE)
				.stroke();
		}
	}
	return y;
}

/** Freier Text über die ganze Breite – bricht bei Bedarf auf die nächste Seite um */
function paragraph(doc: Doc, text: string, y: number, size = 9.5): number {
	if (!text.trim()) return y;
	doc.font('Helvetica').fontSize(size).fillColor(INK);
	for (const part of text.split('\n')) {
		const h = doc.heightOfString(part || ' ', { width: WIDTH, lineGap: 1.5 });
		if (y + h > FOOTER_TOP - 4 * MM) {
			doc.addPage();
			y = 20 * MM;
		}
		doc.text(part || ' ', LEFT, y, { width: WIDTH, lineGap: 1.5 });
		y += h;
	}
	return y;
}

/** Summen rechtsbündig unter der Tabelle: Beschriftung, Betrag, die letzte fett */
function sumsBlock(doc: Doc, y: number, sums: [string, string, boolean][]): number {
	if (y + 30 * MM > FOOTER_TOP - 4 * MM) {
		doc.addPage();
		y = 20 * MM;
	}
	y += 4 * MM;
	const sumX = 118 * MM;
	for (const [label, value, strong] of sums) {
		doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11.5 : 9.5).fillColor(INK);
		doc.text(label, sumX, y, { width: 40 * MM, lineBreak: false });
		doc.text(value, sumX + 40 * MM, y, { width: RIGHT - sumX - 40 * MM, align: 'right', lineBreak: false });
		y += strong ? 17 : 15;
		doc
			.moveTo(sumX, y - 4)
			.lineTo(RIGHT, y - 4)
			.lineWidth(strong ? 1 : 0.4)
			.strokeColor(strong ? INK : LINE)
			.stroke();
	}
	return y;
}

/** „Ausführungsort: …" – Beschriftung fett, der Text bricht bei Bedarf um */
function labeled(doc: Doc, label: string, value: string, y: number): number {
	if (!value.trim()) return y;
	doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`${label}: `, LEFT, y, { width: WIDTH, continued: true, lineGap: 1.5 });
	doc.font('Helvetica').text(value, { lineGap: 1.5 });
	return doc.y + 3 * MM;
}

/** Auf jede Seite: Fußzeile mit drei Spalten (nur Angebot) und „Seite x von y" */
function finishPages(doc: Doc, footer: [string, string][] | null) {
	const range = doc.bufferedPageRange();
	for (let i = range.start; i < range.start + range.count; i++) {
		doc.switchToPage(i);
		if (footer) {
			doc
				.moveTo(LEFT, FOOTER_TOP)
				.lineTo(RIGHT, FOOTER_TOP)
				.lineWidth(0.6)
				.strokeColor(INK)
				.stroke();
			const colW = WIDTH / 3;
			footer.forEach(([title, body], c) => {
				const x = LEFT + c * colW;
				doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(title, x, FOOTER_TOP + 5, { width: colW - 8, lineBreak: false });
				let y = FOOTER_TOP + 16;
				doc.font('Helvetica').fontSize(7.5).fillColor(INK);
				for (const l of body.split('\n').slice(0, 6)) {
					doc.text(l, x, y, { width: colW - 8, lineBreak: false, ellipsis: true });
					y += 9.5;
				}
			});
		}
		if (range.count > 1) {
			doc
				.font('Helvetica')
				.fontSize(7.5)
				.fillColor(MUTED)
				.text(`Seite ${i - range.start + 1} von ${range.count}`, LEFT, FOOTER_TOP - 11, { width: WIDTH, align: 'right', lineBreak: false });
		}
	}
}

/* ------------------------------------------------------------- Angebot */

export async function offerPdf(offer: OfferDetail, { forCustomer = false } = {}): Promise<Response> {
	const settings = await getSettings();
	const title = `Angebot Nr. ${spacedNumber(offer.number)}`;
	const { doc, finish } = startPdf({ title, margin: 8, bufferPages: true });

	letterhead(doc, letterheadPath(settings.letterheadFile), { certificate: true });
	if (!forCustomer && offer.status === 'entwurf') {
		doc.font('Helvetica-Bold').fontSize(9).fillColor('#b42318').text('ENTWURF – nicht freigegeben', LEFT, 10 * MM, { width: WIDTH, align: 'right', lineBreak: false });
	}

	let y = addressAndFacts(doc, addressLines({ name: offer.customerName, addition: offer.customerAddition, street: offer.customerStreet, zip: offer.customerZip, city: offer.customerCity }), [
		['Angebotsdatum:', isoDate(offer.date)],
		['Kunden UID-Nummer:', offer.customerUid],
		['Projektnummer:', offer.projectNumber],
		['Angebotsnummer:', offer.number]
	]);

	y += 12 * MM;
	doc.font('Helvetica-Bold').fontSize(14).fillColor(INK);
	const heading = `${title}${offer.title ? ` / BV: ${offer.title}` : ''}`;
	doc.text(heading, LEFT, y, { width: WIDTH, lineGap: 2 });
	y += doc.heightOfString(heading, { width: WIDTH, lineGap: 2 }) + 5 * MM;
	y = labeled(doc, 'Ausführungsort', offer.location, y);
	y += 1 * MM;

	y = paragraph(doc, offer.intro, y, 10) + 5 * MM;

	const numbers = lineNumbers(offer.lines);
	const rows: Row[] = offer.lines.map((l, i) => ({
		kind: l.kind,
		nr: numbers[i],
		text: l.text,
		cells: [quantityLabel(l.quantity), l.unit, priceLabel(l.unitPrice), money(lineTotal(l))]
	}));
	y = table(
		doc,
		y,
		[
			{ label: 'Nr.', x: LEFT, w: 12 * MM },
			{ label: 'Bezeichnung', x: LEFT + 12 * MM, w: 74 * MM },
			{ label: 'Menge', x: 111 * MM, w: 16 * MM, align: 'right' },
			{ label: 'Einheit', x: 130 * MM, w: 18 * MM },
			{ label: 'EP', x: 148 * MM, w: 19 * MM, align: 'right' },
			{ label: 'GP', x: 168 * MM, w: RIGHT - 168 * MM, align: 'right' }
		],
		rows,
		`${title} – Fortsetzung`
	);

	const totals = offerTotals(offer.lines, offer.vatRate);
	y = sumsBlock(doc, y, [
		['Gesamt Netto', money(totals.net), false],
		[`${String(offer.vatRate).replace('.', ',')} % Umsatzsteuer`, money(totals.vat), false],
		['Gesamtbetrag', money(totals.gross), true]
	]);

	y = paragraph(doc, offer.closing, y + 6 * MM);

	// Angenommen: Name, Tag und Unterschrift des Kunden
	if (offer.acceptedAt && offer.acceptedSignature) {
		if (y + 30 * MM > FOOTER_TOP - 4 * MM) {
			doc.addPage();
			y = 20 * MM;
		}
		y += 8 * MM;
		const boxW = 65 * MM;
		signature(doc, offer.acceptedSignature, LEFT, y, boxW, 16 * MM);
		y += 17 * MM;
		doc
			.moveTo(LEFT, y)
			.lineTo(LEFT + boxW, y)
			.lineWidth(0.6)
			.strokeColor(INK)
			.stroke();
		doc
			.font('Helvetica')
			.fontSize(8)
			.fillColor(MUTED)
			.text(`Angenommen für den Auftraggeber: ${offer.acceptedName ?? ''}, ${dateTime(offer.acceptedAt)}`, LEFT, y + 3, { width: WIDTH, lineBreak: false });
	}

	finishPages(doc, [
		['Anschrift', settings.offerFooterAddress],
		['Bankverbindung', settings.offerFooterBank],
		['Kontakt', settings.offerFooterContact]
	]);
	const buffer = await finish();
	return bufferResponse(`angebot-${offer.number}.pdf`.replace(/[^\w.-]/g, '_'), buffer);
}

/* ------------------------------------------------------------- Auftrag */

export async function orderPdf(order: OrderDetail): Promise<Response> {
	const settings = await getSettings();
	const title = `Auftrag Nr. ${spacedNumber(order.number)}`;
	const { doc, finish } = startPdf({ title, margin: 8, bufferPages: true });

	letterhead(doc, letterheadPath(settings.letterheadFile));
	const created = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
	let y = addressAndFacts(doc, addressLines({ name: order.customerName, addition: order.customerAddition, street: order.customerStreet, zip: order.customerZip, city: order.customerCity }), [
		['Auftragsdatum:', new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(created)],
		['Projektnummer:', order.projectNumber],
		['Auftragsnummer:', order.number],
		['Partie:', order.partyName ?? '–']
	]);

	y += 12 * MM;
	doc.font('Helvetica-Bold').fontSize(14).fillColor(INK);
	const heading = `${title}${order.title ? ` / BV: ${order.title}` : ''}`;
	doc.text(heading, LEFT, y, { width: WIDTH, lineGap: 2 });
	y += doc.heightOfString(heading, { width: WIDTH, lineGap: 2 }) + 5 * MM;
	y = labeled(doc, 'Ausführungsort', order.location, y);

	const contact = [order.customerContact && `Ansprechpartner: ${order.customerContact}`, order.customerPhone && `Tel. ${order.customerPhone}`].filter(Boolean).join(' · ');
	if (contact) y = paragraph(doc, contact, y, 9.5) + 4 * MM;

	const numbers = lineNumbers(order.lines);
	y = table(
		doc,
		y,
		[
			{ label: 'Nr.', x: LEFT, w: 12 * MM },
			{ label: 'Bezeichnung', x: LEFT + 12 * MM, w: 112 * MM },
			{ label: 'Menge', x: 150 * MM, w: 18 * MM, align: 'right' },
			{ label: 'Einheit', x: 172 * MM, w: RIGHT - 172 * MM }
		],
		order.lines.map((l, i) => ({ kind: l.kind, nr: numbers[i], text: l.text, cells: [quantityLabel(l.quantity), l.unit] })),
		`${title} – Fortsetzung`
	);

	if (order.note.trim()) {
		y += 6 * MM;
		doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Hinweis für die Partie', LEFT, y, { lineBreak: false });
		y = paragraph(doc, order.note, y + 15);
	}

	// Pläne und andere Unterlagen gibt es in der App – hier nur, welche dazugehören
	if (order.documents.length) {
		y += 5 * MM;
		y = labeled(doc, 'Unterlagen in der App', order.documents.map((d) => d.title).join(', '), y);
	}

	finishPages(doc, null);
	const buffer = await finish();
	return bufferResponse(`auftrag-${order.number}.pdf`.replace(/[^\w.-]/g, '_'), buffer);
}

/* ------------------------------------------------------------ Rechnung */

/** Positionstabelle wie im Angebot: Nr., Bezeichnung, Menge, Einheit, EP, GP */
const PRICED_COLUMNS: Column[] = [
	{ label: 'Nr.', x: LEFT, w: 12 * MM },
	{ label: 'Bezeichnung', x: LEFT + 12 * MM, w: 74 * MM },
	{ label: 'Menge', x: 111 * MM, w: 16 * MM, align: 'right' },
	{ label: 'Einheit', x: 130 * MM, w: 18 * MM },
	{ label: 'EP', x: 148 * MM, w: 19 * MM, align: 'right' },
	{ label: 'GP', x: 168 * MM, w: RIGHT - 168 * MM, align: 'right' }
];

/**
 * Prüfcode: QR-Code zur öffentlichen Prüfseite, daneben Adresse und
 * Ausstellungsdatum – ausdrücklich kein Registrierkassen-Code.
 */
function verifyBlock(doc: Doc, y: number, url: string, issuedAt: Date) {
	const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
	const n = qr.modules.size;
	const width = 24 * MM;
	const cell = width / n;
	doc.save();
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) doc.rect(LEFT + c * cell, y + r * cell, cell + 0.05, cell + 0.05);
	}
	doc.fillColor(INK).fill();
	doc.restore();
	const x = LEFT + width + 5 * MM;
	const w = RIGHT - x;
	doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Rechnung online prüfen', x, y + 1, { width: w });
	doc
		.font('Helvetica')
		.fontSize(8)
		.fillColor(MUTED)
		.text('Echtheit und Unversehrtheit dieser Rechnung lassen sich über den Code oder diese Adresse prüfen:', x, doc.y + 1.5, { width: w });
	doc.font('Helvetica').fontSize(8).fillColor(INK).text(url, x, doc.y + 1.5, { width: w, link: url });
	doc
		.font('Helvetica')
		.fontSize(7.5)
		.fillColor(MUTED)
		.text(`Ausgestellt am ${dateTime(issuedAt)} · Prüfcode des Rechnungssystems, kein Registrierkassen-Beleg`, x, doc.y + 1.5, { width: w });
	return Math.max(y + width, doc.y);
}

/** Entwürfe sind als solche erkennbar – gültig ist erst die ausgestellte Rechnung */
function draftMark(doc: Doc) {
	const range = doc.bufferedPageRange();
	for (let i = range.start; i < range.start + range.count; i++) {
		doc.switchToPage(i);
		doc.save();
		doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
		doc.font('Helvetica-Bold').fontSize(110).fillColor('#8a9097').fillOpacity(0.16);
		doc.text('ENTWURF', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false });
		doc.restore();
	}
}

export interface InvoicePdfOptions {
	/** Endgültig ausgestellt: Ausstellungszeit und – wenn die Prüfseite an ist – der Prüfcode */
	issued?: { issuedAt: Date; verifyUrl: string | null } | null;
}

export async function invoicePdf(invoice: InvoiceDetail): Promise<Response> {
	const buffer = await invoicePdfBuffer(invoice);
	return bufferResponse(invoicePdfName(invoice), buffer);
}

export const invoicePdfName = (invoice: Pick<InvoiceDetail, 'kind' | 'number'>) => `${invoice.kind}-${invoice.number}.pdf`.replace(/[^\w.-]/g, '_');

/**
 * Das Rechnungs-PDF. Entwürfe tragen „ENTWURF"; die ausgestellte Fassung wird
 * genau einmal erzeugt, archiviert und dann nur noch aus dem Archiv geliefert.
 */
export async function invoicePdfBuffer(invoice: InvoiceDetail, { issued = null }: InvoicePdfOptions = {}): Promise<Buffer> {
	const settings = await getSettings();
	const isStorno = invoice.kind === 'storno';
	const title = `${invoiceLabel(invoice.kind)} Nr. ${spacedNumber(invoice.number)}`;
	const { doc, finish } = startPdf({ title, margin: 8, bufferPages: true, pdfVersion: '1.7' });

	letterhead(doc, letterheadPath(settings.letterheadFile), { certificate: true });
	let y = addressAndFacts(
		doc,
		addressLines({ name: invoice.customerName, addition: invoice.customerAddition, street: invoice.customerStreet, zip: invoice.customerZip, city: invoice.customerCity }),
		[
			['Rechnungsdatum:', isoDate(invoice.date)],
			['Kunden UID-Nummer:', invoice.customerUid],
			['Projektnummer:', invoice.projectNumber],
			['Rechnungsnummer:', invoice.number],
			...(isStorno ? [] : ([['Zahlbar bis:', isoDate(invoice.dueDate)]] as [string, string][]))
		]
	);

	y += 12 * MM;
	doc.font('Helvetica-Bold').fontSize(14).fillColor(INK);
	const heading = `${title}${invoice.title ? ` / BV: ${invoice.title}` : ''}`;
	doc.text(heading, LEFT, y, { width: WIDTH, lineGap: 2 });
	y += doc.heightOfString(heading, { width: WIDTH, lineGap: 2 }) + 5 * MM;
	if (invoice.cancelsNumber && invoice.cancelsDate) {
		y = labeled(doc, 'Storno zu', `${invoiceLabel(invoice.cancelsKind ?? 'rechnung')} Nr. ${spacedNumber(invoice.cancelsNumber)} vom ${isoDate(invoice.cancelsDate)}`, y);
	}
	y = labeled(doc, 'Ausführungsort', invoice.location, y);
	if (invoice.serviceFrom) y = labeled(doc, 'Leistungszeitraum', reportDateLabel(invoice.serviceFrom, invoice.serviceTo), y);
	if (invoice.reports.length) y = labeled(doc, 'Tagesberichte', `Nr. ${invoice.reports.map((r) => r.number || '–').join(', ')}`, y);
	y += 1 * MM;

	y = paragraph(doc, invoice.intro, y, 10) + 5 * MM;

	// Nummern wie im Angebot – ältere Zeilen ohne Nummer werden durchgezählt
	const numbers = lineNumbers(invoice.lines);
	y = table(
		doc,
		y,
		PRICED_COLUMNS,
		invoice.lines.map((l, i) => ({
			kind: l.kind,
			nr: l.number || numbers[i],
			text: l.text,
			cells: [quantityLabel(l.quantity), l.unit, priceLabel(l.unitPrice), money(lineTotal(l))]
		})),
		`${title} – Fortsetzung`
	);

	const totals = invoiceTotals(invoice.lines, invoice.vatRate, invoice.reverseCharge);
	y = sumsBlock(
		doc,
		y,
		invoice.reverseCharge
			? [
					['Gesamt Netto', money(totals.net), false],
					['Gesamtbetrag', money(totals.gross), true]
				]
			: [
					['Gesamt Netto', money(totals.net), false],
					[`${String(invoice.vatRate).replace('.', ',')} % Umsatzsteuer`, money(totals.vat), false],
					['Gesamtbetrag', money(totals.gross), true]
				]
	);

	y += 6 * MM;
	if (invoice.reverseCharge) {
		y = paragraph(doc, `${REVERSE_CHARGE_NOTE}\nUID-Nummer des Leistungsempfängers: ${invoice.customerUid}`, y) + 3 * MM;
	}
	if (y + 14 > FOOTER_TOP - 4 * MM) {
		doc.addPage();
		y = 20 * MM;
	}
	if (!isStorno) {
		doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Zahlbar bis ${isoDate(invoice.dueDate)} ohne Abzug.`, LEFT, y, { width: WIDTH, lineBreak: false });
		y += 16;
	}
	y = paragraph(doc, invoice.closing, y + 3 * MM);

	if (issued?.verifyUrl) {
		y += 6 * MM;
		if (y + 26 * MM > FOOTER_TOP - 4 * MM) {
			doc.addPage();
			y = 20 * MM;
		}
		verifyBlock(doc, y, issued.verifyUrl, issued.issuedAt);
	}

	if (!issued && invoice.stage === 'entwurf') draftMark(doc);
	finishPages(doc, [
		['Anschrift', settings.offerFooterAddress],
		['Bankverbindung', settings.offerFooterBank],
		['Kontakt', settings.offerFooterContact]
	]);
	return finish();
}

/* ---------------------------------------------------------- Summenblatt */

export interface SummarySheet {
	/** Für Dateiname und PDF-Titel, z. B. „Auftrag 26 015" */
	name: string;
	year: number;
	/** „zu Rechnung Nr." (eine oder mehrere, schon formatiert) – leer bleibt die Linie zum Ausfüllen */
	invoiceNumber: string;
	state: string;
	section: string;
	/** Die zählenden Berichte, in der Reihenfolge des Blatts */
	reports: SummaryReport[];
	columns: SummaryColumn[];
	/** LV-Position je Spalte (Nummer der zugeordneten Angebotsposition) */
	lv: Record<string, string>;
	/** Berichte, die (noch) nicht zählen – nur als Hinweis in der Fußzeile */
	notCounted: number;
}

/** Datum kurz für die schmale Spalte „vom": 05.10.26, 05.–07.10., 30.09.–02.10. */
function shortRange(from: string, to: string | null): string {
	const [y, m, d] = from.split('-');
	if (!to || to <= from) return `${d}.${m}.${y.slice(2)}`;
	const [y2, m2, d2] = to.split('-');
	return y === y2 && m === m2 ? `${d}.–${d2}.${m}.` : `${d}.${m}.–${d2}.${m2}.`;
}

/**
 * Tagesbericht-Summenblatt wie der Vordruck (Vorlage 2019), A4 quer: Briefkopf
 * links, Titel mit Jahr und „zu Rechnung Nr.", rechts Bundesland und Abschnitt.
 * Darunter das Raster: T.B.Nr., vom und elf Mengenspalten mit LV., LB., MSK und
 * Einheit im Kopf, je Bericht eine Zeile, in der letzten die Summe. Mehr
 * Berichte gehen auf der nächsten Seite weiter (mit Übertrag), mehr Spalten in
 * einem weiteren Blatt mit denselben Berichten.
 */
export async function summaryPdf(sheet: SummarySheet): Promise<Response> {
	const settings = await getSettings();
	const title = `Tagesbericht-Summenblatt ${sheet.year}`;
	const { doc, finish } = startPdf({ title: `${title} · ${sheet.name}`, landscape: true, margin: 8, bufferPages: true });

	// Maße vom Vordruck abgenommen (Punkt, A4 quer)
	const L = 14.4;
	const R = 826.3;
	const TOP = 121.8;
	const HEAD_BOTTOM = 179.3;
	const BOTTOM = 562;
	const ROWS = 22;
	const ROW_H = (BOTTOM - HEAD_BOTTOM) / ROWS;
	const NR = { x: L, w: 42.4 };
	const VOM = { x: L + 42.4, w: 35.6 };
	const QX = VOM.x + VOM.w;
	const PER_PAGE = 11;
	const QW = (R - QX) / PER_PAGE;
	const DOTS = '………………..';
	const image = letterheadPath(settings.letterheadFile);

	const fit = (text: string, width: number, size: number, min: number, bold = false) => {
		doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
		const w = doc.widthOfString(text);
		return w > width ? Math.max(min, (size * width) / w) : size;
	};

	const blocks: SummaryColumn[][] = [];
	for (let i = 0; i < sheet.columns.length; i += PER_PAGE) blocks.push(sheet.columns.slice(i, i + PER_PAGE));
	if (!blocks.length) blocks.push([]);
	const chunks: SummaryReport[][] = [];
	for (let i = 0; i < sheet.reports.length; i += ROWS - 1) chunks.push(sheet.reports.slice(i, i + ROWS - 1));
	if (!chunks.length) chunks.push([]);

	let first = true;
	for (const [b, cols] of blocks.entries()) {
		const running: Record<string, number> = {};
		for (const [c, rows] of chunks.entries()) {
			if (!first) doc.addPage();
			first = false;

			/* ------------------------------------------------ Kopf */
			if (image) {
				doc.image(image, L, 24, { fit: [278, 88], align: 'center', valign: 'center' });
			} else {
				const boxW = 278;
				const logoW = 200;
				const y = 30 + drawLogo(doc, L + (boxW - logoW) / 2, 30, logoW) + 4;
				const center = (t: string, yy: number, size: number, bold = false) =>
					doc
						.font(bold ? 'Helvetica-Bold' : 'Helvetica')
						.fontSize(size)
						.fillColor(INK)
						.text(t, L, yy, { width: boxW, align: 'center', lineBreak: false });
				center('BAUTENSCHUTZ GESELLSCHAFT M. B. H.', y, 5.5, true);
				center('Bodenmarkierungen', y + 8, 8, true);
				center(`${LETTERHEAD.lines[1]}, ${LETTERHEAD.lines[2]}`, y + 19, 5.5);
				center(LETTERHEAD.lines[3], y + 26, 5.5);
			}
			doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(title, 296, 52, { underline: true, lineBreak: false });
			const invoice = sheet.invoiceNumber || DOTS;
			doc.font('Helvetica-Bold').fontSize(10).text(`zu Rechnung Nr. ${invoice}`, 296, 79.5, { width: 260, lineBreak: false, ellipsis: true });
			doc.text('Bundesland', 564.3, 54, { lineBreak: false });
			doc.text('Abschnitt', 564.3, 79.5, { lineBreak: false });
			for (const [value, y] of [
				[sheet.state, 54],
				[sheet.section, 79.5]
			] as const) {
				const text = value.trim() || DOTS;
				doc
					.font(value.trim() ? 'Helvetica-Bold' : 'Helvetica')
					.fontSize(fit(text, R - 631.4, 10, 7, !!value.trim()))
					.text(text, 631.4, y + (value.trim() ? 0 : 0), { width: R - 631.4, lineBreak: false, ellipsis: true });
			}

			/* ------------------------------------------------ Tabellenkopf */
			doc.font('Helvetica').fontSize(10).fillColor(INK);
			doc.text('T.B.Nr.', NR.x, 168.6, { width: NR.w, align: 'center', lineBreak: false });
			doc.text('vom', VOM.x, 168.6, { width: VOM.w, align: 'center', lineBreak: false });
			for (let i = 0; i < PER_PAGE; i++) {
				const col = cols[i];
				const x = QX + i * QW + 1.5;
				const w = QW - 3;
				const label = (text: string, value: string, y: number) => {
					doc.font('Helvetica').fontSize(8).fillColor(INK).text(text, x, y, { lineBreak: false });
					if (!value) return;
					const lx = x + doc.widthOfString(text) + 3;
					doc
						.font('Helvetica-Bold')
						.fontSize(fit(value, x + w - lx, 8, 6, true))
						.text(value, lx, y, { width: x + w - lx, lineBreak: false, ellipsis: true });
				};
				label('LV.', col ? (sheet.lv[col.key] ?? '') : '', 127.6);
				if (col?.label) {
					// Zusammengezählt nach Bezeichnung (z. B. „RRL 0,15 MSK C ref"): sie steht statt LB. und MSK da
					doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK).text(col.label, x, 137.8, { width: w, height: 28, lineGap: -0.5, ellipsis: true });
				} else {
					label('LB.', col?.lbPos ?? '', 137.8);
					label('MSK………..', '', 148);
				}
				label('Einheit', col?.unit ?? '', 168.4);
			}

			/* ------------------------------------------------ Zeilen */
			const rowTop = (r: number) => HEAD_BOTTOM + r * ROW_H;
			const textY = (r: number, size: number) => rowTop(r) + (ROW_H - size) / 2 + 0.5;
			rows.forEach((rep, r) => {
				const nr = rep.number || '–';
				doc
					.font('Helvetica')
					.fontSize(fit(nr, NR.w - 4, 9, 6))
					.text(nr, NR.x + 2, textY(r, 9), { width: NR.w - 4, align: 'center', lineBreak: false });
				const vom = shortRange(rep.date, rep.dateTo);
				const vs = fit(vom, VOM.w - 3, 8.5, 5.5);
				doc.fontSize(vs).text(vom, VOM.x + 1.5, textY(r, vs), { width: VOM.w - 3, align: 'center', lineBreak: false });
				cols.forEach((col, i) => {
					const v = rep.values[col.key];
					if (v) running[col.key] = (running[col.key] ?? 0) + v;
					if (!v) return;
					doc
						.font('Helvetica')
						.fontSize(9)
						.text(quantityLabel(v), QX + i * QW + 2, textY(r, 9), { width: QW - 6, align: 'right', lineBreak: false });
				});
			});

			// Letzte Zeile: Summe – auf früheren Seiten der Übertrag bis hierher
			const last = c === chunks.length - 1;
			const sumRow = ROWS - 1;
			doc
				.font('Helvetica-Bold')
				.fontSize(9)
				.text(last ? 'Summe' : 'Übertrag', NR.x + 3, textY(sumRow, 9), { width: NR.w + VOM.w - 6, lineBreak: false });
			cols.forEach((col, i) => {
				const v = running[col.key];
				if (!v) return;
				doc.text(quantityLabel(Math.round(v * 1000) / 1000), QX + i * QW + 2, textY(sumRow, 9), { width: QW - 6, align: 'right', lineBreak: false });
			});

			/* ------------------------------------------------ Linien */
			doc.lineCap('butt').strokeColor(INK);
			const hline = (y: number, w: number) => doc.moveTo(L, y).lineTo(R, y).lineWidth(w).stroke();
			const vline = (x: number, y1: number, y2: number, w: number) => doc.moveTo(x, y1).lineTo(x, y2).lineWidth(w).stroke();
			for (let r = 1; r < ROWS; r++) hline(rowTop(r), r === sumRow ? 1.2 : 0.6);
			// „Summe" steht über T.B.Nr. und vom – dort endet die Linie dazwischen vorher
			vline(NR.x + NR.w, TOP, rowTop(sumRow), 0.6);
			for (const x of [VOM.x + VOM.w, ...Array.from({ length: PER_PAGE - 1 }, (_, i) => QX + (i + 1) * QW)]) vline(x, TOP, BOTTOM, 0.6);
			// Kopf und Rahmen kräftig wie auf dem Vordruck
			doc.rect(L, TOP, R - L, HEAD_BOTTOM - TOP).lineWidth(1.6).stroke();
			doc.rect(L, TOP, R - L, BOTTOM - TOP).lineWidth(1.2).stroke();

			/* ------------------------------------------------ Hinweis unten */
			const notes = [
				`Erstellt am ${new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())}`,
				'es zählen geprüfte und vom Kunden unterschriebene Tagesberichte',
				sheet.notCounted
					? `${sheet.notCounted} ${sheet.notCounted === 1 ? 'Bericht ist noch nicht geprüft und fehlt' : 'Berichte sind noch nicht geprüft und fehlen'}`
					: '',
				blocks.length > 1 ? `Spalten ${b * PER_PAGE + 1}–${b * PER_PAGE + cols.length} von ${sheet.columns.length}` : ''
			];
			doc
				.font('Helvetica')
				.fontSize(7)
				.fillColor(MUTED)
				.text(notes.filter(Boolean).join(' · '), L, 568, { width: (R - L) * 0.8, lineBreak: false, ellipsis: true });
		}
	}

	const range = doc.bufferedPageRange();
	if (range.count > 1) {
		for (let i = range.start; i < range.start + range.count; i++) {
			doc.switchToPage(i);
			doc
				.font('Helvetica')
				.fontSize(7)
				.fillColor(MUTED)
				.text(`Seite ${i - range.start + 1} von ${range.count}`, R - 120, 568, { width: 120, align: 'right', lineBreak: false });
		}
	}
	const buffer = await finish();
	return bufferResponse(`summenblatt-${sheet.name}.pdf`.replace(/\s+/g, '-').replace(/[^\w.-]/g, '_'), buffer);
}
