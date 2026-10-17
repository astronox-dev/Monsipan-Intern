import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { can } from '$lib/permissions';
import { mayViewOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import { orderSummary } from '$lib/modules/auftraege/server/summary';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requirePermission(locals, 'tagesberichte.sehen');
	const order = await orderDetail(Number(params.id));
	// Die Partie sieht nur den Arbeitsauftrag, nicht den ganzen Auftrag
	if (!order || !mayViewOrder(user, order) || !seesWholeOrder(user)) error(404, 'Auftrag nicht gefunden');
	return {
		order: { id: order.id, number: order.number, title: order.title, location: order.location, customerName: order.customerName, customerCity: order.customerCity, partyName: order.partyName },
		summary: await orderSummary(order.id),
		// Welcher Bericht mit welcher Rechnung abgerechnet ist
		seesInvoices: can(user.role, 'rechnungen.sehen')
	};
};
