import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { mayViewOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import { summarySheet } from '$lib/modules/auftraege/server/summary';
import { summaryPdf } from '$lib/modules/auftraege/server/pdf';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requirePermission(locals, 'tagesberichte.sehen');
	const order = await orderDetail(Number(params.id));
	// Die Partie sieht nur den Arbeitsauftrag, nicht den ganzen Auftrag
	if (!order || !mayViewOrder(user, order) || !seesWholeOrder(user)) error(404, 'Auftrag nicht gefunden');
	return summaryPdf(await summarySheet(order.id));
};
