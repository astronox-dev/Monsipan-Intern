import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { countInvoices, listInvoices, ordersToInvoice } from '$lib/modules/auftraege/server/invoices';
import { today } from '$lib/modules/stunden/week';
import type { PageServerLoad } from './$types';

const STATES = ['offen', 'bezahlt', 'entwurf', 'alle'] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requirePermission(locals, 'rechnungen.sehen');
	const asked = url.searchParams.get('stand') as (typeof STATES)[number] | null;
	const state = asked && STATES.includes(asked) ? asked : 'offen';
	const q = url.searchParams.get('q') ?? '';
	const canCreate = can(user.role, 'rechnungen.erstellen');
	const [invoices, counts, ready] = await Promise.all([
		listInvoices({ q, status: state === 'alle' ? '' : state }),
		countInvoices(),
		canCreate ? ordersToInvoice() : Promise.resolve([])
	]);
	return { invoices, counts, ready, filter: { q, state }, canCreate, today: today() };
};
