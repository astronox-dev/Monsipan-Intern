import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { offerDetail } from '$lib/modules/auftraege/server/offers';
import { uploadPhoto } from '$lib/modules/auftraege/server/photo-http';
import type { RequestHandler } from './$types';

/** Foto ans Angebot – in jedem Stand, wer Angebote bearbeitet */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requirePermission(locals, 'angebote.bearbeiten');
	const offer = await offerDetail(Number(params.id));
	if (!offer) error(404, 'Angebot nicht gefunden');
	return uploadPhoto({ offerId: offer.id }, user.id, request);
};
