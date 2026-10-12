import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { customerOfferMail, isMailConfigured, sendMail } from '$lib/server/mail';
import { createCustomer, customerProblem, getCustomer, listCustomers, readCustomer } from '$lib/modules/auftraege/server/customers';
import {
	acceptInternally,
	deleteOffer,
	mayDeleteOffer,
	ensureOfferToken,
	markOfferLinkSent,
	mayEditOffer,
	numberTaken,
	offerDetail,
	offerLinkReady,
	releaseOffer,
	releaseProblem,
	reopenAccepted,
	saveOffer,
	withdrawOffer,
	type SaveOffer
} from '$lib/modules/auftraege/server/offers';
import { inquiryForOffer } from '$lib/modules/auftraege/server/inquiries';
import { activeParties, createOrderFromOffer, insertOrderDocument, mayDeleteOrder } from '$lib/modules/auftraege/server/orders';
import { DocumentError, storeDocument, takeUploads } from '$lib/server/documents';
import { isValidIsoDate } from '$lib/modules/stunden/week';
import { parseAmount } from '$lib/modules/auftraege/offer';
import { notifyOffer, notifyOrderAssigned } from '$lib/modules/auftraege/server/notify';
import type { Actions, PageServerLoad } from './$types';

async function open(id: number, locals: App.Locals) {
	const user = requirePermission(locals, 'angebote.sehen');
	const offer = await offerDetail(id);
	if (!offer) error(404, 'Angebot nicht gefunden');
	return { user, offer };
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const { user, offer } = await open(Number(params.id), locals);
	const editable = mayEditOffer(user, offer);
	const canLink = offerLinkReady(offer.status) && can(user.role, 'angebote.freigeben');
	const canCreateOrder = offer.status === 'angenommen' && !offer.order && can(user.role, 'auftraege.erstellen');
	return {
		offer,
		editable,
		customers: editable ? await listCustomers() : [],
		canAddCustomer: editable && can(user.role, 'kunden.erstellen'),
		canRelease: offer.status === 'entwurf' && can(user.role, 'angebote.freigeben'),
		canWithdraw: (offer.status === 'freigegeben' || offer.status === 'aenderung') && can(user.role, 'angebote.bearbeiten'),
		canAccept: (offer.status === 'freigegeben' || offer.status === 'aenderung') && can(user.role, 'angebote.annehmen'),
		canReopen: offer.status === 'angenommen' && !offer.order && can(user.role, 'angebote.oeffnen.angenommen'),
		canDelete: mayDeleteOffer(user, offer),
		// Den Auftrag gleich mitlöschen darf, wer ihn auch einzeln löschen dürfte
		canDeleteOrder: !!offer.order && mayDeleteOrder(user, offer.order),
		canLink,
		canCreateOrder,
		parties: canCreateOrder ? await activeParties() : [],
		mailConfigured: isMailConfigured(),
		// Die E-Mail der Anfrage, aus der das Angebot entstand
		inquiry: can(user.role, 'anfragen.sehen') ? ((await inquiryForOffer(offer.id)) ?? null) : null,
		customerUrl: canLink && offer.customerToken ? `${url.origin}/angebot/${offer.customerToken}` : null
	};
};

/**
 * Formular auslesen. Zeilen kommen als z.<laufende Nummer>.* – so bleiben
 * Überschriften (ohne Menge und Preis) und Positionen in ihrer Reihenfolge.
 */
