import { requirePermission } from '$lib/server/guard';
import { listPlaces } from '$lib/modules/fuhrpark/server/places';
import { fleetStats } from '$lib/modules/fuhrpark/server/trips';
import { listVehicles } from '$lib/modules/fuhrpark/server/vehicles';
import { addDays } from '$lib/modules/stunden/week';
import { viennaTime } from '$lib/weather';
import type { PageServerLoad } from './$types';

/** Die Zeiträume zur Auswahl: Tage zurück ab heute */
const PERIODS = [
	{ key: 'heute', label: 'Heute', from: 0, to: 0 },
	{ key: 'gestern', label: 'Gestern', from: 1, to: 1 },
	{ key: 'woche', label: '7 Tage', from: 6, to: 0 },
	{ key: 'monat', label: '30 Tage', from: 29, to: 0 }
];

// Nicht live wie die Karte: Das Rechnen über alle Autos soll nicht bei jedem Standort anlaufen
export const load: PageServerLoad = async ({ url, locals }) => {
	requirePermission(locals, 'fahrzeuge.sehen');
	const period = PERIODS.find((p) => p.key === url.searchParams.get('zeit')) ?? PERIODS[2];
	const today = viennaTime(new Date()).date;
	const from = addDays(today, -period.from);
	const to = addDays(today, -period.to);
	const [vehicles, places] = await Promise.all([listVehicles(), listPlaces()]);
	return {
		stats: await fleetStats(
			vehicles.filter((v) => v.active),
			from,
			to,
			places
		),
		period: period.key,
		periods: PERIODS.map((p) => ({ key: p.key, label: p.label }))
	};
};
