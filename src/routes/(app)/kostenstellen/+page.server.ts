import { requirePermission } from '$lib/server/guard';
import { costCenterHours, readCostCenterFilter } from '$lib/modules/stunden/server/kostenstellen';
import { today } from '$lib/modules/stunden/week';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	requirePermission(locals, 'stunden.alle.sehen');
	const filter = readCostCenterFilter(url.searchParams);
	return {
		...filter,
		today: today(),
		rows: await costCenterHours(filter.from, filter.to, filter.scope)
	};
};
