import { error, json } from '@sveltejs/kit';
import { BACKUP_DIR } from '$lib/server/backup';
import { requirePermission } from '$lib/server/guard';
import { appendPart, partFile, UPLOAD_ID } from '$lib/server/parts';
import type { RequestHandler } from './$types';

/**
 * Sicherung in Teilen hochladen (siehe `$lib/upload`): POST ?id=…&ab=<Byte> mit
 * dem Teil als Inhalt. Eingespielt wird danach über Einstellungen → restore mit
 * dieser Kennung – erst dort wird das Passwort geprüft.
 */
export const POST: RequestHandler = async ({ url, request, locals }) => {
	const user = requirePermission(locals, 'einstellungen.bearbeiten');
	const id = url.searchParams.get('id') ?? '';
	if (!UPLOAD_ID.test(id)) error(400, 'Unbekannter Upload');
	const offset = Number(url.searchParams.get('ab'));
	if (!Number.isSafeInteger(offset) || offset < 0 || !request.body) error(400, 'Teil fehlt');
	const { ok, received } = await appendPart(partFile(BACKUP_DIR, user.id, id), offset, request.body);
	return json({ received }, { status: ok ? 200 : 409 });
};
