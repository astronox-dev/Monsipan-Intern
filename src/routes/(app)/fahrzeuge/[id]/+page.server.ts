import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { dayPoints, getVehicle, KEEP_DAYS } from '$lib/modules/fuhrpark/server/vehicles';
import { kilometers, stops, vehicleState } from '$lib/modules/fuhrpark/track';
import { addDays, isValidIsoDate } from '$lib/modules/stunden/week';
import { viennaTime } from '$lib/weather';
import type { PageServerLoad } from './$types';

/** Verlauf eines Fahrzeugs an einem Tag: Strecke, Kilometer, Standzeiten */
export const load: PageServerLoad = async ({ params, url, locals }) => {
	requirePermission(locals, 'fahrzeuge.sehen');
	const vehicle = await getVehicle(Number(params.id));
	if (!vehicle) error(404, 'Fahrzeug nicht gefunden');
	const today = viennaTime(new Date()).date;
	const oldest = addDays(today, -KEEP_DAYS);
	const asked = url.searchParams.get('tag') ?? '';
	const day = isValidIsoDate(asked) && asked <= today && asked >= oldest ? asked : today;
	const points = await dayPoints(vehicle.id, day);
	return {
		vehicle: { id: vehicle.id, name: vehicle.name, plate: vehicle.plate, partyName: vehicle.partyName, state: vehicleState(vehicle) },
		day,
		today,
		oldest,
		track: points.map((p) => ({ lat: p.lat, lon: p.lon })),
		count: points.length,
		first: points[0]?.at ?? null,
		last: points.at(-1)?.at ?? null,
		km: kilometers(points),
		stops: stops(points)
	};
};
