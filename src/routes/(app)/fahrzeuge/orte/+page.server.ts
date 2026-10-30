import { fail } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { searchAddress } from '$lib/modules/fuhrpark/server/addresses';
import { createPlace, deletePlace, listPlaces, readPlace, updatePlace } from '$lib/modules/fuhrpark/server/places';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requirePermission(locals, 'fahrzeuge.sehen');
	return { places: await listPlaces(), canManage: can(user.role, 'fahrzeuge.verwalten') };
};

const manage = (locals: App.Locals) => requirePermission(locals, 'fahrzeuge.verwalten');
const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
};

export const actions: Actions = {
	/** Adresse suchen – die Treffer stehen zur Auswahl */
	search: async ({ request, locals }) => {
		manage(locals);
		const q = String((await request.formData()).get('q') ?? '');
		try {
			return { hits: await searchAddress(q) };
		} catch (e) {
			console.warn('[fahrzeuge] Adresssuche fehlgeschlagen –', e instanceof Error ? e.message : e);
			return fail(502, { message: 'Die Adresssuche antwortet gerade nicht. Den Ort stattdessen auf der Karte wählen.' });
		}
	},

	save: async ({ request, locals }) => {
		manage(locals);
		const form = await request.formData();
		const input = readPlace(form);
		if ('message' in input) return fail(400, { message: input.message });
		const id = idOf(form);
		if (id) await updatePlace(id, input);
		else await createPlace(input);
		return { saved: true };
	},

	delete: async ({ request, locals }) => {
		manage(locals);
		const id = idOf(await request.formData());
		if (!id) return fail(400, { message: 'Ort fehlt.' });
		await deletePlace(id);
		return { deleted: true };
	}
};
