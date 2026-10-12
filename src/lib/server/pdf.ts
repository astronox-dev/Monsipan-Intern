/**
 * PDF-Ausgabe für alles, was auch gedruckt werden kann.
 *
 * Bewusst schlicht: ein Kopf mit Titel und Filterangaben, eine oder mehrere
 * Tabellen, optional Angaben als Beschriftung/Wert und Unterschriftszeilen.
 * Gezeichnet wird mit pdfkit; die Schrift ist Liberation Sans (siehe unten).
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { APP_NAME } from '$lib/app';
import { strokePath, type InkStroke } from '$lib/ink';
import { LOGO } from '$lib/logo';

/**
 * Die eingebaute Helvetica von pdfkit kennt nur westeuropäische Zeichen – Namen
 * wie Kokić oder Čolić zerfielen. Liberation Sans ist maßgleich mit Helvetica und
 * Arial und deckt auch ć, č, š, ž, đ, ł, ő usw. ab. Sie wird unter den Namen der
 * Helvetica angemeldet, damit alle Zeichnungen unverändert bleiben; ins PDF kommen
 * nur die verwendeten Zeichen. Die Dateien liegen im Ordner „fonts" (mit Lizenz).
 */
const FONT_FILES = {
	Helvetica: 'LiberationSans-Regular.ttf',
	'Helvetica-Bold': 'LiberationSans-Bold.ttf',
	'Helvetica-Oblique': 'LiberationSans-Italic.ttf',
	'Helvetica-BoldOblique': 'LiberationSans-BoldItalic.ttf'
} as const;

let fontsFolder: string | null = null;

function fontFile(name: keyof typeof FONT_FILES): string {
	if (!fontsFolder) {
		const candidates = [path.resolve('fonts'), path.resolve(process.cwd(), 'fonts')];
		fontsFolder = candidates.find((c) => fs.existsSync(path.join(c, FONT_FILES.Helvetica))) ?? null;
		if (!fontsFolder) throw new Error('Schriftordner "fonts" nicht gefunden');
	}
	return path.join(fontsFolder, FONT_FILES[name]);
}

/**
 * Startschrift beim Anlegen des Dokuments – sonst legt pdfkit die eingebaute
 * Helvetica unter diesem Namen ab, und ein späteres Anmelden griffe nicht mehr.
 */
const baseFont = () => fontFile('Helvetica');

/** Alle vier Schnitte unter den Helvetica-Namen anmelden */
function useFonts(doc: PDFKit.PDFDocument) {
	for (const name of Object.keys(FONT_FILES) as (keyof typeof FONT_FILES)[]) doc.registerFont(name, fontFile(name));
	doc.font('Helvetica');
}

export type Align = 'left' | 'right' | 'center';

export interface PdfColumn {
	label: string;
	/** Anteil an der Breite; die Summe aller Spalten füllt die Seite */
	width: number;
	align?: Align;
}

export type PdfCell = string | number | null | undefined;

export interface PdfTable {
	heading?: string;
	columns: PdfColumn[];
	rows: PdfCell[][];
	/** Abschlusszeile, z. B. Summen – wird hervorgehoben */
	footer?: PdfCell[];
	/** Text, wenn es keine Zeilen gibt */
	empty?: string;
}

export interface PdfOptions {
	title: string;
	/** Kurzangaben unter dem Titel: Filter, Zeitraum, Anzahl */
	facts?: string[];
	notice?: string | null;
	landscape?: boolean;
	tables?: PdfTable[];
	/** Angaben als Beschriftung/Wert, z. B. Auslöse oder Tagesleistung */
	pairs?: { label: string; value: string }[];
	note?: string | null;
	/** Hinweiszeile über den Unterschriften, z. B. der KV-Satz */
	footnote?: string | null;
	signatures?: string[];
}

const COLORS = { ink: '#1d2127', muted: '#5c626b', line: '#c9ccd1', band: '#f1f2f4' };
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';

const dec = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 3 });
const dt = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function text(v: PdfCell): string {
	if (v == null) return '';
	if (typeof v === 'number') return Number.isFinite(v) ? dec.format(v) : '';
	return String(v);
}

/**
 * Leeres Dokument für Formulare, die genau wie ihre Papiervorlage aussehen
 * sollen (z. B. der Lohnzettel). Gezeichnet wird dort mit pdfkit direkt.
 */
