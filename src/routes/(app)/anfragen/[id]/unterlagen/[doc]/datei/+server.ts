import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { documentResponse } from '$lib/server/documents';
import { getInquiryDocument } from '$lib/modules/auftraege/server/attachments';
import type { RequestHandler } from './$types';

/** PDF an der Anfrage – zum Anzeigen oder mit ?download zum Speichern; wer Anfragen sieht */
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	requirePermission(locals, 'anfragen.sehen');
	const doc = await getInquiryDocument(Number(params.id), Number(params.doc));
	if (!doc) error(404, 'Unterlage nicht gefunden');
	return documentResponse(doc, url, request);
};
