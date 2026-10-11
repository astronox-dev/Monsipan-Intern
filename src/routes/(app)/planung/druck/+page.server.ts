import { requirePermission } from '$lib/server/guard';
import { isValidIsoDate, mondayOf, today } from '$lib/modules/stunden/week';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	requirePermission(locals, 'planung.sehen');
	const raw = url.searchParams.get('woche') ?? '';
	return { weekStart: mondayOf(isValidIsoDate(raw) ? raw : today()) };
};
