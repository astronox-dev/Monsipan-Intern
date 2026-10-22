import { fail } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { getSettings } from '$lib/server/settings';
import { approvedTotals, createLeave, decideLeave, deleteLeave, leavePeople, leaveScope, listLeave, readLeave } from '$lib/modules/planung/server/urlaub';
import { today } from '$lib/modules/stunden/week';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const user = requirePermission(locals, 'urlaub.eigene.sehen');
	const thisYear = Number(today().slice(0, 4));
	const raw = Number(url.searchParams.get('jahr'));
	const year = Number.isInteger(raw) && raw > 2000 && raw < 2100 ? raw : thisYear;
	const rows = await listLeave(user, year);
	const totals = approvedTotals(rows);
	return {
		year,
		thisYear,
		today: today(),
		me: user.id,
		scope: leaveScope(user),
		rows: rows.map(({ inYear: _, ...r }) => r),
		totals: [...totals.entries()].map(([userId, t]) => ({ userId, name: rows.find((r) => r.userId === userId)?.name ?? '', ...t })).sort((a, b) => a.name.localeCompare(b.name, 'de')),
		/** Für die Vorschau beim Beantragen */
		leaveHours: (await getSettings()).leaveHours,
		people: await leavePeople(user),
		canRequest: can(user.role, 'urlaub.beantragen'),
		canDecide: can(user.role, 'urlaub.genehmigen')
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requirePermission(locals, 'urlaub.eigene.sehen');
		const input = readLeave(await request.formData(), user);
		if ('message' in input) return fail(400, input);
		const result = await createLeave(user, input);
		if (typeof result !== 'number') return fail(400, result);
		return { created: input.userId === user.id ? 'beantragt' : 'eingetragen' };
	},

	decide: async ({ request, locals }) => {
		const user = requirePermission(locals, 'urlaub.genehmigen');
		const form = await request.formData();
		const status = form.get('entscheidung') === 'genehmigt' ? 'genehmigt' : 'abgelehnt';
		const result = await decideLeave(user, Number(form.get('id')), status, String(form.get('hinweis') ?? ''));
		if (result !== true) return fail(400, result);
		return { decided: status };
	},

	remove: async ({ request, locals }) => {
		const user = requirePermission(locals, 'urlaub.eigene.sehen');
		const result = await deleteLeave(user, Number((await request.formData()).get('id')));
		if (result !== true) return fail(400, result);
		return { removed: true };
	}
};
