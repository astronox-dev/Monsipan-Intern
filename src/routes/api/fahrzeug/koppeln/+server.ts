import { json } from '@sveltejs/kit';
import { isRateLimited, registerFailure } from '$lib/server/auth';
import { pairDevice } from '$lib/modules/fuhrpark/server/vehicles';
import type { RequestHandler } from './$types';

/**
 * Tablet koppeln – ohne Anmeldung, der Code aus dem Portal (Fahrzeuge →
 * Koppeln) ist der Schlüssel. JSON { code, device } → { token, vehicle }.
 * Falsche Codes zählen je Adresse; nach 8 ist eine Viertelstunde Pause.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const key = `koppeln:${getClientAddress()}`;
	if (isRateLimited(key)) return json({ ok: false, message: 'Zu viele Versuche – bitte in einer Viertelstunde erneut.' }, { status: 429 });
	let body: { code?: unknown; device?: unknown } | null = null;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, message: 'Erwartet wird JSON' }, { status: 400 });
	}
	const paired = await pairDevice(String(body?.code ?? ''), String(body?.device ?? ''));
	if (!paired) {
		registerFailure(key);
		return json({ ok: false, message: 'Der Code stimmt nicht oder ist abgelaufen – im Portal einen neuen erzeugen.' }, { status: 401 });
	}
	return json({ ok: true, token: paired.token, vehicle: paired.vehicle });
};
