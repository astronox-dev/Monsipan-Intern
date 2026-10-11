/**
 * Wochenplanung als PDF – A4 quer wie der Zettel: oben KW und Zeitraum, je
 * Partie eine Spalte (mit den Leuten), je Tag eine Zeile, in den Feldern
 * Aufträge, Text, Urlaub und Krankenstand. Darunter – nur wer alle Partien
 * sieht – die offenen Notizen. Die Zeilen wachsen mit dem Inhalt; was nicht
 * mehr auf die Seite passt, geht mit wiederholtem Kopf weiter.
 */
import { bufferResponse, drawLogo, startPdf } from '$lib/server/pdf';
import { spacedNumber } from '$lib/modules/auftraege/offer';
import { isoWeek } from '$lib/modules/stunden/week';
import { holidayName } from '../days';
import type { PlanWeek } from './plan';

const INK = '#1d2127';
const MUTED = '#5c626b';
const LINE = '#b9bdc3';
const COLORS = { urlaub: '#0d7a4d', krank: '#9c4f00', abwesend: '#5c626b' } as const;
const ABSENCE = { urlaub: 'Urlaub', krank: 'Krank', abwesend: 'Abwesend' } as const;
const DAY = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const L = 22;
const R = PAGE_W - 22;
const TOP = 22;
const BOTTOM = PAGE_H - 30;
const DAY_W = 54;
const PAD = 3;

type Item = { text: string; size: number; bold?: boolean; color?: string; gap?: number };

const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

