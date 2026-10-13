import { json } from '@sveltejs/kit';
import { isRateLimited, registerFailure } from '$lib/server/auth';
import { isWebsiteKey, receiveWebsiteInquiry } from '$lib/modules/auftraege/server/website';
import type { RequestHandler } from './$types';

/**
 * Anfrage vom Kontaktformular der Webseite – ohne Anmeldung, der Schlüssel aus
 * Verwaltung → Einstellungen kommt als „Authorization: Bearer …". Erwartet JSON
 * mit name, company, email, phone, topic, message (siehe readWebsiteInquiry).
 */
export const POST: RequestHandler = async ({ request }) => {
	const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
	if (!(await isWebsiteKey(token))) return json({ ok: false, message: 'Schlüssel fehlt oder stimmt nicht' }, { status: 401 });

	// Die Webseite begrenzt je Besucher; das hier fängt ab, falls der Schlüssel in falsche Hände gerät
	if (isRateLimited('webseite-anfragen', 60, 60 * 60_000)) return json({ ok: false, message: 'Zu viele Anfragen – bitte später erneut' }, { status: 429 });

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return json({ ok: false, message: 'Erwartet wird JSON' }, { status: 400 });
	}
	const result = await receiveWebsiteInquiry(payload);
	if ('problem' in result) return json({ ok: false, message: result.problem }, { status: 422 });
	registerFailure('webseite-anfragen', 60 * 60_000);
	return json({ ok: true, id: result.id });
};
