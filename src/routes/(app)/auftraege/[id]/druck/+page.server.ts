import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { mayViewOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	// Die Partie sieht nur den Arbeitsauftrag, nicht den ganzen Auftrag
	if (!order || !mayViewOrder(user, order) || !seesWholeOrder(user)) error(404, 'Auftrag nicht gefunden');
	return { id: order.id, number: order.number };
};
