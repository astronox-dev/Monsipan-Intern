import { requirePermission } from '$lib/server/guard';
import { planWeek, seesAllPlans } from '$lib/modules/planung/server/plan';
import { planPdf } from '$lib/modules/planung/server/plan-pdf';
import { isValidIsoDate, mondayOf, today } from '$lib/modules/stunden/week';
import type { RequestHandler } from './$types';

/** Die Woche als PDF – so weit sie diese Person sieht (die Partie nur ihre eigene) */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requirePermission(locals, 'planung.sehen');
	const raw = url.searchParams.get('woche') ?? '';
	const weekStart = mondayOf(isValidIsoDate(raw) ? raw : today());
	const week = await planWeek(user, weekStart);
	return planPdf(week, weekStart, seesAllPlans(user) ? 'Alle Partien' : (week.parties[0]?.name ?? 'Keine Partie'));
};
