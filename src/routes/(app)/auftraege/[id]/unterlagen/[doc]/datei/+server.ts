import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { documentResponse } from '$lib/server/documents';
import { findOrderDocument, mayOpenOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import { hasWorkOrder } from '$lib/modules/auftraege/server/work-orders';
import type { RequestHandler } from './$types';

/** PDF zum Auftrag – zum Anzeigen oder mit ?download zum Speichern; nur wer den Auftrag sieht */
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	if (!order || !(await mayOpenOrder(user, order))) error(404, 'Auftrag nicht gefunden');
	// Die Partie sieht die Unterlagen über den Arbeitsauftrag
	if (!seesWholeOrder(user) && !(await hasWorkOrder(order.id))) error(404, 'Auftrag nicht gefunden');
	const doc = await findOrderDocument(order, params.doc, user);
	if (!doc) error(404, 'Unterlage nicht gefunden');
	return documentResponse(doc, url, request);
};