export function startPdf(opts: {
	title: string;
	landscape?: boolean;
	margin?: number;
	/** Seiten behalten, um am Ende auf jede noch etwas zu setzen (Fußzeile, „Seite 1 von 3") */
	bufferPages?: boolean;
	/** Rechnungen: 1.7, die Grundlage für PAdES-Signaturen */
	pdfVersion?: '1.7';
}) {
	const margin = opts.margin ?? 36;
	const doc = new PDFDocument({
		size: 'A4',
		layout: opts.landscape ? 'landscape' : 'portrait',
		margins: { top: margin, bottom: margin, left: margin, right: margin },
		bufferPages: opts.bufferPages ?? false,
		info: { Title: opts.title, Author: APP_NAME, Creator: APP_NAME },
		font: baseFont(),
		...(opts.pdfVersion ? { pdfVersion: opts.pdfVersion } : {})
	});
	useFonts(doc);
	const chunks: Buffer[] = [];
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('data', (c: Buffer) => chunks.push(c));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});
	return {
		doc,
		finish: async () => {
			doc.end();
			return done;
		}
	};
}

/** Handschrift einer Seite obenauf zeichnen – die Striche liegen schon in Punkten dieser Seite */
export function drawInk(doc: PDFKit.PDFDocument, strokes: InkStroke[] | undefined) {
	if (!strokes?.length) return;
	doc.save();
	for (const s of strokes) {
		doc.path(strokePath(s.p)).lineWidth(s.w).lineCap('round').lineJoin('round').strokeColor(s.c).stroke();
	}
	doc.restore();
}

/**
 * Das Logo als Vektor: links oben bei (x, y), so breit wie angegeben. Gibt
 * die Höhe zurück, damit darunter weitergesetzt werden kann.
 */
export function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, width: number): number {
	const scale = width / LOGO.width;
	doc.save();
	doc.translate(x, y).scale(scale);
	for (const p of LOGO.paths) {
		doc
			.path(p.d)
			.lineWidth(p.strokeWidth)
			.lineJoin('round')
			.fillAndStroke(p.fill, p.stroke, p.evenOdd ? 'even-odd' : 'non-zero');
	}
	doc.restore();
	return LOGO.height * scale;
}

export function bufferResponse(filename: string, buffer: Buffer): Response {
	const body = new Uint8Array(buffer);
	return new Response(body, {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `attachment; filename="${filename}"`,
			'content-length': String(body.length),
			'cache-control': 'no-store'
		}
	});
}

