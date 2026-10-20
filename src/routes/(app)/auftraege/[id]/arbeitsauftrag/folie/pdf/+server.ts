import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { mayOpenOrder, orderDetail } from '$lib/modules/auftraege/server/orders';
import { getWorkOrder } from '$lib/modules/auftraege/server/work-orders';
import { foilPdf } from '$lib/modules/auftraege/server/foil-pdf';
import { foilSignatures } from '$lib/modules/auftraege/work-order';
import type { RequestHandler } from './$types';

/** Das 3M-Verlegeprotokoll allein – mit den Unterschriften aus dem Arbeitsauftrag */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	if (!order || !(await mayOpenOrder(user, order))) error(404, 'Auftrag nicht gefunden');
	const work = await getWorkOrder(order.id);
	if (!work || work.content.foilProtocol !== 'ja') error(404, 'Zu diesem Arbeitsauftrag gibt es kein Verlegeprotokoll.');
	return foilPdf({ number: order.number, foil: { ...work.content.foil, signatures: foilSignatures(work.content) } });
};
