import { error, fail, redirect } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { getSettings } from '$lib/server/settings';
import { invoiceDetail, readInvoice, saveInvoice } from '$lib/modules/auftraege/server/invoices';
import { audit } from '$lib/modules/auftraege/server/signatur/audit';
import { unitOptions } from '$lib/server/options';
import type { Actions, PageServerLoad } from './$types';

/** Nur offene Entwürfe lassen sich ändern – ausgestellte sind gesperrt */
async function open(id: number, locals: App.Locals) {
	const user = requirePermission(locals, 'rechnungen.bearbeiten');
	const invoice = await invoiceDetail(id);
	if (!invoice) error(404, 'Rechnung nicht gefunden');
	// Stornorechnungen entstehen fertig aus der stornierten Rechnung – sie werden nicht bearbeitet
	if (invoice.status !== 'offen' || invoice.stage !== 'entwurf' || invoice.kind === 'storno') redirect(303, `/rechnungen/${invoice.id}`);
	return { ...invoice, kind: invoice.kind as Exclude<typeof invoice.kind, 'storno'>, user };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const invoice = await open(Number(params.id), locals);
	const settings = await getSettings();
	return {
		invoice: { id: invoice.id, number: invoice.number, costCenter: invoice.costCenter, title: invoice.title, kind: invoice.kind },
		head: {
			kind: invoice.kind,
			state: invoice.state,
			section: invoice.section,
			date: invoice.date,
			dueDate: invoice.dueDate,
			serviceFrom: invoice.serviceFrom ?? '',
			serviceTo: invoice.serviceTo ?? '',
			title: invoice.title,
			location: invoice.location,
			costCenter: invoice.costCenter,
			customerName: invoice.customerName,
			customerAddition: invoice.customerAddition,
			customerStreet: invoice.customerStreet,
			customerZip: invoice.customerZip,
			customerCity: invoice.customerCity,
			customerUid: invoice.customerUid,
			intro: invoice.intro,
			closing: invoice.closing,
			vatRate: invoice.vatRate,
			reverseCharge: invoice.reverseCharge
		},
		lines: invoice.lines,
		paymentDays: settings.invoicePaymentDays,
		units: await unitOptions()
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals }) => {
		const invoice = await open(Number(params.id), locals);
		const data = readInvoice(await request.formData());
		if ('message' in data) return fail(400, { message: data.message });
		if (!(await saveInvoice(invoice.id, data))) return fail(400, { message: 'Die Rechnung ist inzwischen ausgestellt oder bezahlt und lässt sich nicht mehr ändern.' });
		await audit({ invoiceId: invoice.id, invoiceNumber: invoice.number, user: invoice.user, action: 'geaendert' });
		redirect(303, `/rechnungen/${invoice.id}`);
	}
};
