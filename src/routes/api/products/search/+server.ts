import { json } from '@sveltejs/kit';
import { quickSearch } from '$lib/modules/lager/server/products';
import { requirePermission } from '$lib/server/guard';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	requirePermission(locals, 'lager.artikel.sehen');
	const q = (url.searchParams.get('q') ?? '').slice(0, 200);
	const limit = Math.min(20, Number(url.searchParams.get('limit')) || 8);
	const items = await quickSearch(q, limit, url.searchParams.has('inactive'));
	return json({ items });
};
