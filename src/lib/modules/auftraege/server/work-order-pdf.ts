/**
 * Der Arbeitsauftrag als PDF – gezeichnet wie der Vordruck FO 0814: Seite 1
 * mit Kopf, Beilagen, Evaluierung, Leistungen, Unterschriften und der
 * Vorarbeiter-Checkliste, Seite 2 mit den Besonderheiten der Baustelle und der
 * Unterweisung. Maße sind vom Vordruck abgenommen; wo eine Unterschrift
 * hineinkommt, sind die Zeilen etwas höher als auf Papier.
 */
import { bufferResponse, drawLogo, startPdf } from '$lib/server/pdf';
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '$lib/modules/stunden/signature';
import { quantityLabel, spacedNumber } from '../offer';
import { ATTACHMENTS, CHECKLIST, ISSUES, type WorkCheck, type WorkOrderContent, type WorkSignature } from '../work-order';

const INK = '#1d2127';
const MUTED = '#5c626b';
const GRID = '#1d2127';
const SOFT = '#a6a6a6';
const BAND = '#f2f2f2';
const GREEN = '#00a651';
const RED = '#e3000f';
/** Oberlänge der Schrift: so weit liegt die Grundlinie unter dem y, das pdfkit bekommt */
const ASCENT = 0.905;

const L = 64;
const R = 553;

const dateLabel = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '');
const dayOf = (ms: number) => new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' }).format(ms);

export interface WorkOrderPdfInput {
	number: string;
	content: WorkOrderContent;
}

