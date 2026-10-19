import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import { DocumentError, takeUploads } from '$lib/server/documents';
import { ORDER_STATUS, type OrderStatus } from '$lib/server/db/schema';
import {
	activeParties,
	addOrderDocument,
	deleteOrder,
	insertOrderDocument,
	mayDeleteOrder,
	mayViewOrder,
	maySetOrderStatus,
	orderDetail,
	seesWholeOrder,
	setOrderStatus,
	updateOrder
} from '$lib/modules/auftraege/server/orders';
import { listReports } from '$lib/modules/tagesberichte/server/reports';
import { invoiceBlocker, invoicesForOrder, unbilledReports } from '$lib/modules/auftraege/server/invoices';
import { reportCount } from '$lib/modules/auftraege/server/summary';
import { notifyOrderAssigned, notifyOrderDocuments, notifyOrderStatus } from '$lib/modules/auftraege/server/notify';
import { titleFromFileName } from '$lib/documents';
import { closeBlocker, hasWorkOrder, workOrderSummary } from '$lib/modules/auftraege/server/work-orders';
import { caseDocuments, casePhotos, chainFor, findCaseDocument, parseRef, removeCaseDocument, setCaseDocumentForCrew } from '$lib/modules/auftraege/server/case-files';
import { syncWorkOrderPlan } from '$lib/modules/planung/server/plan';
import type { Actions, PageServerLoad } from './$types';

async function open(id: number, locals: App.Locals) {
	const user = requireUser(locals);
	const order = await orderDetail(id);
	// Fremde Aufträge gibt es für die Partie nicht – auch nicht als „verboten"
	if (!order || !mayViewOrder(user, order)) error(404, 'Auftrag nicht gefunden');
	return { user, order };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user, order } = await open(Number(params.id), locals);
	// Die Partie sieht nicht den ganzen Auftrag, nur den Arbeitsauftrag
	if (!seesWholeOrder(user)) {
		if (await hasWorkOrder(order.id)) redirect(303, `/auftraege/${order.id}/arbeitsauftrag`);
		error(404, 'Zu diesem Auftrag gibt es noch keinen Arbeitsauftrag.');
	}
	const canManage = can(user.role, 'auftraege.bearbeiten');
	const seesInvoices = can(user.role, 'rechnungen.sehen');
	const [invoices, unbilled, chain] = await Promise.all([invoicesForOrder(order.id), unbilledReports(order.id), chainFor(order)]);
	return {
		order,
		// Pläne und Fotos des ganzen Vorgangs – von Anfrage, Angebot und Auftrag; „Nur Büro" sieht, wer Angebote sieht
		documents: await caseDocuments(chain, { crewOnly: !can(user.role, 'angebote.sehen') }),
		photos: await casePhotos(chain, 'auftrag'),
		// Abschließen erst mit abgehakter Vorarbeiter-Checkliste
		closeBlocker: await closeBlocker(order.id),
		canStatus: maySetOrderStatus(user, order),
		canReset: can(user.role, 'auftraege.status.zuruecksetzen'),
		canManage,
		canSeeOffer: can(user.role, 'angebote.sehen') && order.offerId != null,
		parties: canManage ? await activeParties() : [],
		// Tagesberichte zu diesem Auftrag – so weit dieser Benutzer sie sieht
		reports: await listReports(user, { orderId: order.id }),
		// Arbeitsauftrag nach dem Vordruck – anlegen darf das Büro
		workOrder: await workOrderSummary(order.id),
		canCreateReport: can(user.role, 'tagesberichte.erstellen') && order.status !== 'abgeschlossen',
		// Mit Rechnung bleibt der Auftrag – sonst fehlt der Rechnung ihr Bezug
		canDelete: mayDeleteOrder(user, order) && !invoices.length,
		hasInvoice: invoices.length > 0,
		/** Summenblatt: ab zwei Tagesberichten, für alle, die Auftrag und Berichte sehen */
		reportCount: can(user.role, 'tagesberichte.sehen') ? await reportCount(order.id) : 0,
		// Rechnung über alles oder Teilrechnungen – jeder geprüfte Bericht einmal
		invoices: seesInvoices ? invoices : [],
		unbilled: seesInvoices ? unbilled : 0,
		// Stornierte Rechnungen und Stornorechnungen zählen nicht – danach geht eine neue (Korrektur-)Rechnung
		canCreateInvoice:
			can(user.role, 'rechnungen.erstellen') &&
			!invoiceBlocker({ status: order.status, previous: invoices.filter((i) => i.stage !== 'storniert' && i.kind !== 'storno').length, available: unbilled })
	};
};

