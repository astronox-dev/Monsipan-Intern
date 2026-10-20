import { error, fail, redirect } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { mayViewOrder } from '$lib/modules/auftraege/server/orders';
import { createInvoice, draftLines, invoiceDraft, readInvoice, readMapping, readReports } from '$lib/modules/auftraege/server/invoices';
import { notifyInvoice } from '$lib/modules/auftraege/server/notify';
import { unitOptions } from '$lib/server/options';
import type { Actions, PageServerLoad } from './$types';

/** Auftrag laden und prüfen: sichtbar – eine Rechnung (als Entwurf) geht aus jedem Stand */
async function open(url: URL, locals: App.Locals) {
	const user = requirePermission(locals, 'rechnungen.erstellen');
	const orderId = Number(url.searchParams.get('auftrag'));
	if (!Number.isInteger(orderId) || orderId <= 0) redirect(303, '/rechnungen');
	const draft = await invoiceDraft(orderId);
	if (!draft || !mayViewOrder(user, draft.order)) error(404, 'Auftrag nicht gefunden');
	return { user, draft };
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const { draft } = await open(url, locals);
	return {
		order: draft.order,
		head: draft.head,
		paymentDays: draft.paymentDays,
		units: await unitOptions(),
		previous: draft.previous,
		// Ohne neue geprüfte Berichte: Mengen selbst prüfen
		notice: draft.notice,
		mapping: { columns: draft.columns, priced: draft.lines, initial: draft.mapping },
		selection: {
			reports: draft.reports,
			pending: draft.pending,
			previous: draft.previous.length,
			closed: draft.order.status === 'abgeschlossen',
			flatBilled: draft.flatBilled
		},
		lines: draftLines(draft),
		hasPrices: draft.lines.some((l) => l.unitPrice != null)
	};
};

export const actions: Actions = {
	default: async ({ url, request, locals }) => {
		const { user, draft } = await open(url, locals);
		const form = await request.formData();
		const data = readInvoice(form);
		if ('message' in data) return fail(400, { message: data.message });
		const mapping = readMapping(
			form,
			draft.columns.map((c) => c.key)
		);
		const result = await createInvoice(user, draft.order.id, data, mapping, readReports(form));
		if (typeof result !== 'number') return fail(400, { message: result.message });
		notifyInvoice('rechnung.erstellt', result, user.id);
		redirect(303, `/rechnungen/${result}`);
	}
};
