import { error, json } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import { appendUploadPart, DocumentError, finishUpload } from '$lib/server/documents';
import { UPLOAD_ID } from '$lib/server/parts';
import type { RequestHandler } from './$types';

/**
 * Pläne in Teilen hochladen (siehe `$lib/upload`): POST ?id=…&ab=<Byte> mit dem
 * Teil als Inhalt, zum Schluss POST ?id=…&fertig&name=<Dateiname>. Angehängt
 * wird danach im Formular des Auftrags, des Angebots bzw. beim Erstellen des Auftrags.
 */
export const POST: RequestHandler = async ({ url, request, locals }) => {
	const user = requireUser(locals);
	if (!can(user.role, 'auftraege.bearbeiten') && !can(user.role, 'auftraege.erstellen') && !can(user.role, 'angebote.bearbeiten')) {
		error(403, 'Dafür fehlt dir die Berechtigung.');
	}
	const id = url.searchParams.get('id') ?? '';
	if (!UPLOAD_ID.test(id)) error(400, 'Unbekannter Upload');

	if (url.searchParams.has('fertig')) {
		try {
			const stored = await finishUpload(user.id, id, url.searchParams.get('name') ?? '');
			return json({ size: stored.size });
		} catch (err) {
			if (err instanceof DocumentError) return json({ message: err.message }, { status: 400 });
			throw err;
		}
	}

	const offset = Number(url.searchParams.get('ab'));
	if (!Number.isSafeInteger(offset) || offset < 0 || !request.body) error(400, 'Teil fehlt');
	const { ok, received } = await appendUploadPart(user.id, id, offset, request.body);
	return json({ received }, { status: ok ? 200 : 409 });
};
