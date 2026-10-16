import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { documentResponse } from '$lib/server/documents';
import { getOfferDocument } from '$lib/modules/auftraege/server/offer-documents';
import type { RequestHandler } from './$types';

/** PDF am Angebot – zum Anzeigen oder mit ?download zum Speichern; wer Angebote sieht */
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	requirePermission(locals, 'angebote.sehen');
	const doc = await getOfferDocument(Number(params.id), Number(params.doc));
	if (!doc) error(404, 'Unterlage nicht gefunden');
	return documentResponse(doc, url, request);
};
