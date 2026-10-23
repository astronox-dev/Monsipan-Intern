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
import { numberTaken } from '$lib/modules/auftraege/server/offers';
import { isValidIsoDate, today } from '$lib/modules/stunden/week';
import { DocumentError, storeDocument, takeUploads } from '$lib/server/documents';
import {
	addInquiryDocuments,
	caseDocuments,
	casePhotos,
	chainOfInquiry,
	findCaseDocument,
	parseRef,
	removeCaseDocument,
	setCaseDocumentForCrew
} from '$lib/modules/auftraege/server/case-files';
import { notifyOrderDocuments } from '$lib/modules/auftraege/server/notify';
import { titleFromFileName } from '$lib/documents';
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
	const chain = await chainOfInquiry(inquiry.id);
	return {
		inquiry,
		canEdit,
		canDelete: can(user.role, 'anfragen.loeschen'),
		canCreateOffer,
		canSeeOffer: can(user.role, 'angebote.sehen'),
		canAddCustomer: canEdit && can(user.role, 'kunden.erstellen'),
		customers: canEdit || canCreateOffer ? (await listCustomers()).map((c) => ({ id: c.id, name: c.name, city: c.city })) : [],
		// Die Nummer trägt man selbst ein – nur das Datum ist vorausgefüllt
		suggestion: canCreateOffer ? { date: today() } : null,
		// Pläne und Fotos des ganzen Vorgangs – auch was später am Angebot oder Auftrag dazukam
		documents: await caseDocuments(chain),
		photos: await casePhotos(chain, 'anfrage')
	};
};

export const actions: Actions = {
	/** PDFs – der Browser lädt sie vorher in Teilen hoch und schickt nur die Kennungen */
	docUpload: async ({ params, request, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.bearbeiten')) return fail(403, { docError: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		let files: { name: string; sha256: string; size: number }[];
		try {
			files = takeUploads(user.id, form.getAll('uploads').map(String));
			// Ohne JavaScript kommen die Dateien selbst
			for (const file of form.getAll('dateien').filter((f): f is File => f instanceof File && f.size > 0)) {
				files.push({ name: file.name, ...(await storeDocument(file, null)) });
			}
		} catch (err) {
			if (err instanceof DocumentError) return fail(400, { docError: err.message });
			throw err;
		}
		if (!files.length) return fail(400, { docError: 'Bitte eine oder mehrere PDF-Dateien auswählen.' });
		const forCrew = form.get('partie') === 'on';
		await addInquiryDocuments(inquiry.id, files, user.id, forCrew);
		const chain = await chainOfInquiry(inquiry.id);
		if (forCrew && chain.orderId) notifyOrderDocuments(chain.orderId, files.map((f) => titleFromFileName(f.name) || f.name), user.id);
		return { added: files.length };
	},

	/** Aus dem ganzen Vorgang – auch PDFs, die am Angebot oder Auftrag hängen */
	docDelete: async ({ params, request, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.bearbeiten')) return fail(403, { docError: 'Dafür fehlt dir die Berechtigung.' });
		const ref = parseRef(String((await request.formData()).get('dokument') ?? ''), 'anfrage');
		if (!ref) return fail(400, { docError: 'Unterlage fehlt.' });
		await removeCaseDocument(await chainOfInquiry(inquiry.id), ref);
		return { documentRemoved: true };
	},

	docCrew: async ({ params, request, locals }) => {
		const { user, inquiry } = await open(Number(params.id), locals);
		if (!can(user.role, 'anfragen.bearbeiten')) return fail(403, { docError: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		const ref = parseRef(String(form.get('dokument') ?? ''), 'anfrage');
		if (!ref) return fail(400, { docError: 'Unterlage fehlt.' });
		const forCrew = form.get('an') === '1';
		const chain = await chainOfInquiry(inquiry.id);
		const doc = await findCaseDocument(chain, ref);
		if (!doc) return fail(404, { docError: 'Unterlage nicht gefunden.' });
		await setCaseDocumentForCrew(chain, ref, forCrew);
		// Gibt es den Auftrag schon, bekommt die Partie Bescheid
		if (forCrew && !doc.forCrew && chain.orderId) notifyOrderDocuments(chain.orderId, [doc.title], user.id);
		return { forCrew };
	},

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
			projectNumber: '',
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
