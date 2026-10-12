import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import { DocumentError } from '$lib/server/documents';
import { ORDER_STATUS, type OrderStatus } from '$lib/server/db/schema';
import {
	activeParties,
	addOrderDocument,
	deleteOrder,
	deleteOrderDocument,
	mayDeleteOrder,
	mayViewOrder,
	maySetOrderStatus,
	orderDetail,
	setOrderStatus,
	updateOrder
} from '$lib/modules/auftraege/server/orders';
import { listReports } from '$lib/modules/tagesberichte/server/reports';
import { invoiceBlocker, invoicesForOrder, unbilledReports } from '$lib/modules/auftraege/server/invoices';
import { reportCount } from '$lib/modules/auftraege/server/summary';
import { notifyOrderAssigned, notifyOrderDocuments, notifyOrderStatus } from '$lib/modules/auftraege/server/notify';
import { titleFromFileName } from '$lib/documents';
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
	const canManage = can(user.role, 'auftraege.bearbeiten');
	const seesInvoices = can(user.role, 'rechnungen.sehen');
	const [invoices, unbilled] = await Promise.all([invoicesForOrder(order.id), unbilledReports(order.id)]);
	return {
		order,
		canStatus: maySetOrderStatus(user, order),
		canReset: can(user.role, 'auftraege.status.zuruecksetzen'),
		canManage,
		canSeeOffer: can(user.role, 'angebote.sehen') && order.offerId != null,
		parties: canManage ? await activeParties() : [],
		// Tagesberichte zu diesem Auftrag – so weit dieser Benutzer sie sieht
		reports: await listReports(user, { orderId: order.id }),
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
		await setOrderStatus(order.id, status, user.id);
		if (status !== order.status) notifyOrderStatus(order.id, status, user.id);
		return { status };
	},

	update: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		if (!can(user.role, 'auftraege.bearbeiten')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		const partyId = Number(form.get('partie'));
		if (!Number.isInteger(partyId) || partyId <= 0) return fail(400, { message: 'Bitte eine Partie wählen.' });
		await updateOrder(order.id, {
			partyId,
			location: String(form.get('ort') ?? '').trim(),
			note: String(form.get('hinweis') ?? '').trim()
		});
		// Neue Partie: deren Partieführer erfährt es
		if (partyId !== order.partyId) notifyOrderAssigned(order.id, user.id);
		return { updated: true };
	},

	/** Pläne und andere PDFs – mehrere auf einmal */
	upload: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		if (!can(user.role, 'auftraege.bearbeiten')) return fail(403, { docError: 'Dafür fehlt dir die Berechtigung.' });
		const files = (await request.formData()).getAll('dateien').filter((f): f is File => f instanceof File && f.size > 0);
		if (!files.length) return fail(400, { docError: 'Bitte eine oder mehrere PDF-Dateien auswählen.' });
		let added = 0;
		const titles: string[] = [];
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

	deleteDocument: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		if (!can(user.role, 'auftraege.bearbeiten')) return fail(403, { docError: 'Dafür fehlt dir die Berechtigung.' });
		const id = Number((await request.formData()).get('dokument'));
		if (!Number.isInteger(id)) return fail(400, { docError: 'Unterlage fehlt.' });
		await deleteOrderDocument(order.id, id);
		return { documentRemoved: true };
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