export function pdfBuffer(opts: PdfOptions): Promise<Buffer> {
	const doc = new PDFDocument({
		size: 'A4',
		layout: opts.landscape ? 'landscape' : 'portrait',
		margins: { top: 40, bottom: 48, left: 36, right: 36 },
		bufferPages: true,
		info: { Title: opts.title, Author: APP_NAME, Creator: APP_NAME },
		font: baseFont()
	});
	useFonts(doc);

	const chunks: Buffer[] = [];
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('data', (c: Buffer) => chunks.push(c));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});

	const left = doc.page.margins.left;
	const right = () => doc.page.width - doc.page.margins.right;
	const width = () => right() - left;
	const bottom = () => doc.page.height - doc.page.margins.bottom;

	/* ------------------------------------------------------------- Kopf */
	doc.font(FONT).fontSize(8).fillColor(COLORS.muted).text(APP_NAME.toUpperCase(), left, doc.page.margins.top, { characterSpacing: 0.8 });
	doc.font(BOLD).fontSize(17).fillColor(COLORS.ink).text(opts.title, { paragraphGap: 2 });
	if (opts.facts?.length) {
		doc.font(FONT).fontSize(9).fillColor(COLORS.muted).text(opts.facts.filter(Boolean).join(' · '), { width: width() });
	}
	if (opts.notice) {
		doc.moveDown(0.4);
		doc.font(BOLD).fontSize(9).fillColor(COLORS.ink).text(opts.notice, { width: width() });
	}
	doc.moveDown(0.8);

	/* ---------------------------------------------------------- Tabellen */
	for (const table of opts.tables ?? []) {
		const total = table.columns.reduce((s, c) => s + c.width, 0) || 1;
		const widths = table.columns.map((c) => (c.width / total) * width());
		const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((s, w) => s + w, 0));
		const pad = 4;

		if (table.heading) {
			if (doc.y + 40 > bottom()) doc.addPage();
			doc.font(BOLD).fontSize(11).fillColor(COLORS.ink).text(table.heading, left, doc.y);
			doc.moveDown(0.3);
		}

		const rowHeight = (cells: PdfCell[], font: string, size: number) => {
			doc.font(font).fontSize(size);
			const h = Math.max(
				...cells.map((c, i) => doc.heightOfString(text(c) || ' ', { width: widths[i] - 2 * pad, align: table.columns[i]?.align ?? 'left' }))
			);
			return h + 2 * pad;
		};

		const drawRow = (cells: PdfCell[], o: { font?: string; size?: number; fill?: string; line?: boolean } = {}) => {
			const font = o.font ?? FONT;
			const size = o.size ?? 8.5;
			const h = rowHeight(cells, font, size);
			if (doc.y + h > bottom()) {
				doc.addPage();
				drawHead();
			}
			const y = doc.y;
			if (o.fill) doc.rect(left, y, width(), h).fill(o.fill);
			doc.font(font).fontSize(size).fillColor(COLORS.ink);
			cells.forEach((c, i) => {
				doc.text(text(c), xs[i] + pad, y + pad, {
					width: widths[i] - 2 * pad,
					align: table.columns[i]?.align ?? 'left',
					lineBreak: true
				});
			});
			doc.y = y + h;
			if (o.line !== false) {
				doc
					.moveTo(left, doc.y)
					.lineTo(right(), doc.y)
					.lineWidth(0.5)
					.strokeColor(COLORS.line)
					.stroke();
			}
		};

		const drawHead = () => {
			drawRow(
				table.columns.map((c) => c.label),
				{ font: BOLD, size: 8.5, fill: COLORS.band }
			);
		};

		drawHead();
		if (!table.rows.length) {
			doc.font(FONT).fontSize(9).fillColor(COLORS.muted).text(table.empty ?? 'Keine Einträge', left + pad, doc.y + pad);
			doc.y += 18;
		}
		for (const row of table.rows) drawRow(row);
		if (table.footer) drawRow(table.footer, { font: BOLD, fill: COLORS.band });
		doc.moveDown(1);
		doc.fillColor(COLORS.ink);
	}

	/* ------------------------------------------- Angaben, Notiz, Unterschrift */
	if (opts.pairs?.length) {
		if (doc.y + 40 > bottom()) doc.addPage();
		const columns = Math.min(3, opts.pairs.length);
		const colWidth = width() / columns;
		const startY = doc.y;
		let maxY = startY;
		opts.pairs.forEach((p, i) => {
			const x = left + (i % columns) * colWidth;
			const y = startY + Math.floor(i / columns) * 34;
			doc.font(FONT).fontSize(8).fillColor(COLORS.muted).text(p.label, x, y, { width: colWidth - 10 });
			doc.font(BOLD).fontSize(10).fillColor(COLORS.ink).text(p.value || '–', x, y + 11, { width: colWidth - 10 });
			maxY = Math.max(maxY, y + 30);
		});
		doc.y = maxY;
		doc.moveDown(0.6);
	}

	if (opts.note) {
		if (doc.y + 40 > bottom()) doc.addPage();
		doc.font(FONT).fontSize(8).fillColor(COLORS.muted).text('Notiz', left, doc.y);
		doc.font(FONT).fontSize(9.5).fillColor(COLORS.ink).text(opts.note, { width: width() });
		doc.moveDown(0.6);
	}

	if (opts.footnote) {
		if (doc.y + 30 > bottom()) doc.addPage();
		doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.ink).text(opts.footnote, left, doc.y, { width: width() });
		doc.moveDown(0.5);
	}

	if (opts.signatures?.length) {
		if (doc.y + 70 > bottom()) doc.addPage();
		const y = Math.max(doc.y + 36, bottom() - 60);
		const colWidth = width() / opts.signatures.length;
		opts.signatures.forEach((label, i) => {
			const x = left + i * colWidth;
			doc
				.moveTo(x, y)
				.lineTo(x + colWidth - 24, y)
				.lineWidth(0.7)
				.strokeColor(COLORS.ink)
				.stroke();
			doc.font(FONT).fontSize(8.5).fillColor(COLORS.muted).text(label, x, y + 4, { width: colWidth - 24 });
		});
	}

	/* ------------------------------------------------------------ Fußzeile */
	const printed = dt.format(new Date());
	const range = doc.bufferedPageRange();
	for (let i = 0; i < range.count; i++) {
		doc.switchToPage(range.start + i);
		// Die Fußzeile steht unterhalb des Satzspiegels; ohne diesen Kniff
		// legt pdfkit dafür jedes Mal eine neue Seite an.
		const keep = doc.page.margins.bottom;
		doc.page.margins.bottom = 0;
		const y = doc.page.height - keep + 16;
		doc.font(FONT).fontSize(8).fillColor(COLORS.muted);
		doc.text(`${APP_NAME} · ${opts.title}`, left, y, { width: width() / 2, lineBreak: false });
		doc.text(`Ausdruck vom ${printed} · Seite ${i + 1} von ${range.count}`, left + width() / 2, y, {
			width: width() / 2,
			align: 'right',
			lineBreak: false
		});
		doc.page.margins.bottom = keep;
	}

	doc.end();
	return done;
}

export async function pdfResponse(filename: string, opts: PdfOptions): Promise<Response> {
	const buffer = await pdfBuffer(opts);
	const body = new Uint8Array(buffer);
	return new Response(body, {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `attachment; filename="${filename}"`,
			'content-length': String(body.length),
			'cache-control': 'no-store'
		}
	});
}
