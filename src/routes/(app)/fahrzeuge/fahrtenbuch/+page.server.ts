import { requirePermission } from '$lib/server/guard';
import { listPlaces } from '$lib/modules/fuhrpark/server/places';
import { logbook, readRange } from '$lib/modules/fuhrpark/server/trips';
import { KEEP_DAYS, listVehicles } from '$lib/modules/fuhrpark/server/vehicles';
import type { PageServerLoad } from './$types';

/** Fahrtenbuch: je Fahrt Beginn, Ende, Strecke und Fahrer – standardmäßig die letzten 7 Tage */
export const load: PageServerLoad = async ({ url, locals, depends }) => {
	// Nicht app:fahrzeuge – das Rechnen über alle Autos soll nicht bei jedem Standort anlaufen
	depends('app:fahrtenbuch');
	requirePermission(locals, 'fahrzeuge.sehen');
	const range = readRange(url, 7, KEEP_DAYS);
	const [vehicles, places] = await Promise.all([listVehicles(), listPlaces()]);
	const wanted = Number(url.searchParams.get('fahrzeug'));
	const selected = vehicles.filter((v) => (wanted ? v.id === wanted : v.active));
	const book = await logbook(selected, range.from, range.to, places);
	return {
		...book,
		range,
		vehicle: selected.length === 1 && wanted ? wanted : null,
		vehicles: vehicles.map((v) => ({ id: v.id, name: v.name }))
	};
};
