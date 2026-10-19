import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { documentResponse } from '$lib/server/documents';
import { getDocument } from '$lib/modules/ablage/server/richtlinien';
import type { RequestHandler } from './$types';

/** Das PDF – zum Anzeigen oder mit ?download zum Speichern; wer den Bereich sieht */
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	requirePermission(locals, 'richtlinien.sehen');
	const doc = await getDocument(Number(params.id));
	if (!doc) error(404, 'Dokument nicht gefunden');
	return documentResponse(doc, url, request);
};
