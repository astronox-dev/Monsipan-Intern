import fs from 'node:fs';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { sickDocument } from '$lib/modules/planung/server/krank';
import type { RequestHandler } from './$types';

/** Krankmeldung ansehen – nur die Person selbst, wer gemeldet hat, und das Büro */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = requirePermission(locals, 'krankenstand.eigene.sehen');
	const doc = await sickDocument(user, Number(params.id));
	if (!doc) error(404, 'Beleg nicht gefunden');
	const name = doc.fileName || `krankmeldung.${doc.kind}`;
	const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
	const disposition = url.searchParams.has('download') ? 'attachment' : 'inline';
	return new Response(Readable.toWeb(fs.createReadStream(doc.file)) as ReadableStream, {
		headers: {
			'content-type': doc.kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
			'content-length': String(fs.statSync(doc.file).size),
			'content-disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
			// Gesundheitsdaten: nicht zwischenspeichern
			'cache-control': 'private, no-store'
		}
	});
};
