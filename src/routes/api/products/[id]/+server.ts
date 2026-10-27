import { error, json } from '@sveltejs/kit';
import { productWithLocations } from '$lib/modules/lager/server/products';
import { requirePermission } from '$lib/server/guard';
import type { RequestHandler } from './$types';

/** Artikel mit Bestand je Lagerort – für Buchungszeilen nach einer Suche */
export const GET: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'lager.artikel.sehen');
	const product = await productWithLocations(Number(params.id));
	if (!product) error(404, 'Artikel nicht gefunden');
	return json(product);
};
