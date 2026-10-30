import { fail } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { partyOptions } from '$lib/server/options';
import { fullName } from '$lib/format';
import { addressesFor, addressKey } from '$lib/modules/fuhrpark/server/addresses';
import { listPlaces } from '$lib/modules/fuhrpark/server/places';
import { createVehicle, deleteVehicle, driverOptions, listVehicles, parkedSince, readVehicle, startPairing, unpair, updateVehicle } from '$lib/modules/fuhrpark/server/vehicles';
import { placeAt, vehicleState } from '$lib/modules/fuhrpark/track';
import type { Actions, PageServerLoad } from './$types';

/** Die App für die Tablets – fester Link auf die neueste Fassung */
const FAHRZEUG_APK = 'https://github.com/mstreicher98/Monsipan-Intern/releases/download/fahrzeug-app/monsipan-fahrzeug.apk';

export const load: PageServerLoad = async ({ locals, depends }) => {
	depends('app:fahrzeuge');
	const user = requirePermission(locals, 'fahrzeuge.sehen');
	const canManage = can(user.role, 'fahrzeuge.verwalten');
	const now = Date.now();
	const [rows, places] = await Promise.all([listVehicles(), listPlaces()]);
	const shown = rows
		.filter((v) => v.active || canManage)
		.map((v) => {
			const position = v.lastLat != null && v.lastLon != null ? { lat: v.lastLat, lon: v.lastLon } : null;
			return { ...v, position, place: position ? (placeAt(position, places)?.name ?? null) : null, state: vehicleState(v, now) };
		});
	// Anschrift nur für Autos, die stehen und nicht an einem festen Ort sind – was fehlt, kommt beim nächsten Neuladen
	const parked = shown.filter((v) => v.state !== 'faehrt' && v.position);
	const addresses = await addressesFor(parked.filter((v) => !v.place).map((v) => v.position!));
	const since = new Map(await Promise.all(parked.map(async (v) => [v.id, await parkedSince(v.id)] as const)));
	return {
		vehicles: shown.map(({ position, ...v }) => ({
			...v,
			driverName: v.driverId ? fullName({ firstName: v.driverFirst, lastName: v.driverLast }) : '',
			address: position && v.state !== 'faehrt' ? (addresses.get(addressKey(position)) ?? '') : '',
			parkedSince: since.get(v.id) ?? null,
			lastAt: v.lastAt?.getTime() ?? null,
			lastSeenAt: v.lastSeenAt?.getTime() ?? null,
			pairedAt: v.pairedAt?.getTime() ?? null
		})),
		places: places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, radius: p.radius })),
		now,
		canManage,
		parties: canManage ? await partyOptions() : [],
		drivers: canManage ? await driverOptions() : [],
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
