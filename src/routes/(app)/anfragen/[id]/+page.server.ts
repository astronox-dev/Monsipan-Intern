import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { createCustomer, customerProblem, listCustomers, readCustomer } from '$lib/modules/auftraege/server/customers';
import {
	closeInquiry,
	deleteInquiry,
	inquiryDetail,
	inquiryProblem,
	offerFromInquiry,
	readInquiry,
	setInquiryCustomer,
	setInquiryInProgress,
	updateInquiry
} from '$lib/modules/auftraege/server/inquiries';
import { numberTaken, suggestNumbers } from '$lib/modules/auftraege/server/offers';
import { isValidIsoDate, today } from '$lib/modules/stunden/week';
import type { Actions, PageServerLoad } from './$types';

async function open(id: number, locals: App.Locals) {
	const user = requirePermission(locals, 'anfragen.sehen');
	const inquiry = await inquiryDetail(id);
	if (!inquiry) error(404, 'Anfrage nicht gefunden');
	return { user, inquiry };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user, inquiry } = await open(Number(params.id), locals);
	const canEdit = can(user.role, 'anfragen.bearbeiten');
	const canCreateOffer = !inquiry.offerId && can(user.role, 'angebote.erstellen');
	return {
		inquiry,
		canEdit,
		canDelete: can(user.role, 'anfragen.loeschen'),
		canCreateOffer,
		canSeeOffer: can(user.role, 'angebote.sehen'),
		canAddCustomer: canEdit && can(user.role, 'kunden.erstellen'),
		customers: canEdit || canCreateOffer ? (await listCustomers()).map((c) => ({ id: c.id, name: c.name, city: c.city })) : [],
		suggestion: canCreateOffer ? { ...(await suggestNumbers()), date: today() } : null
	};
};

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.bearbeiten')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const data = readInquiry(await request.formData());
		if (!isValidIsoDate(data.receivedOn)) return fail(400, { message: 'Das Eingangsdatum ist ungültig.' });
		const problem = inquiryProblem(data);
		if (problem) return fail(400, { message: problem });
		await updateInquiry(inquiry.id, data);
		return { saved: true };
	},

	/** Kunden aus der Anfrage anlegen und gleich zuordnen */
	newCustomer: async ({ params, request, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.bearbeiten') || !can(user.role, 'kunden.erstellen')) return fail(403, { customerMessage: 'Dafür fehlt dir die Berechtigung.' });
		const data = readCustomer(await request.formData());
		const problem = customerProblem(data);
		if (problem) return fail(400, { customerMessage: problem });
		const id = await createCustomer(data);
		await setInquiryCustomer(inquiry.id, id);
		return { customerCreated: true };
	},

	/** Angebot aus der Anfrage – Kunde, BV und Ausführungsort gehen mit */
	offer: async ({ params, request, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'angebote.erstellen')) return fail(403, { offerMessage: 'Dafür fehlt dir die Berechtigung.' });
		if (inquiry.offerId) redirect(303, `/angebote/${inquiry.offerId}`);
		const form = await request.formData();
		const number = String(form.get('nummer') ?? '').trim();
		const date = String(form.get('datum') ?? '');
		const customer = Number(form.get('kunde'));
		if (!number) return fail(400, { offerMessage: 'Bitte die Angebotsnummer eintragen.' });
		if (await numberTaken(number)) return fail(400, { offerMessage: `Die Angebotsnummer ${number} gibt es schon.` });
		if (!isValidIsoDate(date)) return fail(400, { offerMessage: 'Das Datum ist ungültig.' });
		const id = await offerFromInquiry(user, inquiry, {
			number,
			projectNumber: String(form.get('projekt') ?? '').trim(),
			date,
			title: String(form.get('titel') ?? '').trim(),
			customerId: Number.isInteger(customer) && customer > 0 ? customer : null
		});
		redirect(303, `/angebote/${id}`);
	},

	/** In Arbeit nehmen (an=1) bzw. zurück auf neu – nur, solange es kein Angebot gibt */
	progress: async ({ params, request, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.bearbeiten')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		if (inquiry.offerId || inquiry.closedAt) return fail(400, { message: 'Mit Angebot oder abgelegt zählt der Stand von dort.' });
		const on = (await request.formData()).get('an') === '1';
		await setInquiryInProgress(inquiry.id, on ? user.id : null);
		return { inProgress: on };
	},

	close: async ({ params, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.bearbeiten')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		await closeInquiry(inquiry.id, true);
		return { closed: true };
	},

	reopen: async ({ params, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.bearbeiten')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		await closeInquiry(inquiry.id, false);
		return { reopened: true };
	},

	delete: async ({ params, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.loeschen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		await deleteInquiry(inquiry.id);
		redirect(303, '/anfragen');
	}
};
