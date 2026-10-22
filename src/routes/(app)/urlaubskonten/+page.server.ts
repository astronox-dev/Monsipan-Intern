import { fail } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { getSettings } from '$lib/server/settings';
import { accountPeople, deleteEmployment, leaveAccountsFor, saveEmployment, saveLeaveAccount } from '$lib/modules/planung/server/konto';
import { parseAmount } from '$lib/modules/auftraege/offer';
import { today } from '$lib/modules/stunden/week';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requirePermission(locals, 'urlaub.konten.bearbeiten');
	// Wer Urlaubskonten pflegt, sieht alle – unabhängig davon, wie weit er Urlaub sieht
	const people = await accountPeople(user, true);
	const views = await leaveAccountsFor(
		people.map((p) => p.id),
		today()
	);
	return {
		today: today(),
		accounts: people.map((p) => ({ ...p, ...views.get(p.id)! })),
		leaveWeeks: (await getSettings()).leaveWeeks
	};
};

export const actions: Actions = {
	/** Beschäftigungszeit anlegen, ändern („abmelden") oder entfernen */
	periode: async ({ request, locals }) => {
		const user = requirePermission(locals, 'urlaub.konten.bearbeiten');
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (form.get('entfernen') && id) {
			await deleteEmployment(user, id);
			return { account: 'entfernt' };
		}
		const result = await saveEmployment(user, {
			id: Number.isInteger(id) && id > 0 ? id : null,
			userId: Number(form.get('person')),
			from: String(form.get('von') ?? ''),
			to: String(form.get('bis') ?? '') || null
		});
		if (result !== true) return fail(400, { accountMessage: result.message });
		return { account: 'gespeichert' };
	},

	/** Übertrag, Stichtag und eigene Urlaubswochen */
	konto: async ({ request, locals }) => {
		const user = requirePermission(locals, 'urlaub.konten.bearbeiten');
		const form = await request.formData();
		const rawCarry = String(form.get('uebertrag') ?? '').trim();
		const carryover = rawCarry ? parseAmount(rawCarry) : 0;
		if (carryover == null) return fail(400, { accountMessage: 'Der Übertrag ist keine Zahl.' });
		const rawWeeks = String(form.get('wochen') ?? '').trim();
		const weeks = rawWeeks ? parseAmount(rawWeeks) : null;
		if (rawWeeks && weeks == null) return fail(400, { accountMessage: 'Die Urlaubswochen sind keine Zahl.' });
		const result = await saveLeaveAccount(user, {
			userId: Number(form.get('person')),
			carryover,
			start: String(form.get('stichtag') ?? '') || null,
			weeks
		});
		if (result !== true) return fail(400, { accountMessage: result.message });
		return { account: 'gespeichert' };
	}
};
