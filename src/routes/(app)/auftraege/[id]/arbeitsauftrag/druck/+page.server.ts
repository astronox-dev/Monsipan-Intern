import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { mayOpenOrder, orderDetail } from '$lib/modules/auftraege/server/orders';
import { hasWorkOrder } from '$lib/modules/auftraege/server/work-orders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	if (!order || !(await mayOpenOrder(user, order))) error(404, 'Auftrag nicht gefunden');
	if (!(await hasWorkOrder(order.id))) error(404, 'Zu diesem Auftrag gibt es keinen Arbeitsauftrag.');
	return { order: { id: order.id, number: order.number } };
};
