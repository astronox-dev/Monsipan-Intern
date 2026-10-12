/**
 * Summenblatt eines Auftrags: alle verknüpften Tagesberichte samt Mengen und
 * Material laden und zusammenzählen (siehe `summarize`) – auf Wunsch nur die
 * Berichte einer Rechnung.
 */
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { dailyReportMaterials, dailyReportPositions, dailyReportRows, dailyReports, invoices, offerPositions, orders, parties } from '$lib/server/db/schema';
import { today } from '$lib/modules/stunden/week';
import { invoiceNo, lineNumbers } from '../offer';
import { summarize, type OrderSummary, type SummaryReportInput } from '../summary';
import type { SummarySheet } from './pdf';

export async function orderSummary(orderId: number | null, { invoiceId }: { invoiceId?: number } = {}): Promise<OrderSummary> {
	const where: SQL[] = [];
	if (orderId != null) where.push(eq(dailyReports.orderId, orderId));
	if (invoiceId != null) where.push(eq(dailyReports.invoiceId, invoiceId));
	if (!where.length) return summarize([]);
	const reports = await db
		.select({
			id: dailyReports.id,
			number: dailyReports.number,
			date: dailyReports.date,
			dateTo: dailyReports.dateTo,
			site: dailyReports.site,
			status: dailyReports.status,
			partyName: parties.name,
			invoiceId: dailyReports.invoiceId,
			invoiceNumber: invoices.number,
			invoiceCostCenter: invoices.costCenter
		})
		.from(dailyReports)
		.leftJoin(parties, eq(parties.id, dailyReports.partyId))
		.leftJoin(invoices, eq(invoices.id, dailyReports.invoiceId))
		.where(and(...where))
		.all()
		// Die Rechnungsnummer, wie sie auf der Rechnung steht – mit Kostenstelle
		.then((rows) => rows.map(({ invoiceCostCenter, ...r }) => ({ ...r, invoiceNumber: r.invoiceNumber == null ? null : invoiceNo({ number: r.invoiceNumber, costCenter: invoiceCostCenter }) })));
	if (!reports.length) return summarize([]);
	const ids = reports.map((r) => r.id);
	const [positions, rows, materials] = await Promise.all([
		db
			.select({ reportId: dailyReportPositions.reportId, lbPos: dailyReportPositions.lbPos, unit: dailyReportPositions.unit })
			.from(dailyReportPositions)
			.where(inArray(dailyReportPositions.reportId, ids))
			.orderBy(asc(dailyReportPositions.reportId), asc(dailyReportPositions.idx))
			.all(),
		db
			.select({ reportId: dailyReportRows.reportId, label: dailyReportRows.label, quantities: dailyReportRows.quantities })
			.from(dailyReportRows)
			.where(inArray(dailyReportRows.reportId, ids))
			.orderBy(asc(dailyReportRows.reportId), asc(dailyReportRows.sortOrder), asc(dailyReportRows.id))
			.all(),
		db
			.select({
				reportId: dailyReportMaterials.reportId,
				material: dailyReportMaterials.material,
				code: dailyReportMaterials.code,
				filmThickness: dailyReportMaterials.filmThickness
			})
			.from(dailyReportMaterials)
			.where(inArray(dailyReportMaterials.reportId, ids))
			.orderBy(asc(dailyReportMaterials.reportId), asc(dailyReportMaterials.sortOrder))
			.all()
	]);
	const input: SummaryReportInput[] = reports.map((r) => ({
		...r,
		positions: positions.filter((p) => p.reportId === r.id),
		rows: rows.filter((x) => x.reportId === r.id),
		materials: materials.filter((m) => m.reportId === r.id)
	}));
	return summarize(input);
}

/**
 * LV-Position je Mengenspalte fürs Summenblatt: die Nummer der Angebotsposition,
 * der die Spalte beim Abrechnen zugeordnet wurde (die Zuordnung merkt sich der Auftrag).
 */
export async function lvNumbers(orderId: number | null): Promise<Record<string, string>> {
	if (orderId == null) return {};
	const order = await db.select({ offerId: orders.offerId, mapping: orders.invoiceMapping }).from(orders).where(eq(orders.id, orderId)).get();
	if (!order?.offerId || !order.mapping) return {};
	const lines = await db
		.select({ id: offerPositions.id, kind: offerPositions.kind })
		.from(offerPositions)
		.where(eq(offerPositions.offerId, order.offerId))
		.orderBy(asc(offerPositions.sortOrder), asc(offerPositions.id))
		.all();
	const numbers = lineNumbers(lines);
	const byId = new Map(lines.map((l, i) => [l.id, numbers[i]]));
	const out: Record<string, string> = {};
	for (const [key, id] of Object.entries(order.mapping)) {
		const nr = typeof id === 'number' ? byId.get(id) : undefined;
		if (nr) out[key] = nr;
	}
	return out;
}

/**
 * Alles fürs Summenblatt nach dem Vordruck: zum ganzen Auftrag oder nur mit
 * den Berichten einer Rechnung. Beim Auftrag stehen bei „zu Rechnung Nr."
 * die Rechnungen, wenn alle zählenden Berichte abgerechnet sind; Bundesland und
 * Abschnitt nur, wenn es genau eine ist.
 */
export async function summarySheet(
	orderId: number | null,
	invoice?: { id: number; number: string; costCenter?: string; date: string; state: string; section: string }
): Promise<SummarySheet> {
	const [summary, lv, order] = await Promise.all([
		orderSummary(orderId, { invoiceId: invoice?.id }),
		lvNumbers(orderId),
		orderId != null ? db.select({ number: orders.number }).from(orders).where(eq(orders.id, orderId)).get() : undefined
	]);
	const counted = summary.reports.filter((r) => r.counted);
	let head = invoice;
	let numbers = invoice ? [invoiceNo(invoice)] : [];
	if (!head && counted.length && counted.every((r) => r.invoiceId != null)) {
		numbers = [...new Set(counted.map((r) => r.invoiceNumber ?? ''))].filter(Boolean);
		const ids = [...new Set(counted.map((r) => r.invoiceId))];
		if (ids.length === 1 && ids[0] != null) {
			head = await db
				.select({ id: invoices.id, number: invoices.number, date: invoices.date, state: invoices.state, section: invoices.section })
				.from(invoices)
				.where(eq(invoices.id, ids[0]))
				.get();
		}
	}
	return {
		name: invoice ? invoice.number : `Auftrag ${order?.number ?? ''}`.trim(),
		year: Number((invoice?.date ?? summary.to ?? today()).slice(0, 4)),
		invoiceNumber: numbers.join(', '),
		state: head?.state ?? '',
		section: head?.section ?? '',
		reports: counted,
		columns: summary.columns,
		lv,
		notCounted: summary.reports.length - counted.length
	};
}

/** Wie viele Tagesberichte am Auftrag hängen – ab zwei gibt es das Summenblatt als eigene Seite */
export async function reportCount(orderId: number): Promise<number> {
	const rows = await db.select({ id: dailyReports.id }).from(dailyReports).where(eq(dailyReports.orderId, orderId)).all();
	return rows.length;
}