export async function workOrderPdf({ number, content: c }: WorkOrderPdfInput): Promise<Response> {
	// Kleiner Rand: pdfkit bricht sonst Text nahe am unteren Rand auf eine neue Seite um
	const { doc, finish } = startPdf({ title: `Arbeitsauftrag ${spacedNumber(number)}`, margin: 8 });

	const line = (x1: number, y1: number, x2: number, y2: number, w = 0.6, color = GRID) =>
		doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(w).strokeColor(color).stroke();
	const dotted = (x1: number, x2: number, y: number) => {
		doc.save();
		doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.5).dash(0.6, { space: 1.4 }).strokeColor(INK).stroke();
		doc.restore();
	};
	const box = (x: number, y: number, w: number, h: number, color = GRID, width = 0.9) => doc.rect(x, y, w, h).lineWidth(width).strokeColor(color).stroke();
	const band = (x: number, y: number, w: number, h: number) => doc.rect(x, y, w, h).fillColor(BAND).fill();

	/** Text mit der Grundlinie bei b */
	const text = (s: string, x: number, b: number, o: { size?: number; bold?: boolean; color?: string; width?: number; align?: 'left' | 'center' | 'right'; italic?: boolean } = {}) => {
		if (!s) return;
		const size = o.size ?? 9.5;
		const font = o.bold ? (o.italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : o.italic ? 'Helvetica-Oblique' : 'Helvetica';
		doc
			.font(font)
			.fontSize(size)
			.fillColor(o.color ?? INK)
			.text(s, x, b - size * ASCENT, { width: o.width, align: o.align ?? 'left', lineBreak: false, ellipsis: !!o.width });
	};

	/** Wert in ein Feld: wird kleiner, bis er passt (höchstens auf minSize), danach abgeschnitten */
	const fit = (s: string, x: number, b: number, w: number, o: { size?: number; minSize?: number; align?: 'left' | 'center' | 'right' } = {}) => {
		if (!s) return;
		let size = o.size ?? 9.5;
		const min = o.minSize ?? 6.5;
		doc.font('Helvetica');
		while (size > min && doc.fontSize(size).widthOfString(s) > w) size -= 0.5;
		text(s, x, b, { size, width: w, align: o.align });
	};

	/** Kästchen wie ☐ – angehakt mit Häkchen */
	const check = (x: number, b: number, on: boolean, color = INK) => {
		const s = 7.2;
		const y = b - s;
		doc.rect(x, y, s, s).lineWidth(0.6).strokeColor(color).stroke();
		if (on) {
			doc
				.moveTo(x + 1.3, y + s * 0.55)
				.lineTo(x + s * 0.42, y + s - 1.4)
				.lineTo(x + s + 1.6, y - 1.8)
				.lineWidth(1.3)
				.lineCap('round')
				.lineJoin('round')
				.strokeColor(INK)
				.stroke();
		}
	};

	/** Unterschrift in ein Feld: rechts der Pfad, unten links Name und Datum */
	const signature = (sig: WorkSignature | undefined, x: number, y: number, w: number, h: number) => {
		if (!sig) return;
		const maxH = h - 3;
		const scale = Math.min((w * 0.62) / SIGNATURE_WIDTH, maxH / SIGNATURE_HEIGHT);
		doc.save();
		doc.translate(x + w - SIGNATURE_WIDTH * scale - 2, y + (h - SIGNATURE_HEIGHT * scale) / 2);
		doc.scale(scale);
		doc.path(sig.path).lineWidth(4).lineCap('round').lineJoin('round').strokeColor(INK).stroke();
		doc.restore();
		text([sig.name, dayOf(sig.at)].filter(Boolean).join(', '), x + 3, y + h - 2.5, { size: 6, color: MUTED, width: w * 0.5 });
	};

	/** Kopf jeder Seite: Logo links, „Arbeitsauftrag" rechts; Fuß mit Formularnummer */
	const frame = (page: number) => {
		line(L, 32, R, 32, 0.5, SOFT);
		line(L, 88, R, 88, 0.5, SOFT);
		line(300, 32, 300, 88, 0.5, SOFT);
		drawLogo(doc, L + 2, 42, 186);
		text('Arbeitsauftrag', R - 244, 65.6, { size: 20, bold: true, italic: true, width: 240, align: 'right' });
		line(L, 806, R, 806, 0.4, SOFT);
		text('FO 0814 / Rev.: 00', L, 813.6, { size: 6 });
		text(`Seite ${page} von 2`, R - 80, 813.6, { size: 6, width: 80, align: 'right' });
	};

	// ------------------------------------------------------------------ Seite 1
	frame(1);
	const c1 = 177; // zweite Spalte (Werte, Kästchen)
	const c2 = 337; // rechte Beschriftungen
	const c3 = 411; // rechte Werte
	const top = 92;

	/** Zeile im Kopf: Beschriftung links, Wert auf Punktlinie */
	const field = (label: string, value: string, b: number, x: number, valueX: number, valueEnd: number) => {
		text(label, x + 3.5, b);
		dotted(valueX, valueEnd, b + 9);
		fit(value, valueX + 2, b + 6, valueEnd - valueX - 4);
	};
	const rows = [111.4, 138.5, 165.6, 192.9, 220.0];
	field('Auftrag:', c.title, rows[0], L, c1, c2 - 6);
	field('Nr.:', spacedNumber(number), rows[0], c2, c3, R - 4);
	field('Baustelle:', c.site, rows[1], L, c1, R - 4);
	field('Ausführungsdatum:', dateLabel(c.startDate), rows[2], L, c1, c2 - 6);
	field('Endtermin:', dateLabel(c.endDate), rows[2], c2, c3, R - 4);
	for (const [i, b] of [rows[3], rows[4]].entries()) {
		field('Kontaktperson:', c.contacts[i]?.name ?? '', b, L, c1, c2 - 6);
		field('Telefon-Nr.:', c.contacts[i]?.phone ?? '', b, c2, c3, R - 4);
	}
	line(L, 230, R, 230);

	// Beilagen / Baustelleninformationen
	text('Beilagen/Baustellen-', L + 3.5, 242.6);
	text('informationen:', L + 3.5, 254.7);
	const att = c.attachments;
	const attRows = [242.7, 256.6, 270.5];
	ATTACHMENTS.slice(0, 3).forEach(({ key, label }, i) => {
		check(c1 + 3.5, attRows[i], att[key]);
		text(label, 205.4, attRows[i]);
	});
	ATTACHMENTS.slice(3).forEach(({ key, label }, i) => {
		check(c2 + 6.8, attRows[i], att[key]);
		text(label, 361.5, attRows[i]);
	});
	check(c2 + 6.8, attRows[2], att.other);
	fit(att.otherText, 361.5, attRows[2], R - 365);
	line(L, 277, R, 277);

	// Evaluierung
	text('Evaluierung:', L + 3.5, 293.4);
	check(c1 + 3.5, 293.7, c.evaluation === 'standard');
	text('Standardevaluierung', 205.4, 293.7);
	check(c2 + 6.8, 287.6, c.evaluation === 'baustelle', RED);
	text('Baustellenspezifische Evaluierung', 361.5, 287.6, { color: RED });
	text('(siehe Rückseite)', 361.5, 299.9, { color: RED });
	line(L, 305, R, 305);

	// Leistungen
	const cols = [L, c1, 231, 286, c2, 408, R];
	const headTop = 305;
	const headBottom = 336;
	band(L, headTop, R - L, headBottom - headTop);
	const heads: [string, string][] = [
		['Beschreibung der', 'Leistung'],
		['Art der', 'Markierung'],
		['RAL', 'Farbton'],
		['MSK', ''],
		['Ca. Menge', 'lfm/m²'],
		['Ausgeführte Menge', '']
	];
	heads.forEach(([a, b], i) => {
		text(a, cols[i] + 3.5, 316.7);
		text(b, cols[i] + 3.5, 329.3);
	});
	const tableTop = headBottom;
	const tableBottom = 510;
	const lineCount = Math.max(13, c.lines.length);
	const rowH = (tableBottom - tableTop) / lineCount;
	const size = Math.min(9, rowH - 3.5);
	for (let i = 0; i < lineCount; i++) {
		const y = tableTop + (i + 1) * rowH;
		dotted(L + 2, R - 2, y);
		const l = c.lines[i];
		if (!l) continue;
		const b = y - rowH / 2 + size * 0.35;
		const qty = [quantityLabel(l.quantity), l.unit].filter(Boolean).join(' ');
		const done = [quantityLabel(l.done), l.done != null ? l.unit : ''].filter(Boolean).join(' ');
		[l.text, l.kind, l.ral, l.msk, qty, done].forEach((v, j) => fit(v, cols[j] + 3, b, cols[j + 1] - cols[j] - 6, { size, minSize: 5.5 }));
	}
	for (const x of cols.slice(1, -1)) line(x, headTop, x, tableBottom, 0.5);
	line(L, headBottom, R, headBottom, 0.5);
	line(L, tableBottom, R, tableBottom);

	// Folienverlegeprotokoll
	text('Folienverlegeprotokoll:', L + 3.5, 522);
	check(c1 + 3.5, 522, c.foilProtocol === 'ja');
	text('ja', 191.5, 522);
	check(233.5, 522, c.foilProtocol === 'nein');
	text('nein', 244.5, 522);
	line(L, 528, R, 528);

	// Datum und Unterschriften
	const g1 = 528;
	const g2 = 552;
	const g3 = 582;
	band(L, g1, c1 - L, g3 - g1);
	band(c2, g1, c3 - c2, g3 - g1);
	for (const y of [g1, g2, g3]) line(L, y, R, y, 0.5);
	for (const x of [c1, c2, c3]) line(x, g1, x, g3, 0.5);
	text('Datum:', L + 3.5, g1 + 15);
	fit(dateLabel(c.signDate) || (c.signatures.bl ? dayOf(c.signatures.bl.at) : ''), c1 + 4, g1 + 15, c2 - c1 - 8);
	text('Unterschrift BL:', c2 + 3.5, g1 + 15, { width: c3 - c2 - 5 });
	signature(c.signatures.bl, c3, g1, R - c3, g2 - g1);
	text('Unterschrift Vorarbeiter', L + 3.5, g2 + 12.5);
	text('(Aufsichtsperson):', L + 3.5, g2 + 24);
	signature(c.signatures.vorarbeiter, c1, g2, c2 - c1, g3 - g2);
	text('Vertretung', c2 + 3.5, g2 + 12.5);
	text('Vorarbeiter:', c2 + 3.5, g2 + 24);
	signature(c.signatures.vertretung, c3, g2, R - c3, g3 - g2);
	box(L, top, R - L, g3 - top, GRID, 1);

	// Vorarbeiter-Checkliste
	const gTop = 590;
	const gHead = 607;
	const gCheck = 625;
	const gIssues = 641;
	const gItems = 746;
	const gBottom = 778;
	text('Vorarbeiter- Checkliste:', L + 3.5, gHead - 4.5, { size: 11.5, color: GREEN });
	line(L, gHead, R, gHead, 0.6, GREEN);
	// Kästchen wie im Vordruck – rückt nach rechts, wo die Beschriftung breiter ist
	const checklist: [number, number][] = [
		[L + 3.5, 173.4],
		[230.2, 336.4],
		[393.1, 513]
	];
	CHECKLIST.forEach(({ key, label }, i) => {
		const [lx, bx] = checklist[i];
		const x = Math.max(bx, lx + doc.font('Helvetica').fontSize(9.5).widthOfString(`${label}:`) + 5);
		text(`${label}:`, lx, gCheck - 6);
		check(x, gCheck - 6, c.checklist[key]);
		text('ok', x + 11, gCheck - 6);
	});
	line(L, gCheck, R, gCheck, 0.6, GREEN);
	text('Nur bei Auffälligkeiten auszufüllen:', L + 3.5, gIssues - 5, { color: RED });
	line(L, gIssues, R, gIssues, 0.6, GREEN);
	const issueRows = Array.from({ length: 7 }, (_, i) => gIssues + 13 + i * 15);
	ISSUES.forEach(({ key, label }, i) => {
		check(L + 3.5, issueRows[i], c.issues[key]);
		text(label, 79.5, issueRows[i]);
	});
	check(L + 3.5, issueRows[5], c.issues.other);
	fit(c.issues.otherText, 79.5, issueRows[5], R - 84);
	check(L + 3.5, issueRows[6], c.issues.extraHours);
	text('Es gab Regiestunden, weil:', 79.5, issueRows[6]);
	const reasonX = 79.5 + doc.font('Helvetica').fontSize(9.5).widthOfString('Es gab Regiestunden, weil:') + 5;
	dotted(reasonX, R - 4, issueRows[6] + 2);
	fit(c.issues.extraHoursReason, reasonX + 2, issueRows[6], R - reasonX - 6);
	line(L, gItems, R, gItems, 0.6, GREEN);
	const f1 = 170;
	const f2 = 292;
	const f3 = 410;
	for (const x of [f1, f2, f3]) line(x, gItems, x, gBottom, 0.5, GREEN);
	text('Arbeit fertig am:', L + 3.5, gItems + 19);
	fit(dateLabel(c.finishedOn), f1 + 4, gItems + 19, f2 - f1 - 8);
	text('Unterschrift Auftraggeber:', f2 + 4, gItems + 19, { width: f3 - f2 - 6 });
	signature(c.signatures.auftraggeber, f3, gItems, R - f3, gBottom - gItems);
	box(L, gTop, R - L, gBottom - gTop, GREEN, 1);

	// ------------------------------------------------------------------ Seite 2
	doc.addPage({ size: 'A4', margin: 8 });
	frame(2);
	const pTop = 106;
	const pHead = 123;
	const labelW = 152;
	const step = 17.75;
	band(L, pTop, R - L, pHead - pTop);
	text('Besonderheiten der Baustelle – durch Bauleiter auszufüllen', L, 117.5, { width: R - L, align: 'center' });
	line(L, pHead, R, pHead, 0.6);

	const block = (labelLines: string[], items: WorkCheck[], y0: number) => {
		const height = items.length * step + 5;
		band(L, y0, labelW - L, height);
		line(labelW, y0, labelW, y0 + height, 0.6);
		labelLines.forEach((s, i) => text(s, L + 3.5, y0 + 13 + i * 12.2));
		items.forEach((it, i) => {
			const b = y0 + 13.5 + i * step;
			check(159.4, b, it.checked);
			const label = it.label ? `${it.label}:` : '';
			text(label, 171.7, b);
			const x = 171.7 + (label ? doc.font('Helvetica').fontSize(9.5).widthOfString(label) + 5 : 0);
			fit(it.detail, x, b, R - x - 4);
		});
		return y0 + height;
	};
	const afterPpe = block(['Persönliche', 'Schutzausrüstung:'], c.ppe, pHead);
	line(L, afterPpe, R, afterPpe, 0.6);
	const afterHazards = block(['Besondere', 'Gefahren:'], c.hazards, afterPpe);
	box(L, pTop, R - L, afterHazards - pTop, GRID, 1);

	// Unterweisung der Mitarbeiter
	const uTop = afterHazards + 24;
	const uHead = uTop + 24;
	const uCols = uHead + 18;
	const perSide = Math.max(3, Math.ceil(c.briefings.length / 2));
	const uRowH = 22;
	const uBottom = uCols + perSide * uRowH;
	band(L, uTop, R - L, uHead - uTop);
	text('Unterweisung der Mitarbeiter durch Vorarbeiter oder Bauleiter', L, uTop + 15, { width: R - L, align: 'center', color: GREEN });
	const ux = [L, 120, 213, 307, 361, 456, R];
	['Datum', 'Name', 'Unterschrift', 'Datum', 'Name', 'Unterschrift'].forEach((s, i) => text(s, ux[i] + 3.5, uCols - 5.5));
	for (const y of [uHead, uCols, ...Array.from({ length: perSide - 1 }, (_, i) => uCols + (i + 1) * uRowH)]) line(L, y, R, y, 0.5, GREEN);
	for (const x of ux.slice(1, -1)) line(x, uHead, x, uBottom, 0.5, GREEN);
	c.briefings.forEach((b, i) => {
		// Erst die linke Hälfte von oben nach unten, dann die rechte
		const side = i < perSide ? 0 : 3;
		const y = uCols + (i % perSide) * uRowH;
		fit(dateLabel(b.date), ux[side] + 3, y + 14, ux[side + 1] - ux[side] - 6, { size: 8.5 });
		fit(b.name, ux[side + 1] + 3, y + 14, ux[side + 2] - ux[side + 1] - 6, { size: 8.5 });
		if (b.signature) {
			const w = ux[side + 3] - ux[side + 2];
			const scale = Math.min((w - 6) / SIGNATURE_WIDTH, (uRowH - 3) / SIGNATURE_HEIGHT);
			doc.save();
			doc.translate(ux[side + 2] + (w - SIGNATURE_WIDTH * scale) / 2, y + (uRowH - SIGNATURE_HEIGHT * scale) / 2);
			doc.scale(scale);
			doc.path(b.signature).lineWidth(4).lineCap('round').lineJoin('round').strokeColor(INK).stroke();
			doc.restore();
		}
	});
	box(L, uTop, R - L, uBottom - uTop, GREEN, 1);

	const buffer = await finish();
	return bufferResponse(`arbeitsauftrag-${number}.pdf`, buffer);
}
