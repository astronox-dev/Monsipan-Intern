import { json } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { products, stock } from '$lib/server/db/schema';
import { productWithLocations } from '$lib/modules/lager/server/products';
import { requirePermission } from '$lib/server/guard';
import type { RequestHandler } from './$types';

/** Alle Artikel mit Bestand an einem Lagerort – Startliste für die Inventur */
export const GET: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'lager.bestand.sehen');
	const locationId = Number(params.id);
	const rows = await db
		.select({ id: stock.productId })
		.from(stock)
		.innerJoin(products, eq(products.id, stock.productId))
		.where(and(eq(stock.locationId, locationId), gt(stock.quantity, 0)))
		.orderBy(products.name)
		.all();
	const items = [];
	for (const r of rows) {
		const p = await productWithLocations(r.id);
		if (p) items.push(p);
	}
	return json({ items });
};
