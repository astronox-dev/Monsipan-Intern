import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { documentResponse } from '$lib/server/documents';
import { findOrderDocument, mayViewOrder, orderDetail } from '$lib/modules/auftraege/server/orders';
import type { RequestHandler } from './$types';

/** PDF zum Auftrag – zum Anzeigen oder mit ?download zum Speichern; nur wer den Auftrag sieht */
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	if (!order || !mayViewOrder(user, order)) error(404, 'Auftrag nicht gefunden');
	const doc = await findOrderDocument(order, params.doc);
	if (!doc) error(404, 'Unterlage nicht gefunden');
	return documentResponse(doc, url, request);
};
