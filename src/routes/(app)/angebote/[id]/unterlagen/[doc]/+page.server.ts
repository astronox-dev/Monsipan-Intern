import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { offerDetail } from '$lib/modules/auftraege/server/offers';
import { chainOfOffer, findCaseDocument, parseRef, SOURCE_LABELS } from '$lib/modules/auftraege/server/case-files';
import type { PageServerLoad } from './$types';

/** PDF des Vorgangs – am Angebot, auch von der Anfrage oder vom Auftrag; wer Angebote sieht */
export const load: PageServerLoad = async ({ params, locals }) => {
	requirePermission(locals, 'angebote.sehen');
	const offer = await offerDetail(Number(params.id));
	if (!offer) error(404, 'Angebot nicht gefunden');
	const document = await findCaseDocument(await chainOfOffer(offer.id), parseRef(params.doc, 'angebot'));
	if (!document) error(404, 'Unterlage nicht gefunden');
	return {
		offer: { id: offer.id, number: offer.number },
		document: { key: params.doc, title: document.title, fileName: document.fileName, size: document.size },
		note: [document.source !== 'angebot' ? SOURCE_LABELS[document.source] : '', document.forCrew ? 'auch für die Partie' : 'nur Büro'].filter(Boolean).join(' · ')
	};
};
