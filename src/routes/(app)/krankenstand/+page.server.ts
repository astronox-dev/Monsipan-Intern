import { fail } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import {
	addSickDocuments,
	createSick,
	deleteSick,
	deleteSickDocument,
	listSick,
	MAX_BELEGE,
	readSick,
	sickPeople,
	sickScope,
	updateSick
} from '$lib/modules/planung/server/krank';
import { isValidIsoDate, today } from '$lib/modules/stunden/week';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const user = requirePermission(locals, 'krankenstand.eigene.sehen');
	const thisYear = Number(today().slice(0, 4));
	const raw = Number(url.searchParams.get('jahr'));
	const year = Number.isInteger(raw) && raw > 2000 && raw < 2100 ? raw : thisYear;
	return {
		year,
		thisYear,
		today: today(),
		me: user.id,
		scope: sickScope(user),
		rows: await listSick(user, year),
		people: await sickPeople(user),
		canReport: can(user.role, 'krankenstand.melden'),
		canManage: can(user.role, 'krankenstand.bearbeiten'),
		maxBelege: MAX_BELEGE
	};
};

/** Die mitgeschickten Belege – leere Dateifelder fallen weg */
const files = (form: FormData) => form.getAll('beleg').filter((f): f is File => f instanceof File && f.size > 0);

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requirePermission(locals, 'krankenstand.melden');
		const form = await request.formData();
		const input = readSick(form, user);
		if ('message' in input) return fail(400, input);
		const result = await createSick(user, input, files(form));
		if (typeof result !== 'number') return fail(400, result);
		return { created: true };
	},

	update: async ({ request, locals }) => {
		const user = requirePermission(locals, 'krankenstand.eigene.sehen');
		const form = await request.formData();
		const to = String(form.get('bis') ?? '');
		if (to && !isValidIsoDate(to)) return fail(400, { message: '„Bis" ist kein gültiges Datum.' });
		const result = await updateSick(user, Number(form.get('id')), to || null, String(form.get('notiz') ?? ''));
		if (result !== true) return fail(400, result);
		return { updated: true };
	},

	documents: async ({ request, locals }) => {
		const user = requirePermission(locals, 'krankenstand.eigene.sehen');
		const form = await request.formData();
		const result = await addSickDocuments(user, Number(form.get('id')), files(form));
		if (result !== true) return fail(400, result);
		return { uploaded: true };
	},

	removeDocument: async ({ request, locals }) => {
		const user = requirePermission(locals, 'krankenstand.eigene.sehen');
		const result = await deleteSickDocument(user, Number((await request.formData()).get('id')));
		if (result !== true) return fail(400, result);
		return { updated: true };
	},

	remove: async ({ request, locals }) => {
		const user = requirePermission(locals, 'krankenstand.eigene.sehen');
		const result = await deleteSick(user, Number((await request.formData()).get('id')));
		if (result !== true) return fail(400, result);
		return { removed: true };
	}
};