export async function planPdf(week: PlanWeek, weekStart: string, heading: string): Promise<Response> {
	const kw = isoWeek(weekStart);
	const range = `${short(week.days[0])} – ${short(week.days[6])}${week.days[6].slice(0, 4)}`;
	const title = `Wochenplanung KW ${kw.week}`;
	const { doc, finish } = startPdf({ title: `${title} · ${range}`, landscape: true, margin: 12, bufferPages: true });

	const parties = week.parties;
	const colW = parties.length ? (R - L - DAY_W) / parties.length : R - L - DAY_W;
	const x = (i: number) => L + DAY_W + i * colW;

	/** Was in einem Feld steht – Einträge, dann Urlaub und Krankenstand */
	const cellItems = (partyId: number, day: string): Item[] => {
		const items: Item[] = [];
		for (const e of week.entries.filter((e) => e.partyId === partyId && e.date === day)) {
			const main = e.orderId ? e.orderLocation || e.orderTitle || `Auftrag ${spacedNumber(e.orderNumber ?? '')}` : e.text;
			items.push({ text: main, size: 7.5, bold: true, gap: items.length ? 3 : 0 });
			if (e.orderId) items.push({ text: [spacedNumber(e.orderNumber ?? ''), e.text].filter(Boolean).join(' · '), size: 6.5, color: MUTED });
		}
		for (const a of week.absences.filter((a) => a.partyId === partyId && a.from <= day && (a.to ?? '9999-12-31') >= day)) {
			items.push({ text: `${ABSENCE[a.kind]}: ${a.name}`, size: 6.5, color: COLORS[a.kind], gap: items.length ? 2 : 0 });
		}
		return items;
	};

	const measure = (items: Item[], width: number) =>
		items.reduce((h, it) => {
			doc.font(it.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(it.size);
			return h + (it.gap ?? 0) + doc.heightOfString(it.text || ' ', { width, lineGap: -0.5 });
		}, 0);

	const draw = (items: Item[], left: number, top: number, width: number) => {
		let y = top;
		for (const it of items) {
			y += it.gap ?? 0;
			doc
				.font(it.bold ? 'Helvetica-Bold' : 'Helvetica')
				.fontSize(it.size)
				.fillColor(it.color ?? INK);
			doc.text(it.text || ' ', left, y, { width, lineGap: -0.5 });
			y += doc.heightOfString(it.text || ' ', { width, lineGap: -0.5 });
		}
	};

	const line = (x1: number, y1: number, x2: number, y2: number, w = 0.5, color = LINE) =>
		doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(w).strokeColor(color).stroke();

	/* ------------------------------------------------ Kopf je Seite */
	const pageHead = (): number => {
		doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(title, L, TOP, { lineBreak: false });
		doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`${range} · ${heading}`, L, TOP + 19, { lineBreak: false });
		drawLogo(doc, R - 110, TOP, 110);
		return TOP + 40;
	};

	const tableHead = (y: number): number => {
		const heads = parties.map((p) => [
			{ text: p.name, size: 8, bold: true },
			...(p.members.length ? [{ text: p.members.map((m) => m.name).join(' · '), size: 6.5, color: MUTED, gap: 1 }] : [])
		]);
		const h = Math.max(18, ...heads.map((items) => measure(items, colW - 2 * PAD))) + 2 * PAD;
		doc.rect(L, y, R - L, h).fillColor('#eef0f2').fill();
		doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`KW ${kw.week}`, L + PAD, y + PAD + 1, { width: DAY_W - 2 * PAD, lineBreak: false });
		heads.forEach((items, i) => draw(items, x(i) + PAD, y + PAD, colW - 2 * PAD));
		line(L, y, R, y, 1, INK);
		line(L, y + h, R, y + h, 1, INK);
		return y + h;
	};

	const grid = (top: number, bottom: number) => {
		line(L, top, L, bottom, 1, INK);
		line(R, top, R, bottom, 1, INK);
		line(L + DAY_W, top, L + DAY_W, bottom, 0.8, INK);
		for (let i = 1; i < parties.length; i++) line(x(i), top, x(i), bottom);
	};

	/* ------------------------------------------------ Tabelle */
	let y = pageHead();
	let tableTop = y;
	y = tableHead(y);
	for (const [d, day] of week.days.entries()) {
		const holiday = holidayName(day);
		const cells = parties.map((p) => cellItems(p.id, day));
		const dayItems: Item[] = [
			{ text: DAY[d], size: 10, bold: true },
			{ text: short(day), size: 7.5, color: MUTED },
			...(holiday ? [{ text: holiday, size: 6.5, color: '#bf252c', gap: 1 }] : [])
		];
		const weekend = d >= 5;
		const h = Math.max(weekend ? 22 : 40, measure(dayItems, DAY_W - 2 * PAD), ...cells.map((c) => measure(c, colW - 2 * PAD))) + 2 * PAD;
		if (y + h > BOTTOM) {
			grid(tableTop, y);
			doc.addPage();
			y = pageHead();
			tableTop = y;
			y = tableHead(y);
		}
		if (weekend) doc.rect(L, y, R - L, h).fillColor('#f7f8f8').fill();
		draw(dayItems, L + PAD, y + PAD, DAY_W - 2 * PAD);
		cells.forEach((items, i) => draw(items, x(i) + PAD, y + PAD, colW - 2 * PAD));
		y += h;
		line(L, y, R, y, 0.5, d === 6 ? INK : LINE);
	}
	grid(tableTop, y);

	/* ------------------------------------------------ Notizen */
	const open = week.notes.filter((n) => !n.done);
	if (open.length) {
		y += 14;
		const width = R - L - 14;
		if (y + 30 > BOTTOM) {
			doc.addPage();
			y = pageHead();
		}
		doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Notizen', L, y, { lineBreak: false });
		y += 15;
		for (const n of open) {
			doc.font('Helvetica').fontSize(8.5);
			const h = doc.heightOfString(n.text, { width }) + 4;
			if (y + h > BOTTOM) {
				doc.addPage();
				y = pageHead();
			}
			doc.rect(L, y + 1.5, 7, 7).lineWidth(0.6).strokeColor(MUTED).stroke();
			doc.fillColor(INK).text(n.text, L + 14, y, { width });
			y += h;
			line(L, y - 1.5, R, y - 1.5, 0.3);
		}
	}

	/* ------------------------------------------------ Fuß */
	const pages = doc.bufferedPageRange();
	const stamp = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
	for (let i = pages.start; i < pages.start + pages.count; i++) {
		doc.switchToPage(i);
		doc.font('Helvetica').fontSize(7).fillColor(MUTED);
		doc.text(`Stand ${stamp}`, L, PAGE_H - 22, { lineBreak: false });
		if (pages.count > 1) doc.text(`Seite ${i - pages.start + 1} von ${pages.count}`, R - 120, PAGE_H - 22, { width: 120, align: 'right', lineBreak: false });
	}
	const buffer = await finish();
	return bufferResponse(`wochenplanung-kw${String(kw.week).padStart(2, '0')}-${kw.year}.pdf`, buffer);
}
