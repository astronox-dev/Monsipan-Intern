import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { ORDER_STATUS, type OrderStatus } from '$lib/server/db/schema';
import { activeParties, countOrders, listOrders } from '$lib/modules/auftraege/server/orders';
import { invoiceStates } from '$lib/modules/auftraege/server/invoices';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requirePermission(locals, 'auftraege.sehen');
	const all = can(user.role, 'auftraege.alle.sehen');
	const rawParty = url.searchParams.get('partie');
	const party = Number(rawParty);
	const base = {
		q: url.searchParams.get('q') ?? '',
		partyId: !all ? null : rawParty === 'ohne' ? ('ohne' as const) : Number.isInteger(party) && party > 0 ? party : null
	};
	const counts = await countOrders(user, base);
	// Drei Listen: erstellt, in Arbeit, abgeschlossen. Ohne Auswahl die erste, in der etwas steht
	const asked = url.searchParams.get('status') as OrderStatus | null;
	const status: OrderStatus = asked && ORDER_STATUS.includes(asked) ? asked : (ORDER_STATUS.find((s) => counts[s] > 0) ?? 'erstellt');
	const orders = await listOrders(user, { ...base, status });
	const seesInvoices = can(user.role, 'rechnungen.sehen');
	return {
		orders,
		counts,
		filter: { ...base, status },
		all,
		parties: all ? await activeParties() : [],
		hasParty: !!user.partyId,
		// Bei abgeschlossenen: gibt es schon eine Rechnung?
		invoices: seesInvoices && status === 'abgeschlossen' ? await invoiceStates(orders.map((o) => o.id)) : null
	};
};