export const actions: Actions = {
	/** Partie: in Arbeit bzw. abgeschlossen – zurück auf „erstellt" nur das Büro */
	status: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		const status = String((await request.formData()).get('status') ?? '') as OrderStatus;
		if (!ORDER_STATUS.includes(status)) return fail(400, { message: 'Unbekannter Stand' });
		if (status !== 'erstellt' && !maySetOrderStatus(user, order)) return fail(403, { message: 'Den Stand setzt die Partie, der der Auftrag gehört.' });
		if (status === 'erstellt' && !can(user.role, 'auftraege.status.zuruecksetzen')) return fail(403, { message: 'Zurücksetzen darfst du nicht.' });
		if (status === 'abgeschlossen' && order.status !== 'abgeschlossen') {
			const blocker = await closeBlocker(order.id);
			if (blocker) return fail(400, { message: blocker });
		}
		await setOrderStatus(order.id, status, user.id);
		if (status !== order.status) notifyOrderStatus(order.id, status, user.id);
		return { status };
	},

	update: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		if (!can(user.role, 'auftraege.bearbeiten')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		const rawParty = String(form.get('partie') ?? '');
		const partyId = rawParty ? Number(rawParty) : null;
		if (partyId !== null && (!Number.isInteger(partyId) || partyId <= 0)) return fail(400, { message: 'Die Partie stimmt nicht.' });
		await updateOrder(order.id, {
			partyId,
			location: String(form.get('ort') ?? '').trim(),
			note: String(form.get('hinweis') ?? '').trim()
		});
		// Neue Partie: deren Partieführer erfährt es (ohne Partie niemand)
		if (partyId !== null && partyId !== order.partyId) notifyOrderAssigned(order.id, user.id);
		// Der Termin aus dem Arbeitsauftrag zieht in der Wochenplanung zur neuen Partie mit
		const planned = partyId !== order.partyId ? await syncWorkOrderPlan(order.id, user.id) : null;
		return { updated: true, planned };
	},

	/**
	 * Pläne und andere PDFs – mehrere auf einmal, ohne Größengrenze. Der Browser
	 * lädt sie vorher in Teilen hoch und schickt nur die Kennungen (`uploads`);
	 * ohne JavaScript kommen die Dateien selbst (`dateien`).
	 */
	docUpload: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		if (!can(user.role, 'auftraege.bearbeiten')) return fail(403, { docError: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		const files = form.getAll('dateien').filter((f): f is File => f instanceof File && f.size > 0);
		const uploadIds = form.getAll('uploads').map(String);
		if (!files.length && !uploadIds.length) return fail(400, { docError: 'Bitte eine oder mehrere PDF-Dateien auswählen.' });
		let added = 0;
		const titles: string[] = [];
		let uploaded: ReturnType<typeof takeUploads>;
		try {
			uploaded = takeUploads(user.id, uploadIds);
		} catch (err) {
			if (err instanceof DocumentError) return fail(400, { docError: err.message, added });
			throw err;
		}
		for (const u of uploaded) {
			await insertOrderDocument(order.id, u.name, u, user.id);
			added++;
			titles.push(titleFromFileName(u.name) || u.name);
		}
		for (const file of files) {
			try {
				await addOrderDocument(order.id, file, user.id);
				added++;
				titles.push(titleFromFileName(file.name) || file.name);
			} catch (err) {
				if (err instanceof DocumentError) {
					notifyOrderDocuments(order.id, titles, user.id);
					return fail(400, { docError: `${file.name}: ${err.message}`, added });
				}
				throw err;
			}
		}
		notifyOrderDocuments(order.id, titles, user.id);
		return { added };
	},

	/** Aus dem ganzen Vorgang – auch PDFs, die an der Anfrage oder am Angebot hängen */
	docDelete: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		if (!can(user.role, 'auftraege.bearbeiten')) return fail(403, { docError: 'Dafür fehlt dir die Berechtigung.' });
		const ref = parseRef(String((await request.formData()).get('dokument') ?? ''), 'auftrag');
		if (!ref) return fail(400, { docError: 'Unterlage fehlt.' });
		await removeCaseDocument(await chainFor(order), ref);
		return { documentRemoved: true };
	},

	/** PDF von Anfrage oder Angebot für die Partie freigeben bzw. wieder nur fürs Büro */
	docCrew: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		if (!can(user.role, 'auftraege.bearbeiten')) return fail(403, { docError: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		const chain = await chainFor(order);
		const ref = parseRef(String(form.get('dokument') ?? ''), 'auftrag');
		const doc = await findCaseDocument(chain, ref);
		if (!doc) return fail(404, { docError: 'Unterlage nicht gefunden.' });
		const forCrew = form.get('an') === '1';
		await setCaseDocumentForCrew(chain, ref, forCrew);
		if (forCrew && !doc.forCrew) notifyOrderDocuments(order.id, [doc.title], user.id);
		return { forCrew };
	},

	delete: async ({ params, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		if (!mayDeleteOrder(user, order)) return fail(403, { message: 'Diesen Auftrag darfst du nicht löschen.' });
		if ((await invoicesForOrder(order.id)).length) return fail(400, { message: 'Zu diesem Auftrag gibt es eine Rechnung – er bleibt deshalb bestehen.' });
		await deleteOrder(order.id);
		// Zurück zum Angebot, wenn man es sieht – sonst zur Liste
		redirect(303, order.offerId && can(user.role, 'angebote.sehen') ? `/angebote/${order.offerId}` : '/auftraege');
	}
};
