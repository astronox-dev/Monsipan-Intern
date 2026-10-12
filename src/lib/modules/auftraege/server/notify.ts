/**
 * Benachrichtigungen im Auftragsmanagement: Texte und Links zu Anfrage,
 * Angebot, Auftrag und Rechnung. Alles läuft im Hintergrund – die Aktion, die
 * es auslöst, wartet nicht darauf.
 */
import { notify } from '$lib/server/notifications';
import { date as dateLabel } from '$lib/format';
import { invoiceLabel, invoiceNo, invoiceTotals, money, spacedNumber } from '../offer';
import { offerDetail } from './offers';
import { orderDetail } from './orders';
import { invoiceDetail } from './invoices';

const background = (label: string, task: () => Promise<void>) => {
	task().catch((err) => console.error(`[benachrichtigung] ${label}`, err));
};
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

export function notifyInquiry(inquiry: { id: number; subject: string; senderName: string; senderEmail: string }, actorId: number) {
	notify({
		event: 'anfrage.neu',
		title: inquiry.subject ? `Neue Anfrage: ${inquiry.subject}` : 'Neue Anfrage',
		body: inquiry.senderName || inquiry.senderEmail,
		url: `/anfragen/${inquiry.id}`,
		actorId
	});
}

type OfferEvent = 'angebot.freigegeben' | 'angebot.angenommen' | 'angebot.aenderung';

const OFFER_TITLE: Record<OfferEvent, (n: string) => string> = {
	'angebot.freigegeben': (n) => `Angebot ${n} freigegeben`,
	'angebot.angenommen': (n) => `Angebot ${n} angenommen`,
	'angebot.aenderung': (n) => `Änderungswunsch zu Angebot ${n}`
};

/**
 * Angebot: freigegeben, vom Kunden angenommen oder Änderung gewünscht (dann mit
 * dem Wunsch im Text). Antwortet der Kunde über den Link (`fromCustomer`), geht
 * die Info-Mail außerdem an die Person, die das Angebot angelegt bzw. freigegeben hat.
 */
export function notifyOffer(
	event: OfferEvent,
	offerId: number,
	opts: { actorId?: number; message?: string; name?: string; fromCustomer?: boolean; origin?: string } = {}
) {
	background(event, async () => {
		const offer = await offerDetail(offerId);
		if (!offer) return;
		notify({
			event,
			title: OFFER_TITLE[event](spacedNumber(offer.number)),
			body:
				event === 'angebot.aenderung'
					? join(opts.name, opts.message)
					: event === 'angebot.angenommen'
						? join(opts.name && `von ${opts.name}`, offer.customerName, offer.title)
						: join(offer.customerName, offer.title),
			url: `/angebote/${offer.id}`,
			actorId: opts.actorId,
			mailUserIds: opts.fromCustomer ? [offer.createdBy, offer.releasedBy].filter((id): id is number => id != null) : undefined,
			origin: opts.origin
		});
	});
}

/** Auftrag einer Partie zugeordnet – beim Erstellen und beim Wechsel der Partie */
export function notifyOrderAssigned(orderId: number, actorId: number) {
	background('auftrag.zugeordnet', async () => {
		const order = await orderDetail(orderId);
		if (!order?.partyId) return;
		notify({
			event: 'auftrag.zugeordnet',
			title: `Auftrag ${spacedNumber(order.number)} für ${order.partyName ?? 'die Partie'}`,
			body: join(order.title, order.location),
			url: `/auftraege/${order.id}`,
			partyId: order.partyId,
			actorId
		});
	});
}

/** Stand des Auftrags: in Arbeit bzw. abgeschlossen */
export function notifyOrderStatus(orderId: number, status: string, actorId: number) {
	if (status !== 'in_arbeit' && status !== 'abgeschlossen') return;
	background(`auftrag.${status}`, async () => {
		const order = await orderDetail(orderId);
		if (!order) return;
		notify({
			event: status === 'in_arbeit' ? 'auftrag.in_arbeit' : 'auftrag.abgeschlossen',
			title: `Auftrag ${spacedNumber(order.number)} ${status === 'in_arbeit' ? 'in Arbeit' : 'abgeschlossen'}`,
			body: join(order.partyName, order.title),
			url: `/auftraege/${order.id}`,
			partyId: order.partyId,
			actorId
		});
	});
}

/** Neue Pläne bzw. Unterlagen am Auftrag */
export function notifyOrderDocuments(orderId: number, titles: string[], actorId: number) {
	if (!titles.length) return;
	background('auftrag.unterlagen', async () => {
		const order = await orderDetail(orderId);
		if (!order) return;
		notify({
			event: 'auftrag.unterlagen',
			title: `${titles.length === 1 ? 'Neue Unterlage' : `${titles.length} neue Unterlagen`} zu Auftrag ${spacedNumber(order.number)}`,
			body: titles.join(', '),
			url: `/auftraege/${order.id}`,
			partyId: order.partyId,
			actorId
		});
	});
}

/** Rechnung erstellt bzw. bezahlt */
export function notifyInvoice(event: 'rechnung.erstellt' | 'rechnung.bezahlt', invoiceId: number, actorId: number) {
	background(event, async () => {
		const i = await invoiceDetail(invoiceId);
		if (!i) return;
		notify({
			event,
			title: `${invoiceLabel(i.kind)} ${invoiceNo(i)} ${event === 'rechnung.erstellt' ? 'erstellt' : 'bezahlt'}`,
			body: join(i.customerName, money(invoiceTotals(i.lines, i.vatRate, i.reverseCharge).gross), event === 'rechnung.erstellt' && `zahlbar bis ${dateLabel(i.dueDate)}`),
			url: `/rechnungen/${i.id}`,
			actorId
		});
	});
}
