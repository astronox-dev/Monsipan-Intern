import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { listPlaces } from '$lib/modules/fuhrpark/server/places';
import { dayView } from '$lib/modules/fuhrpark/server/trips';
import { getVehicle, KEEP_DAYS } from '$lib/modules/fuhrpark/server/vehicles';
import { vehicleState } from '$lib/modules/fuhrpark/track';
import { fullName } from '$lib/format';
import { addDays, isValidIsoDate } from '$lib/modules/stunden/week';
import { viennaTime } from '$lib/weather';
import type { PageServerLoad } from './$types';

/** Verlauf eines Fahrzeugs: was an einem Tag lief – Fahrten und Standzeiten über Mitternacht ganz */
export const load: PageServerLoad = async ({ params, url, locals, depends }) => {
	// Heute wächst die Strecke live mit (siehe app:fahrzeuge im Layout)
	depends('app:fahrzeuge');
	requirePermission(locals, 'fahrzeuge.sehen');
	const vehicle = await getVehicle(Number(params.id));
	if (!vehicle) error(404, 'Fahrzeug nicht gefunden');
	const today = viennaTime(new Date()).date;
	const oldest = addDays(today, -KEEP_DAYS);
	const asked = url.searchParams.get('tag') ?? '';
	const day = isValidIsoDate(asked) && asked <= today && asked >= oldest ? asked : today;
	const places = await listPlaces();
	const view = await dayView(vehicle, day, places);
	return {
		vehicle: {
			id: vehicle.id,
			name: vehicle.name,
			plate: vehicle.plate,
			kind: vehicle.kind,
			partyName: vehicle.partyName,
			driverName: vehicle.driverId ? fullName({ firstName: vehicle.driverFirst, lastName: vehicle.driverLast }) : '',
			state: vehicleState(vehicle)
		},
		day,
		today,
		oldest,
		items: view.items,
		track: view.track.map((p) => ({ lat: p.lat, lon: p.lon })),
		places: places.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, radius: p.radius })),
		pending: view.pending
	};
};
