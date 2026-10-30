/** Fahrtenbuch als Tabelle für Excel – dieselbe Auswahl wie auf der Seite */
import { csvResponse, toCsv } from '$lib/server/csv';
import { requirePermission } from '$lib/server/guard';
import { listPlaces } from '$lib/modules/fuhrpark/server/places';
import { logbook, readRange } from '$lib/modules/fuhrpark/server/trips';
import { KEEP_DAYS, listVehicles } from '$lib/modules/fuhrpark/server/vehicles';
import type { RequestHandler } from './$types';

const stamp = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });

export const GET: RequestHandler = async ({ url, locals }) => {
	requirePermission(locals, 'fahrzeuge.sehen');
	const range = readRange(url, 7, KEEP_DAYS);
	const [vehicles, places] = await Promise.all([listVehicles(), listPlaces()]);
	const wanted = Number(url.searchParams.get('fahrzeug'));
	const { entries } = await logbook(
		vehicles.filter((v) => (wanted ? v.id === wanted : v.active)),
		range.from,
		range.to,
		places
	);
	const rows = entries.map((e) => [stamp.format(e.from), stamp.format(e.to), e.start, e.end, e.km, Math.round((e.to - e.from) / 60_000), e.driver, e.vehicleName, e.plate]);
	return csvResponse(`fahrtenbuch-${range.from}-${range.to}.csv`, toCsv(['Beginn', 'Ende', 'Abfahrt', 'Ankunft', 'Kilometer', 'Minuten', 'Fahrer', 'Fahrzeug', 'Kennzeichen'], rows));
};
