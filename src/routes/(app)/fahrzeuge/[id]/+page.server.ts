import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { periodByKey, periodRange } from '$lib/modules/fuhrpark/periods';
import { listPlaces } from '$lib/modules/fuhrpark/server/places';
import { rangeView } from '$lib/modules/fuhrpark/server/trips';
import { getVehicle, KEEP_DAYS } from '$lib/modules/fuhrpark/server/vehicles';
import { vehicleState } from '$lib/modules/fuhrpark/track';
import { fullName } from '$lib/format';
import { addDays, isValidIsoDate } from '$lib/modules/stunden/week';
import { viennaTime } from '$lib/weather';
import type { PageServerLoad } from './$types';

/** Verlauf eines Fahrzeugs: ein Zeitraum (?zeit=…) oder ein Tag (?tag=…) – Fahrten und Standzeiten über Mitternacht ganz */
export const load: PageServerLoad = async ({ params, url, locals, depends }) => {
	depends('app:ablauf');
	requirePermission(locals, 'fahrzeuge.sehen');
	const vehicle = await getVehicle(Number(params.id));
	if (!vehicle) error(404, 'Fahrzeug nicht gefunden');
	const today = viennaTime(new Date()).date;
	const oldest = addDays(today, -KEEP_DAYS);
	const asked = url.searchParams.get('tag') ?? '';
	const period = periodByKey(url.searchParams.get('zeit'));
	const day = isValidIsoDate(asked) && asked <= today && asked >= oldest ? asked : today;
	const { from, to } = period ? periodRange(period, today) : { from: day, to: day };
	const single = from === to;
	// Ein Tag wächst live mit (siehe app:fahrzeuge im Layout) – längere Zeiträume rechnen nicht bei jedem Standort neu
	if (single) depends('app:fahrzeuge');
	const places = await listPlaces();
	const view = await rangeView(vehicle, from, to, places);
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
		from,
		to,
		single,
		/** Welcher Reiter leuchtet – auch, wenn heute oder gestern über den Kalender gewählt ist */
		period: period?.key ?? (from === today ? 'heute' : from === addDays(today, -1) ? 'gestern' : null),
		today,
		oldest,
		items: view.items,
		track: view.track.map((p) => ({ lat: p.lat, lon: p.lon })),
		places: places.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, radius: p.radius })),
		pending: view.pending
	};
};
