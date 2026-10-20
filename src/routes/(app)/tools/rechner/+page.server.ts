import { requirePermission } from '$lib/server/guard';
import type { PageServerLoad } from './$types';

/** Der Rechner rechnet im Browser – hier nur, ob man ihn öffnen darf */
export const load: PageServerLoad = async ({ locals }) => {
	requirePermission(locals, 'rechner.sehen');
	return {};
};
