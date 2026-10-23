import { fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { listCustomers } from '$lib/modules/auftraege/server/customers';
import { countOffers, createOffer, listOffers, numberTaken, offerYears } from '$lib/modules/auftraege/server/offers';
import { isValidIsoDate, today } from '$lib/modules/stunden/week';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 100;

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requirePermission(locals, 'angebote.sehen');
	const year = url.searchParams.get('jahr') ?? '';
	const filter = { q: url.searchParams.get('q') ?? '', status: url.searchParams.get('status') ?? '', year: /^[0-9]{4}$/.test(year) ? year : '' };
	const canCreate = can(user.role, 'angebote.erstellen');
	const count = await countOffers(filter);
	const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
	const page = Math.min(pages, Math.max(1, Math.floor(Number(url.searchParams.get('seite')) || 1)));
	const [offers, years, customers] = await Promise.all([
		listOffers(filter, PAGE_SIZE, (page - 1) * PAGE_SIZE),
		offerYears(filter),
		canCreate ? listCustomers() : Promise.resolve([])
	]);
	return {
		offers,
		years,
		page,
		pageSize: PAGE_SIZE,
		count,
		filter,
		canCreate,
		customers: customers.map((c) => ({ id: c.id, name: c.name, city: c.city })),
		// Die Nummer trägt man selbst ein – nur das Datum ist vorausgefüllt
		suggestion: canCreate ? { date: today() } : null
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requirePermission(locals, 'angebote.erstellen');
		const form = await request.formData();
		const number = String(form.get('nummer') ?? '').trim();
		const date = String(form.get('datum') ?? '');
		const customer = Number(form.get('kunde'));
		if (!number) return fail(400, { message: 'Bitte die Angebotsnummer eintragen.' });
		if (await numberTaken(number)) return fail(400, { message: `Die Angebotsnummer ${number} gibt es schon.` });
		if (!isValidIsoDate(date)) return fail(400, { message: 'Das Datum ist ungültig.' });
		const id = await createOffer(user, {
			number,
			projectNumber: '',
			date,
			title: String(form.get('titel') ?? '').trim(),
			customerId: Number.isInteger(customer) && customer > 0 ? customer : null
		});
		redirect(303, `/angebote/${id}`);
	}
};
