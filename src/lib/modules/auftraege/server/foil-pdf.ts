/**
 * Das 3M-Eigenüberwachungs-Protokoll für Markierungsfolien als PDF – im Aufbau
 * des 3M-Vordrucks (Stand 12/2008): Kopf mit Firmenfeld, 1.0 Straße, 2.0
 * Wetter, 3.0 Verlegung, 4.0 Bemerkungen und die beiden Unterschriftsfelder.
 * Maße sind vom Vordruck abgenommen; ins Firmenfeld kommt das Monsipan-Logo.
 */
import { bufferResponse, drawLogo, startPdf } from '$lib/server/pdf';
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '$lib/modules/stunden/signature';
import { spacedNumber } from '../offer';
import {
	FOIL_CONDITION,
	FOIL_FILM_COLUMNS,
	FOIL_LAYING,
	FOIL_PREP,
	FOIL_PRESSING,
	FOIL_PRIMED,
	FOIL_TIMES,
	type FoilProtocol,
	type WorkSignature
} from '../work-order';

const INK = '#1d2127';
const MUTED = '#5c626b';
const ASCENT = 0.905;

const L = 63.5;
const R = 501.4;
const NR = 65.5;
const LABEL = 81.6;
const VALUE = 198.5;

const dateLabel = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '');
const dayOf = (ms: number) => new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' }).format(ms);

export interface FoilPdfInput {
	number: string;
	foil: FoilProtocol;
}

/** Eigenes PDF nur mit dem Protokoll */
export async function foilPdf(input: FoilPdfInput): Promise<Response> {
	const { doc, finish } = startPdf({ title: `3M-Verlegeprotokoll ${spacedNumber(input.number)}`, margin: 8 });
	drawFoil(doc, input);
	return bufferResponse(`3m-verlegeprotokoll-${input.number}.pdf`, await finish());
}

