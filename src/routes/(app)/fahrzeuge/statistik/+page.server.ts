import { requirePermission } from '$lib/server/guard';
import { periodByKey, periodRange, PERIODS } from '$lib/modules/fuhrpark/periods';
import { listPlaces } from '$lib/modules/fuhrpark/server/places';
import { fleetStats } from '$lib/modules/fuhrpark/server/trips';
import { listVehicles } from '$lib/modules/fuhrpark/server/vehicles';
import { viennaTime } from '$lib/weather';
import type { PageServerLoad } from './$types';

// Nicht live wie die Karte: Das Rechnen über alle Autos soll nicht bei jedem Standort anlaufen
export const load: PageServerLoad = async ({ url, locals }) => {
	requirePermission(locals, 'fahrzeuge.sehen');
	const period = periodByKey(url.searchParams.get('zeit')) ?? PERIODS[2];
	const { from, to } = periodRange(period, viennaTime(new Date()).date);
	const [vehicles, places] = await Promise.all([listVehicles(), listPlaces()]);
	return {
		stats: await fleetStats(
			vehicles.filter((v) => v.active),
			from,
			to,
			places
		),
		period: period.key
	};
};
