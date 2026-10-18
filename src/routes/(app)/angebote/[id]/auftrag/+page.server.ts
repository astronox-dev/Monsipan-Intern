import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { colorOptions } from '$lib/server/options';
import { DocumentError, storeDocument, takeUploads } from '$lib/server/documents';
import { offerDetail } from '$lib/modules/auftraege/server/offers';
import { getCustomer } from '$lib/modules/auftraege/server/customers';
import { activeParties, createOrderFromOffer, insertOrderDocument, orderDetail } from '$lib/modules/auftraege/server/orders';
import { createWorkOrder, prefill, readCreation } from '$lib/modules/auftraege/server/work-orders';
import { notifyOrderAssigned } from '$lib/modules/auftraege/server/notify';
import type { Actions, PageServerLoad } from './$types';

/**
 * Auftrag und Arbeitsauftrag in einem Schritt – aus dem angenommenen Angebot.
 * Gibt es den Auftrag schon, geht es dorthin.
 */
async function open(id: number, locals: App.Locals) {
	const user = requirePermission(locals, 'angebote.sehen');
	if (!can(user.role, 'auftraege.erstellen') || !can(user.role, 'auftraege.bearbeiten')) error(403, 'Auftrag und Arbeitsauftrag legt das Büro an.');
	const offer = await offerDetail(id);
	if (!offer) error(404, 'Angebot nicht gefunden');
	if (offer.order) redirect(303, `/auftraege/${offer.order.id}`);
	if (offer.status !== 'angenommen') redirect(303, `/angebote/${offer.id}`);
	return { user, offer };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user, offer } = await open(Number(params.id), locals);
	const customer = offer.customerId ? await getCustomer(offer.customerId) : null;
	return {
		offer: { id: offer.id, number: offer.number, title: offer.title },
		parties: await activeParties(),
		content: await prefill({
			title: offer.title,
			location: offer.location,
			customerContact: customer?.contact ?? '',
			customerPhone: customer?.phone ?? '',
			lines: offer.lines
		}),
		colors: (await colorOptions()).filter((c) => c.ral).map((c) => ({ ral: c.ral as string, name: c.name })),
		me: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		const form = await request.formData();
		const read = readCreation(form);
		if ('message' in read) return fail(400, { message: read.message });
		// Die Partie ist freiwillig – zuteilen geht auch später, etwa in der Wochenplanung
		const rawParty = String(form.get('partie') ?? '');
		const partyId = rawParty ? Number(rawParty) : null;
		if (partyId !== null && (!Number.isInteger(partyId) || partyId <= 0)) return fail(400, { message: 'Die Partie stimmt nicht.' });
		// Pläne erst prüfen und ablegen – ist eine Datei kein PDF, entsteht nichts. Der Browser
		// lädt sie vorher in Teilen hoch und schickt nur die Kennungen; ohne JavaScript die Dateien.
		const stored: { name: string; sha256: string; size: number }[] = [];
		try {
			stored.push(...takeUploads(user.id, form.getAll('uploads').map(String)));
			for (const file of form.getAll('plaene').filter((f): f is File => f instanceof File && f.size > 0)) {
				stored.push({ name: file.name, ...(await storeDocument(file, null)) });
			}
		} catch (err) {
			if (err instanceof DocumentError) return fail(400, { message: err.message });
			throw err;
		}
		const id = await createOrderFromOffer(offer.id, partyId, String(form.get('hinweis') ?? '').trim(), user.id);
		if (!id) return fail(400, { message: 'Aus diesem Angebot lässt sich (noch) kein Auftrag erstellen.' });
		for (const s of stored) await insertOrderDocument(id, s.name, s, user.id);
		const order = await orderDetail(id);
		// Mit dem Arbeitsauftrag sieht ihn die Partie – und bekommt Bescheid
		if (order && (await createWorkOrder(order, user.id, read.form, read.bl))) notifyOrderAssigned(id, user.id);
		redirect(303, `/auftraege/${id}/arbeitsauftrag`);
	}
};