/** Das Protokoll auf die aktuelle (leere) Seite – auch hinter dem Arbeitsauftrag */
export function drawFoil(doc: PDFKit.PDFDocument, { foil: f }: FoilPdfInput) {

	const line = (x1: number, x2: number, y: number, w = 0.5) => doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(INK).stroke();
	const text = (s: string, x: number, b: number, o: { size?: number; bold?: boolean; color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {}) => {
		if (!s) return;
		const size = o.size ?? 8;
		doc
			.font(o.bold ? 'Helvetica-Bold' : 'Helvetica')
			.fontSize(size)
			.fillColor(o.color ?? INK)
			.text(s, x, b - size * ASCENT, { width: o.width, align: o.align ?? 'left', lineBreak: false, ellipsis: !!o.width });
	};
	/** Eingetragener Wert über einer Linie – wird kleiner, bis er passt */
	const value = (s: string, x: number, b: number, w: number) => {
		if (!s) return;
		let size = 9;
		doc.font('Helvetica');
		while (size > 6 && doc.fontSize(size).widthOfString(s) > w) size -= 0.5;
		text(s, x + 1.5, b - 1.5, { size, width: w });
	};
	const field = (s: string, x1: number, x2: number, b: number) => {
		line(x1, x2, b + 1.5);
		value(s, x1, b, x2 - x1 - 3);
	};
	/** Kästchen mit 10,7 pt Kante, senkrecht mittig zur Zeile */
	const box = (x: number, b: number, on: boolean) => {
		const s = 10.7;
		const y = b - 3 - s / 2 - 0.5;
		doc.rect(x, y, s, s).lineWidth(0.6).strokeColor(INK).stroke();
		if (on) {
			doc
				.moveTo(x + 2, y + s * 0.55)
				.lineTo(x + s * 0.42, y + s - 2)
				.lineTo(x + s - 1.6, y + 2)
				.lineWidth(1.4)
				.lineCap('round')
				.lineJoin('round')
				.strokeColor(INK)
				.stroke();
		}
	};
	const heading = (nr: string, label: string, b: number) => {
		text(nr, L, b, { size: 10, bold: true });
		text(label, LABEL, b, { size: 10, bold: true });
	};
	const row = (nr: string, label: string, b: number) => {
		text(nr, NR, b);
		text(label, LABEL, b);
	};
	/** Kästchenzeile: Angebote an festen Stellen, das letzte Kästchen mit freiem Text */
	const choices = (
		b: number,
		options: readonly { key: string; label: string }[],
		chosen: Record<string, boolean | string>,
		boxes: number[],
		other: { box: number; from: number }
	) => {
		options.forEach((o, i) => {
			box(boxes[i], b, chosen[o.key] === true);
			const lines = o.label === 'staubfrei reinigen' ? ['staubfrei', 'reinigen'] : [o.label];
			lines.forEach((l, j) => text(l, boxes[i] + 17.4, b + j * 7.4));
		});
		box(other.box, b, chosen.other === true);
		field(String(chosen.otherText ?? ''), other.from, R, b);
	};

	// ------------------------------------------------------------ Kopf
	text('3M Eigenüberwachungs-Protokoll', L, 46, { size: 13, bold: true });
	text('für Markierungsfolien', L, 62, { size: 13, bold: true });
	doc.rect(288, 33, R - 288, 94).lineWidth(0.6).strokeColor(INK).stroke();
	text('Firma', 295.5, 43.5, { size: 7 });
	drawLogo(doc, 302, 66, 150);
	line(L, R, 127, 0.6);

	// ------------------------------------------------------------ 1.0 Straße
	heading('1.0', 'Angaben zur Straße', 146);
	const roadRows: [string, string, string, number][] = [
		['1.1', 'Ort und Straßenbezeichnung', f.place, 161.4],
		['1.2', 'Von – bis, bzw. km', f.section, 177.5],
		['1.3', 'Fahrbahndeckenart', f.surface, 193.5],
		['1.4', 'Spurbreite', f.laneWidth, 208.9]
	];
	for (const [nr, label, v, b] of roadRows) {
		row(nr, label, b);
		field(v, VALUE, R, b);
	}
	row('1.5', 'Zustand', 225);
	choices(225, FOIL_CONDITION, f.condition, [199.2, 249.4, 301.5], { box: 357, from: 377.7 });
	row('1.6', 'Notwendige Vorarbeiten', 241);
	choices(241, FOIL_PREP, f.prep, [199.2, 249.4, 301.5], { box: 357, from: 377.7 });

	// ------------------------------------------------------------ 2.0 Wetter
	heading('2.0', 'Angaben zum Wetter', 270.3);
	const cols = [
		[198.5, 267.4],
		[276, 345.6],
		[354.3, 423.8],
		[432.5, 501.4]
	];
	FOIL_TIMES.forEach((t, i) => text(t, cols[i][0], 270.3));
	const weather: [string, string[], number][] = [
		['Luft-Temperatur in °C', f.weather.air, 285.8],
		['Boden-Temperatur in °C', f.weather.ground, 301.8],
		['Relative Luftfeuchtigkeit in %', f.weather.humidity, 317.2]
	];
	weather.forEach(([label, values, b], i) => {
		row(i === 0 ? '2.1' : '', label, b);
		cols.forEach(([x1, x2], j) => field(values[j] ?? '', x1, x2, b));
	});
	row('2.2', 'Letzter Regen vor', 333.2);
	field(f.rainDays, cols[0][0], cols[0][1], 333.2);
	text('Tagen', 276, 333.2);
	field(f.rainHours, cols[2][0], cols[2][1], 333.2);
	text('Stunden', 432.5, 333.2);

	// ------------------------------------------------------------ 3.0 Verlegung
	heading('3.0', 'Angaben zur Verlegung', 365.2);
	const filmCols = [
		[LABEL, 162.4],
		[175.1, 222.6],
		[234.6, 282.1],
		[294.8, 359],
		[371, 418.5],
		[431.2, R]
	];
	const heads: [string, string][] = [
		['Folientyp', ''],
		['Breite', 'in cm'],
		['Gesamtlänge', 'in m'],
		['Grundierung', ''],
		['Trockenzeit', 'in min.'],
		['Linienart', '']
	];
	text('3.1', NR, 381.3);
	heads.forEach(([a, b], i) => {
		const x = i === 0 ? LABEL : [173.1, 233.3, 294.1, 371, 431.2][i - 1];
		text(a, x, 381.3);
		text(b, x, 392);
	});
	[409.8, 425.2].forEach((y, r) => {
		FOIL_FILM_COLUMNS.forEach(({ key }, i) => {
			const [x1, x2] = filmCols[i];
			line(x1, x2, y);
			value(f.films[r]?.[key] ?? '', x1, y - 1.5, x2 - x1 - 3);
		});
	});

	// Die Linie beginnt hinter der Beschriftung – unsere Schrift läuft etwas breiter als die des Vordrucks
	const after = (label: string, x: number, from: number) => Math.max(from, x + doc.font('Helvetica').fontSize(8).widthOfString(label) + 4);
	row('3.2*', 'Lot-Nr. Folie (Aufkleber)', 484.5);
	field(f.lotFilm, after('Lot-Nr. Folie (Aufkleber)', LABEL, 157.8), 227.3, 484.5);
	text('Lot-Nr. Primer', 233.3, 484.5);
	field(f.lotPrimer, after('Lot-Nr. Primer', 233.3, 281.4), 378.4, 484.5);
	text('Lot-Nr. DS01E', 387.7, 484.5);
	field(f.lotDs01e, after('Lot-Nr. DS01E', 387.7, 435.9), R, 484.5);

	const layingRows: [string, string, readonly { key: string; label: string }[], Record<string, boolean | string>, number][] = [
		['3.3', 'Grundiert', FOIL_PRIMED, f.primed, 500.5],
		['3.4', 'Verlegung', FOIL_LAYING, f.laying, 515.9],
		['3.5', 'Andruck', FOIL_PRESSING, f.pressing, 531.9]
	];
	for (const [nr, label, options, chosen, b] of layingRows) {
		row(nr, label, b);
		choices(b, options, chosen, [215.3, 310.9], { box: 387.7, from: 405.8 });
	}
	row('3.6', 'Streckenfreigabe', 548);
	box(215.3, 548, f.release === 'gleich');
	text('gleicher Tag', 234, 548);
	box(310.9, 548, f.release === 'nach');
	text('nach', 327.6, 548);
	field(f.release === 'nach' ? f.releaseDays : '', 345.6, 401.1, 548);
	text('Tagen', 405.8, 548);
	row('3.7', 'Verlegedatum', 563.4);
	field(dateLabel(f.layingDate), 157.8, 321.6, 563.4);
	row('3.8', 'Voraussichtl. Datum der Demarkierung', 580.1);
	field(dateLabel(f.removalDate), after('Voraussichtl. Datum der Demarkierung', LABEL, 226), 321.6, 580.1);

	// ------------------------------------------------------------ 4.0 Bemerkungen
	heading('4.0', 'Bemerkungen', 611.4);
	line(157.8, R, 611.2);
	line(157.8, R, 626.5);
	if (f.remarks) {
		doc
			.font('Helvetica')
			.fontSize(8.5)
			.fillColor(INK)
			.text(f.remarks.replace(/\s+/g, ' '), 159.5, 601.5, { width: R - 161, height: 26, lineGap: 4.7, ellipsis: true });
	}
	text('* Lot-Nummern bei Bedarf auf separates Blatt kleben.', L, 653.4, { size: 7 });

	// ------------------------------------------------------------ Unterschriften
	const sigBox = (x1: number, x2: number, label: string, role: string, sig: WorkSignature | undefined) => {
		doc.rect(x1, 658.6, x2 - x1, 74.9).lineWidth(0.6).strokeColor(INK).stroke();
		text(label, x1 + 12.7, 669.5);
		line(x1 + 12.7, x2 - 14, 716.8);
		text(role, x1 + 12.7, 727.6);
		if (!sig) return;
		const w = x2 - x1 - 30;
		const h = 36;
		const scale = Math.min(w / SIGNATURE_WIDTH, h / SIGNATURE_HEIGHT);
		doc.save();
		doc.translate(x1 + 12.7 + (w - SIGNATURE_WIDTH * scale) / 2, 714 - SIGNATURE_HEIGHT * scale);
		doc.scale(scale);
		doc.path(sig.path).lineWidth(4).lineCap('round').lineJoin('round').strokeColor(INK).stroke();
		doc.restore();
		text([sig.name, dayOf(sig.at)].filter(Boolean).join(', '), x1 + 70, 727.6, { size: 6.5, color: MUTED, width: x2 - x1 - 84, align: 'right' });
	};
	sigBox(L, 274.8, 'gesehen / anerkannt', 'Auftraggeber', f.signatures.auftraggeber);
	sigBox(289.5, R, 'ausgefertigt von', 'Auftragnehmer', f.signatures.auftragnehmer);
	text('Original (weiß): Auftraggeber', L, 743, { size: 7 });
	text('1. Kopie (rot): 3M Neuss', 247.3, 743, { size: 7 });
	text('2. Kopie (gelb): Auftragnehmer', R - 150, 743, { size: 7, width: 150, align: 'right' });
	text('© 3M 12/2008', L, 766.5, { size: 6 });
}
