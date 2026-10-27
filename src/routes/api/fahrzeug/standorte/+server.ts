import { json } from '@sveltejs/kit';
import { cleanPositions, recordPositions, vehicleByToken } from '$lib/modules/fuhrpark/server/vehicles';
import type { RequestHandler } from './$types';

/**
 * Standorte vom Tablet – „Authorization: Bearer <Schlüssel vom Koppeln>".
 * JSON { positions: [{ t, lat, lon, spd, hdg, acc }], battery, charging }.
 * Auch ohne Standorte ein Lebenszeichen. 401 heißt: entkoppelt – die App hört
 * dann auf zu senden.
 */
export const POST: RequestHandler = async ({ request }) => {
	const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
	const vehicle = await vehicleByToken(token);
	if (!vehicle) return json({ ok: false, message: 'Dieses Tablet ist nicht (mehr) gekoppelt.' }, { status: 401 });
	if (!vehicle.active) return json({ ok: false, message: 'Das Fahrzeug ist im Portal ausgeblendet.' }, { status: 403 });
	let body: Record<string, unknown> | null = null;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, message: 'Erwartet wird JSON' }, { status: 400 });
	}
	const positions = cleanPositions(body?.positions);
	const battery = typeof body?.battery === 'number' && Number.isFinite(body.battery) ? body.battery : null;
	const charging = typeof body?.charging === 'boolean' ? body.charging : null;
	await recordPositions(vehicle, positions, { battery, charging });
	return json({ ok: true, saved: positions.length, vehicle: vehicle.name });
};
