import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { products } from '$lib/server/db/schema';
import { broadcast } from '$lib/server/events';
import { summaryQuery, totalSql } from './products';
import { notify } from '$lib/server/notifications';

/** Artikel mit Mindestbestand, deren Gesamtbestand ihn erreicht oder unterschritten hat */
export async function lowStockProducts() {
	return summaryQuery()
		.where(and(eq(products.active, true), isNotNull(products.minStock), gt(products.minStock, 0), sql`${totalSql} <= ${products.minStock}`))
		.orderBy(sql`${totalSql} * 1.0 / ${products.minStock}`, products.name)
		.all();
}

export async function lowStockCount(): Promise<number> {
	const row = await db
		.select({ n: sql<number>`count(*)` })
		.from(products)
		.where(and(eq(products.active, true), gt(products.minStock, 0), sql`${totalSql} <= ${products.minStock}`))
		.get();
	return Number(row?.n ?? 0);
}

/**
 * Nach einer Buchung: Bescheid geben, wenn ein Artikel den Mindestbestand neu
 * erreicht – unter der Glocke, als Push und als Info-Mail, je nachdem, was unter
 * Benachrichtigungen eingestellt ist. Jeder Artikel meldet sich nur einmal, bis
 * er wieder darüber liegt.
 */
async function checkLowStock(productIds: number[], origin: string) {
	if (!productIds.length) return;
	const rows = await db
		.select({
			id: products.id,
			name: products.name,
			articleNumber: products.articleNumber,
			minStock: products.minStock,
			notifiedAt: products.lowStockNotifiedAt,
			active: products.active,
			total: totalSql.mapWith(Number)
		})
		.from(products)
		.where(inArray(products.id, productIds))
		.all();

	const newlyLow: { name: string; total: number; minStock: number }[] = [];
	for (const r of rows) {
		const low = r.active && r.minStock != null && r.minStock > 0 && r.total <= r.minStock;
		if (low && !r.notifiedAt) {
			newlyLow.push({ name: r.name, total: r.total, minStock: r.minStock! });
			await db.update(products).set({ lowStockNotifiedAt: new Date() }).where(eq(products.id, r.id));
		} else if (!low && r.notifiedAt) {
			await db.update(products).set({ lowStockNotifiedAt: null }).where(eq(products.id, r.id));
		}
	}
	if (!newlyLow.length) return;

	notify({
		event: 'lager.mindestbestand',
		title: newlyLow.length === 1 ? `Mindestbestand: ${newlyLow[0].name}` : `${newlyLow.length} Artikel am Mindestbestand`,
		body: newlyLow.map((p) => `${p.name} (${p.total} / ${p.minStock})`).join(', '),
		url: '/lager/bestellliste',
		origin
	});
}

/** Nach jeder Bestandsänderung aufrufen: Live-Update an alle Browser + Mindestbestand melden */
export function afterStockChange(productIds: number[], origin: string) {
	broadcast('stock', { productIds });
	// Benachrichtigungen sollen die Antwort nicht aufhalten
	checkLowStock(productIds, origin).catch((err) => console.error('[alerts]', err));
}