function readOffer(form: FormData): SaveOffer | { message: string } {
	const s = (k: string) => String(form.get(k) ?? '');
	const date = s('datum');
	if (!isValidIsoDate(date)) return { message: 'Das Datum ist ungültig.' };
	const number = s('nummer').trim();
	if (!number) return { message: 'Bitte die Angebotsnummer eintragen.' };
	const vat = parseAmount(s('ust'));
	if (vat == null || vat < 0 || vat > 100) return { message: 'Die Umsatzsteuer stimmt nicht.' };
	const customer = Number(s('kunde'));

	const indexes = new Set<number>();
	for (const key of form.keys()) {
		const m = /^z\.(\d+)\.art$/.exec(key);
		if (m) indexes.add(Number(m[1]));
	}
	const lines = [...indexes]
		.sort((a, b) => a - b)
		.map((i) => ({
			kind: s(`z.${i}.art`) === 'titel' ? ('titel' as const) : ('position' as const),
			text: s(`z.${i}.text`),
			quantity: s(`z.${i}.menge`),
			unit: s(`z.${i}.einheit`),
			unitPrice: s(`z.${i}.preis`)
		}));
	for (const [i, l] of lines.entries()) {
		if (l.kind === 'titel') continue;
		if (l.quantity.trim() && parseAmount(l.quantity) == null) return { message: `Die Menge in Zeile ${i + 1} ist keine Zahl.` };
		if (l.unitPrice.trim() && parseAmount(l.unitPrice) == null) return { message: `Der Einheitspreis in Zeile ${i + 1} ist keine Zahl.` };
	}

	return {
		head: {
			number,
			projectNumber: s('projekt').trim(),
			date,
			title: s('titel').trim(),
			location: s('ort').trim(),
			customerId: Number.isInteger(customer) && customer > 0 ? customer : null,
			customerName: s('k_name').trim(),
			customerAddition: s('k_zusatz').trim(),
			customerStreet: s('k_strasse').trim(),
			customerZip: s('k_plz').trim(),
			customerCity: s('k_ort').trim(),
			customerUid: s('k_uid').trim(),
			intro: s('einleitung').replace(/\r\n/g, '\n').trimEnd(),
			closing: s('schluss').replace(/\r\n/g, '\n').trimEnd(),
			vatRate: Math.round(vat * 100) / 100
		},
		lines
	};
}

