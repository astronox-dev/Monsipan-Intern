/**
 * Öffentliche Prüfseite hinter dem QR-Code einer Rechnung – ohne Anmeldung,
 * der zufällige Schlüssel im Link ist nicht erratbar. Gezeigt wird nur, was
 * nicht vertraulich ist: Nummer, Datum, Rechnungssteller, Status und das
 * Ergebnis der Prüfung – keine Beträge, keine Positionen, kein Kunde.
 */
import { error, fail } from '@sveltejs/kit';
import { publicVerification } from '$lib/modules/auftraege/server/signatur/verification';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
	const found = await publicVerification(params.token);
	if (found === 'aus') return { disabled: true as const, invoice: null };
	if (!found) error(404, 'Zu diesem Prüfcode gibt es keine Rechnung.');
	// Die Prüfsummen bleiben am Server – verglichen wird dort
	const { hashes: _hashes, ...invoice } = found;
	return { disabled: false as const, invoice };
};

export const actions: Actions = {
	/** Eine vorliegende PDF vergleichen: der Browser schickt nur ihren SHA-256, nicht die Datei */
	compare: async ({ params, request }) => {
		const hash = String((await request.formData()).get('sha256') ?? '')
			.trim()
			.toLowerCase();
		if (!/^[0-9a-f]{64}$/.test(hash)) return fail(400, { message: 'Die Datei ließ sich nicht prüfen.' });
		const found = await publicVerification(params.token);
		if (!found || found === 'aus') error(404, 'Zu diesem Prüfcode gibt es keine Rechnung.');
		return { compared: true, match: found.hashes.includes(hash) };
	}
};
