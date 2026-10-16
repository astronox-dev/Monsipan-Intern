import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { globalSearch } from '$lib/server/search';
import type { RequestHandler } from './$types';

/** GET /api/suche?q=… → Treffer je Bereich, nur was der Benutzer sehen darf (Feld oben, Strg K) */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireUser(locals);
	const groups = await globalSearch(user, url.searchParams.get('q') ?? '');
	return json({ groups }, { headers: { 'cache-control': 'no-store' } });
};