/** Speichern, wenn das Formular mitkam und das Angebot änderbar ist – sonst null */
async function saveFrom(form: FormData, offer: { id: number }) {
	const data = readOffer(form);
	if ('message' in data) return fail(400, { message: data.message });
	if (await numberTaken(data.head.number, offer.id)) return fail(400, { message: `Die Angebotsnummer ${data.head.number} gibt es schon.` });
	await saveOffer(offer.id, data);
	return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!mayEditOffer(user, offer)) return fail(403, { message: 'Dieses Angebot ist nicht (mehr) änderbar.' });
		const invalid = await saveFrom(await request.formData(), offer);
		return invalid ?? { saved: true };
	},

	/** Freigeben – was im Formular steht, wird vorher gespeichert */
	release: async ({ params, request, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!can(user.role, 'angebote.freigeben')) return fail(403, { message: 'Freigeben darf nur, wer Angebote freigeben darf.' });
		if (offer.status !== 'entwurf') return fail(400, { message: 'Dieses Angebot ist bereits freigegeben.' });
		const form = await request.formData();
		if (mayEditOffer(user, offer) && form.has('datum')) {
			const invalid = await saveFrom(form, offer);
			if (invalid) return invalid;
		}
		const saved = await offerDetail(offer.id);
		const problem = saved && releaseProblem(saved);
		if (problem) return fail(400, { message: problem });
		await releaseOffer(offer.id, user.id);
		notifyOffer('angebot.freigegeben', offer.id, { actorId: user.id });
		return { released: true };
	},

	/** Zurück in Arbeit – zum Überarbeiten, etwa nach einem Änderungswunsch */
	withdraw: async ({ params, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!can(user.role, 'angebote.bearbeiten')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		await withdrawOffer(offer.id);
		return { withdrawn: true };
	},

	/** Intern als angenommen markieren – der Kunde hat anders zugesagt */
	accept: async ({ params, request, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!can(user.role, 'angebote.annehmen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const name = String((await request.formData()).get('name') ?? '');
		if (!(await acceptInternally(offer.id, user.id, name))) return fail(400, { message: 'Angenommen werden kann nur ein ausstehendes Angebot.' });
		notifyOffer('angebot.angenommen', offer.id, { actorId: user.id, name: name.trim() || undefined });
		return { accepted: true };
	},

	reopen: async ({ params, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!can(user.role, 'angebote.oeffnen.angenommen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		if (!(await reopenAccepted(offer.id))) return fail(400, { message: 'Zu diesem Angebot gibt es schon einen Auftrag.' });
		return { reopened: true };
	},

	delete: async ({ params, request, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!mayDeleteOffer(user, offer)) return fail(403, { message: 'Dieses Angebot darfst du nicht löschen.' });
		const withOrder = (await request.formData()).get('auftrag') === 'ja';
		if (withOrder && offer.order && !mayDeleteOrder(user, offer.order)) return fail(403, { message: 'Den Auftrag darfst du nicht löschen.' });
		await deleteOffer(offer.id, withOrder);
		redirect(303, '/angebote');
	},

	/** Neuer Kunde direkt aus dem Angebot – er wird gleich ausgewählt */
	newCustomer: async ({ params, request, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!mayEditOffer(user, offer) || !can(user.role, 'kunden.erstellen')) return fail(403, { customerMessage: 'Dafür fehlt dir die Berechtigung.' });
		const data = readCustomer(await request.formData());
		const problem = customerProblem(data);
		if (problem) return fail(400, { customerMessage: problem });
		const id = await createCustomer(data);
		return { customer: await getCustomer(id) };
	},

	link: async ({ params, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!offerLinkReady(offer.status) || !can(user.role, 'angebote.freigeben')) return fail(403, { message: 'Den Link gibt es erst nach der Freigabe.' });
		await ensureOfferToken(offer.id);
		return { linked: true };
	},

	sendLink: async ({ params, request, locals, url }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!offerLinkReady(offer.status) || !can(user.role, 'angebote.freigeben')) return fail(403, { message: 'Den Link gibt es erst nach der Freigabe.' });
		const email = String((await request.formData()).get('email') ?? '').trim();
		if (!EMAIL.test(email) || email.length > 200) return fail(400, { message: 'Bitte eine gültige E-Mail-Adresse eintragen.', email });
		if (!isMailConfigured()) return fail(400, { message: 'Der E-Mail-Versand ist nicht eingerichtet – bitte den Link kopieren oder teilen.', email });
		const token = await ensureOfferToken(offer.id);
		const ok = await sendMail(
			customerOfferMail(email, { number: offer.number, title: offer.title, accepted: offer.status === 'angenommen' }, `${url.origin}/angebot/${token}`)
		);
		if (!ok) return fail(500, { message: 'Die E-Mail konnte nicht verschickt werden – bitte später noch einmal versuchen.', email });
		await markOfferLinkSent(offer.id, email);
		return { sent: email };
	},

	/** Auftrag aus dem angenommenen Angebot – mit derselben Nummer, für eine Partie */
	createOrder: async ({ params, request, locals }) => {
		const { user, offer } = await open(Number(params.id), locals);
		if (!can(user.role, 'auftraege.erstellen')) return fail(403, { orderMessage: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		// Die Partie ist freiwillig – zuteilen geht auch später, etwa in der Wochenplanung
		const rawParty = String(form.get('partie') ?? '');
		const partyId = rawParty ? Number(rawParty) : null;
		if (partyId !== null && (!Number.isInteger(partyId) || partyId <= 0)) return fail(400, { orderMessage: 'Die Partie stimmt nicht.' });
		// Pläne erst prüfen und ablegen – ist eine Datei kein PDF, entsteht auch kein Auftrag.
		// Der Browser lädt sie vorher in Teilen hoch (ohne Größengrenze) und schickt nur die
		// Kennungen; ohne JavaScript kommen die Dateien selbst.
		const stored: { name: string; sha256: string; size: number }[] = [];
		try {
			stored.push(...takeUploads(user.id, form.getAll('uploads').map(String)));
		} catch (err) {
			if (err instanceof DocumentError) return fail(400, { orderMessage: err.message });
			throw err;
		}
		const files = form.getAll('plaene').filter((f): f is File => f instanceof File && f.size > 0);
		for (const file of files) {
			try {
				stored.push({ name: file.name, ...(await storeDocument(file, null)) });
			} catch (err) {
				if (err instanceof DocumentError) return fail(400, { orderMessage: `${file.name}: ${err.message}` });
				throw err;
			}
		}
		const id = await createOrderFromOffer(offer.id, partyId, String(form.get('hinweis') ?? '').trim(), user.id);
		if (!id) return fail(400, { orderMessage: 'Aus diesem Angebot lässt sich (noch) kein Auftrag erstellen.' });
		for (const s of stored) await insertOrderDocument(id, s.name, s, user.id);
		notifyOrderAssigned(id, user.id);
		redirect(303, `/auftraege/${id}`);
	}
};
