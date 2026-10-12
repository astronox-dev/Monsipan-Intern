/**
 * Angebot für den Kunden: ansehen, mit Name und Unterschrift annehmen oder
 * Änderungen wünschen, danach als PDF laden. Ohne Anmeldung – der Link selbst
 * ist der Schlüssel (128 Bit Zufall). Interne Angaben kommen nicht mit.
 */
import { error, fail } from '@sveltejs/kit';
import { isRateLimited, registerFailure } from '$lib/server/auth';
import { isValidSignature } from '$lib/modules/stunden/signature';
import { customerAccept, customerRequestChange, offerByToken, type OfferDetail } from '$lib/modules/auftraege/server/offers';
import { notifyOffer } from '$lib/modules/auftraege/server/notify';
import type { Actions, PageServerLoad } from './$types';

/** Nur, was auch im PDF steht */
function forCustomer(o: OfferDetail) {
	return {
		number: o.number,
		projectNumber: o.projectNumber,
		date: o.date,
		title: o.title,
		location: o.location,
		customerName: o.customerName,
		customerAddition: o.customerAddition,
		customerStreet: o.customerStreet,
		customerZip: o.customerZip,
		customerCity: o.customerCity,
		customerUid: o.customerUid,
		intro: o.intro,
		closing: o.closing,
		vatRate: o.vatRate,
		lines: o.lines.map((l) => ({ id: l.id, kind: l.kind, text: l.text, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice })),
		acceptedName: o.acceptedName,
		acceptedSignature: o.acceptedSignature,
		acceptedAt: o.acceptedAt
	};
}

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
	const offer = await offerByToken(params.token);
	if (!offer) error(404, 'Dieses Angebot gibt es nicht – bitte den Link prüfen.');
	// In Arbeit heißt: wird gerade überarbeitet – dann nichts zeigen
	const ready = offer.status !== 'entwurf';
	return {
		token: params.token,
		number: offer.number,
		status: offer.status,
		requestedAt: offer.status === 'aenderung' ? offer.changeRequestedAt : null,
		offer: ready ? forCustomer(offer) : null
	};
};

function readName(form: FormData) {
	return String(form.get('name') ?? '')
		.trim()
		.replace(/\s+/g, ' ');
}

export const actions: Actions = {
	accept: async ({ params, request, url }) => {
		const key = `angebot:${params.token}`;
		if (isRateLimited(key, 10)) return fail(429, { message: 'Zu viele Versuche – bitte in einigen Minuten erneut.' });
		const offer = await offerByToken(params.token);
		if (!offer) error(404, 'Dieses Angebot gibt es nicht – bitte den Link prüfen.');
		if (offer.status === 'angenommen') return fail(400, { message: 'Dieses Angebot ist bereits angenommen.' });
		if (offer.status !== 'freigegeben') return fail(400, { message: 'Dieses Angebot wird gerade überarbeitet – bitte später erneut öffnen.' });

		const form = await request.formData();
		const name = readName(form);
		const signature = String(form.get('unterschrift') ?? '').trim();
		if (name.length < 2 || name.length > 120) {
			registerFailure(key);
			return fail(400, { message: 'Bitte tragen Sie Ihren Namen ein.', name });
		}
		if (!isValidSignature(signature)) {
			registerFailure(key);
			return fail(400, { message: 'Bitte unterschreiben Sie im Feld – die Unterschrift fehlt oder war nicht lesbar.', name });
		}
		if (!(await customerAccept(offer.id, name, signature))) {
			return fail(409, { message: 'Das Angebot wurde inzwischen geändert – bitte die Seite neu laden.', name });
		}
		// Ans Büro: Glocke, Push und Info-Mail – die Mail immer auch an die Person, die es angelegt bzw. freigegeben hat
		notifyOffer('angebot.angenommen', offer.id, { name, fromCustomer: true, origin: url.origin });
		return { accepted: true };
	},

	change: async ({ params, request, url }) => {
		const key = `angebot:${params.token}`;
		if (isRateLimited(key, 10)) return fail(429, { changeMessage: 'Zu viele Versuche – bitte in einigen Minuten erneut.' });
		const offer = await offerByToken(params.token);
		if (!offer) error(404, 'Dieses Angebot gibt es nicht – bitte den Link prüfen.');
		if (offer.status !== 'freigegeben') return fail(400, { changeMessage: 'Zu diesem Angebot ist gerade keine Rückmeldung möglich.' });

		const form = await request.formData();
		const name = readName(form);
		const message = String(form.get('nachricht') ?? '')
			.replace(/\r\n/g, '\n')
			.trim();
		if (name.length < 2 || name.length > 120) {
			registerFailure(key);
			return fail(400, { changeMessage: 'Bitte tragen Sie Ihren Namen ein.', name, text: message });
		}
		if (message.length < 3 || message.length > 4000) {
			return fail(400, { changeMessage: 'Bitte beschreiben Sie kurz, was geändert werden soll.', name, text: message });
		}
		if (!(await customerRequestChange(offer.id, name, message))) {
			return fail(409, { changeMessage: 'Das Angebot wurde inzwischen geändert – bitte die Seite neu laden.', name, text: message });
		}
		notifyOffer('angebot.aenderung', offer.id, { name, message, fromCustomer: true, origin: url.origin });
		return { changed: true };
	}
};
