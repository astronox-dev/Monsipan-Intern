import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { mayViewOrder, orderDetail } from '$lib/modules/auftraege/server/orders';
import { getWorkOrder } from '$lib/modules/auftraege/server/work-orders';
import { workOrderPdf } from '$lib/modules/auftraege/server/work-order-pdf';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	if (!order || !mayViewOrder(user, order)) error(404, 'Auftrag nicht gefunden');
	const work = await getWorkOrder(order.id);
	if (!work) error(404, 'Zu diesem Auftrag gibt es keinen Arbeitsauftrag.');
	return workOrderPdf({ number: order.number, content: work.content });
};
