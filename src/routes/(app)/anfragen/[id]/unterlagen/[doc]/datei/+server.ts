import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { documentResponse } from '$lib/server/documents';
import { chainOfInquiry, findCaseDocument, parseRef } from '$lib/modules/auftraege/server/case-files';
import type { RequestHandler } from './$types';

/** PDF des Vorgangs – zum Anzeigen oder mit ?download zum Speichern; wer Anfragen sieht */
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	requirePermission(locals, 'anfragen.sehen');
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Anfrage nicht gefunden');
	const doc = await findCaseDocument(await chainOfInquiry(id), parseRef(params.doc, 'anfrage'));
	if (!doc) error(404, 'Unterlage nicht gefunden');
	return documentResponse(doc, url, request);
};
