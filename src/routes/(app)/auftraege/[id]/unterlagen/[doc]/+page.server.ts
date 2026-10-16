import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { findOrderDocument, mayViewOrder, orderDetail } from '$lib/modules/auftraege/server/orders';
import type { PageServerLoad } from './$types';

/** Unterlage zum Auftrag – eine eigene („12") oder eine vom Angebot für die Partie („a12") */
export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	if (!order || !mayViewOrder(user, order)) error(404, 'Auftrag nicht gefunden');
	const document = await findOrderDocument(order, params.doc);
	if (!document) error(404, 'Unterlage nicht gefunden');
	return {
		order: { id: order.id, number: order.number, title: order.title },
		document: { key: params.doc, fromOffer: params.doc.startsWith('a'), title: document.title, fileName: document.fileName, size: document.size }
	};
};
