import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { countInvoices, countListed, invoiceYears, listInvoices, ordersToInvoice } from '$lib/modules/auftraege/server/invoices';
import { today } from '$lib/modules/stunden/week';
import type { PageServerLoad } from './$types';

const STATES = ['offen', 'ueberfaellig', 'bezahlt', 'entwurf', 'alle'] as const;
const PAGE_SIZE = 100;

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requirePermission(locals, 'rechnungen.sehen');
	const asked = url.searchParams.get('stand') as (typeof STATES)[number] | null;
	const state = asked && STATES.includes(asked) ? asked : 'offen';
	const q = url.searchParams.get('q') ?? '';
	const year = /^\d{4}$/.test(url.searchParams.get('jahr') ?? '') ? url.searchParams.get('jahr')! : '';
	const canCreate = can(user.role, 'rechnungen.erstellen');
	const filter = { q, status: state === 'alle' ? '' : state, year };
	const count = await countListed(filter);
	const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
	const page = Math.min(pages, Math.max(1, Math.floor(Number(url.searchParams.get('seite')) || 1)));
	const [invoices, counts, years, ready] = await Promise.all([
		listInvoices(filter, PAGE_SIZE, (page - 1) * PAGE_SIZE),
		countInvoices(),
		invoiceYears(filter),
		canCreate ? ordersToInvoice() : Promise.resolve([])
	]);
	return { invoices, counts, years, ready, filter: { q, state, year }, canCreate, today: today(), page, pageSize: PAGE_SIZE, count };
};
