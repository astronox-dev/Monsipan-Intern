import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { offerDetail } from '$lib/modules/auftraege/server/offers';
import { getOfferDocument } from '$lib/modules/auftraege/server/offer-documents';
import type { PageServerLoad } from './$types';

/** Unterlage am Angebot – wer Angebote sieht */
export const load: PageServerLoad = async ({ params, locals }) => {
	requirePermission(locals, 'angebote.sehen');
	const offer = await offerDetail(Number(params.id));
	if (!offer) error(404, 'Angebot nicht gefunden');
	const document = await getOfferDocument(offer.id, Number(params.doc));
	if (!document) error(404, 'Unterlage nicht gefunden');
	return {
		offer: { id: offer.id, number: offer.number },
		document: { id: document.id, title: document.title, fileName: document.fileName, size: document.size, forCrew: document.forCrew }
	};
};
