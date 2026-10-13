import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { BACKUP_DIR, BACKUP_FILE_RE } from '$lib/server/backup';
import { backupZip, zipName } from '$lib/server/backup-zip';
import { requirePermission } from '$lib/server/guard';
import type { RequestHandler } from './$types';

/**
 * Komplettsicherung herunterladen – die Datenbank-Sicherung samt allen Dateien
 * als ZIP-Datei (siehe backup-zip). Wer Einstellungen bearbeiten darf.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'einstellungen.bearbeiten');
	if (!BACKUP_FILE_RE.test(params.file)) error(404, 'Nicht gefunden');
	const file = path.join(BACKUP_DIR, params.file);
	if (!fs.existsSync(file)) error(404, 'Nicht gefunden');
	const zip = await backupZip(file);
	return new Response(Readable.toWeb(zip.stream) as ReadableStream, {
		headers: {
			'content-type': 'application/zip',
			...(zip.size >= 0 ? { 'content-length': String(zip.size) } : {}),
			'content-disposition': `attachment; filename="${zipName(params.file)}"`,
			'cache-control': 'no-store'
		}
	});
};
