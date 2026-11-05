import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { orders } from '$lib/server/db/schema';
import { requirePermission } from '$lib/server/guard';
import { getSettings } from '$lib/server/settings';
import { mayViewOrder } from '$lib/modules/auftraege/server/orders';
import { createInvoice, invoiceDetail, lastInvoiceNumber, readInvoice } from '$lib/modules/auftraege/server/invoices';
import { notifyInvoice } from '$lib/modules/auftraege/server/notify';
import { addDays, daysBetween, isValidIsoDate, today } from '$lib/modules/stunden/week';
import { unitOptions } from '$lib/server/options';
import type { Actions, PageServerLoad } from './$types';

/**
 * Rechnung kopieren – auch eine stornierte, um sie richtig neu auszustellen.
 * Die Kopie ist ein neuer Entwurf zum selben Auftrag: Nummer leer, Datum heute,
 * ohne Tagesberichte (die gehören zur ersten oder sind nach dem Storno wieder frei).
 */
async function open(id: number, locals: App.Locals) {
	const user = requirePermission(locals, 'rechnungen.erstellen');
	const invoice = await invoiceDetail(id);
	if (!invoice) error(404, 'Rechnung nicht gefunden');
	// Stornorechnungen entstehen nur beim Stornieren; ohne Auftrag (Altbestand) gibt es keinen, an dem die Kopie hängt
	if (invoice.kind === 'storno' || !invoice.orderId) redirect(303, `/rechnungen/${invoice.id}`);
	const order = await db.select({ id: orders.id, partyId: orders.partyId }).from(orders).where(eq(orders.id, invoice.orderId)).get();
	if (!order || !mayViewOrder(user, order)) error(404, 'Auftrag nicht gefunden');
	return {
		...invoice,
		kind: invoice.kind as Exclude<typeof invoice.kind, 'storno'>,
		orderId: order.id,
		user
	};
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const invoice = await open(Number(params.id), locals);
	const settings = await getSettings();
	const date = today();
	// Zahlungsziel wie auf der Vorlage, ab heute gerechnet
	const days =
		isValidIsoDate(invoice.date) && isValidIsoDate(invoice.dueDate) ? Math.max(0, daysBetween(invoice.date, invoice.dueDate)) : settings.invoicePaymentDays;
	return {
		source: {
			id: invoice.id,
			number: invoice.number,
			costCenter: invoice.costCenter,
			kind: invoice.kind,
			cancelled: invoice.stage === 'storniert'
		},
		head: {
			number: '',
			kind: invoice.kind,
			state: invoice.state,
			section: invoice.section,
			date,
			dueDate: addDays(date, days),
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
			extraText: invoice.extraText,
			closing: invoice.closing,
			vatRate: invoice.vatRate,
			reverseCharge: invoice.reverseCharge,
			skontoPercent: invoice.skontoPercent,
			skontoDays: invoice.skontoDays,
			discountPercent: invoice.discountPercent,
			discountAmount: invoice.discountAmount
		},
		lines: invoice.lines,
		lastNumber: await lastInvoiceNumber(),
		paymentDays: days,
		units: await unitOptions()
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals }) => {
		const invoice = await open(Number(params.id), locals);
		const data = readInvoice(await request.formData());
		if ('message' in data) return fail(400, { message: data.message });
		const result = await createInvoice(invoice.user, invoice.orderId, data, {}, []);
		if (typeof result !== 'number') return fail(400, { message: result.message });
		notifyInvoice('rechnung.erstellt', result, invoice.user.id);
		redirect(303, `/rechnungen/${result}`);
	}
};
