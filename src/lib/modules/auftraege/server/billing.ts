/**
 * Angebot „abgerechnet": Der Auftrag dazu ist abgeschlossen, hat mindestens
 * eine Rechnung, und alle zählenden Rechnungen (weder storniert noch
 * Stornorechnung) sind bezahlt. Gemerkt wird das am Angebot (billedAt), damit
 * auch übernommene Angebote aus dem bisherigen Programm „abgerechnet" sein
 * können, ohne dass ihre Rechnungen schon als bezahlt eingetragen sind.
 *
 * Nachgezogen wird bei allem, was das ändern kann: Zahlung, neue Rechnung,
 * Storno, Löschen und Stand des Auftrags. Eine Zahlung macht nur abgerechnet,
 * nie zurück – sonst fiele ein übernommenes Angebot zurück, sobald die erste
 * von mehreren alten Rechnungen bezahlt ist.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, type Tx } from '$lib/server/db';
import { invoices, offers, orders } from '$lib/server/db/schema';

export type BillingSync = 'beide' | 'nur_abrechnen' | 'nur_zuruecknehmen';

/** Ist der Auftrag fertig abgerechnet? */
export async function orderBilled(orderId: number, tx: Tx = db as unknown as Tx): Promise<boolean> {
	const order = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).get();
	if (order?.status !== 'abgeschlossen') return false;
	const row = await tx
		.select({
			n: sql<number>`count(*)`.mapWith(Number),
			open: sql<number>`coalesce(sum(case when ${invoices.status} = 'bezahlt' then 0 else 1 end), 0)`.mapWith(Number)
		})
		.from(invoices)
		.where(and(eq(invoices.orderId, orderId), sql`${invoices.stage} <> 'storniert' and ${invoices.kind} <> 'storno'`))
		.get();
	return (row?.n ?? 0) > 0 && row?.open === 0;
}

/** Das Angebot zum Auftrag auf „abgerechnet" setzen bzw. zurücknehmen */
export async function syncOfferBilling(orderId: number | null | undefined, mode: BillingSync = 'beide', tx: Tx = db as unknown as Tx) {
	if (orderId == null) return;
	const order = await tx.select({ offerId: orders.offerId }).from(orders).where(eq(orders.id, orderId)).get();
	if (!order?.offerId) return;
	const billed = await orderBilled(orderId, tx);
	if (billed && mode !== 'nur_zuruecknehmen') {
		await tx
			.update(offers)
			.set({ billedAt: new Date() })
			.where(and(eq(offers.id, order.offerId), eq(offers.status, 'angenommen'), isNull(offers.billedAt)));
	} else if (!billed && mode !== 'nur_abrechnen') {
		await tx
			.update(offers)
			.set({ billedAt: null })
			.where(and(eq(offers.id, order.offerId), isNotNull(offers.billedAt)));
	}
}

/** Der Auftrag zu einer Rechnung – für das Nachziehen nach Zahlung, Storno oder Löschen */
export async function orderOfInvoice(invoiceId: number, tx: Tx = db as unknown as Tx): Promise<number | null> {
	const row = await tx.select({ orderId: invoices.orderId }).from(invoices).where(eq(invoices.id, invoiceId)).get();
	return row?.orderId ?? null;
}
