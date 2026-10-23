import { error, json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { getWeather, placeName, roundCoord } from '$lib/server/weather';
import type { RequestHandler } from './$types';

/**
 * Wetter am Standort des Geräts – für die Übersicht. Die Lage kommt im Body
 * (nicht in der Adresse, damit sie in keinem Protokoll steht) und wird auf
 * etwa einen Kilometer gerundet.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	requireUser(locals);
	const body = await request.json().catch(() => null);
	const lat = Number(body?.lat);
	const lon = Number(body?.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) error(400, 'Standort fehlt');
	const place = { lat: roundCoord(lat), lon: roundCoord(lon) };
	const name = (await placeName(place.lat, place.lon)) || 'Aktueller Standort';
	const weather = await getWeather({ name, ...place });
	if (!weather) error(503, 'Die Vorhersage ist gerade nicht abrufbar.');
	return json(weather);
};
