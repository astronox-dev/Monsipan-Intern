import { error, json } from '@sveltejs/kit';
import { allCandidates, pickBestParse } from '$lib/modules/lager/scan/parse';
import { lookupByCandidates, productWithLocations } from '$lib/modules/lager/server/products';
import type { LookupResult } from '$lib/modules/lager/types';
import { requirePermission } from '$lib/server/guard';
import type { RequestHandler } from './$types';

/** GET /api/lookup?v=<Lesart 1>&v=<Lesart 2> → Artikel zum gescannten Code */
export const GET: RequestHandler = async ({ url, locals }) => {
	requirePermission(locals, 'lager.artikel.sehen');
	const variants = url.searchParams
		.getAll('v')
		.map((v) => v.slice(0, 1000))
		.filter((v) => v.trim())
		.slice(0, 4);
	if (!variants.length) error(400, 'Kein Code übergeben');

	const parsed = pickBestParse(variants);
	const hit = await lookupByCandidates(allCandidates(variants));
	const found = hit ? await Promise.all(hit.products.map((p) => productWithLocations(p.id))) : [];
	const products = found.filter((p) => p !== null);
	return json({ products, parsed, matched: hit?.matched ?? null } satisfies LookupResult);
};
