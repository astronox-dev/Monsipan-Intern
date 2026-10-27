import { fail } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { partyOptions } from '$lib/server/options';
import { createVehicle, deleteVehicle, listVehicles, readVehicle, startPairing, unpair, updateVehicle } from '$lib/modules/fuhrpark/server/vehicles';
import { vehicleState } from '$lib/modules/fuhrpark/track';
import type { Actions, PageServerLoad } from './$types';

/** Die App für die Tablets – fester Link auf die neueste Fassung */
const FAHRZEUG_APK = 'https://github.com/mstreicher98/Monsipan-Intern/releases/download/fahrzeug-app/monsipan-fahrzeug.apk';

export const load: PageServerLoad = async ({ locals, depends }) => {
	depends('app:fahrzeuge');
	const user = requirePermission(locals, 'fahrzeuge.sehen');
	const canManage = can(user.role, 'fahrzeuge.verwalten');
	const now = Date.now();
	const rows = await listVehicles();
	return {
		vehicles: rows
			.filter((v) => v.active || canManage)
			.map((v) => ({
				...v,
				lastAt: v.lastAt?.getTime() ?? null,
				lastSeenAt: v.lastSeenAt?.getTime() ?? null,
				pairedAt: v.pairedAt?.getTime() ?? null,
				state: vehicleState(v, now)
			})),
		now,
		canManage,
		parties: canManage ? await partyOptions() : [],
		apk: FAHRZEUG_APK
	};
};

const manage = (locals: App.Locals) => requirePermission(locals, 'fahrzeuge.verwalten');
const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		manage(locals);
		const form = await request.formData();
		const input = readVehicle(form);
		if ('message' in input) return fail(400, { message: input.message });
		const id = idOf(form);
		if (id) await updateVehicle(id, input);
		else await createVehicle(input);
		return { saved: true };
	},

	/** Kopplungscode erzeugen – 30 Minuten gültig */
	pair: async ({ request, locals }) => {
		manage(locals);
		const id = idOf(await request.formData());
		if (!id) return fail(400, { message: 'Fahrzeug fehlt.' });
		const { code, expires } = await startPairing(id);
		return { pairing: { id, code, expires: expires.getTime() } };
	},

	unpair: async ({ request, locals }) => {
		manage(locals);
		const id = idOf(await request.formData());
		if (!id) return fail(400, { message: 'Fahrzeug fehlt.' });
		await unpair(id);
		return { unpaired: true };
	},

	delete: async ({ request, locals }) => {
		manage(locals);
		const id = idOf(await request.formData());
		if (!id) return fail(400, { message: 'Fahrzeug fehlt.' });
		await deleteVehicle(id);
		return { deleted: true };
	}
};
