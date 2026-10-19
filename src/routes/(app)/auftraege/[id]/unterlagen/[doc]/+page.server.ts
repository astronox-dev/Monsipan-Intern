import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { findOrderDocument, mayViewOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import { hasWorkOrder } from '$lib/modules/auftraege/server/work-orders';
import { SOURCE_LABELS } from '$lib/modules/auftraege/server/case-files';
import type { PageServerLoad } from './$types';

/**
 * PDF des Vorgangs am Auftrag – ein eigenes („12"), eins vom Angebot („a12")
 * oder von der Anfrage („i12"). Die Partie sieht nur, was für sie ist.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	if (!order || !mayViewOrder(user, order)) error(404, 'Auftrag nicht gefunden');
	// Die Partie sieht die Unterlagen über den Arbeitsauftrag
	if (!seesWholeOrder(user) && !(await hasWorkOrder(order.id))) error(404, 'Auftrag nicht gefunden');
	const document = await findOrderDocument(order, params.doc, user);
	if (!document) error(404, 'Unterlage nicht gefunden');
	return {
		order: { id: order.id, number: order.number, title: order.title },
		document: { key: params.doc, title: document.title, fileName: document.fileName, size: document.size },
		note: [document.source !== 'auftrag' ? SOURCE_LABELS[document.source] : '', document.forCrew ? '' : 'nur Büro'].filter(Boolean).join(' · ')
	};
};
