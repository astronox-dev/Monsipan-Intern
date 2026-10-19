import { requirePermission } from '$lib/server/guard';
import { deleteRecordPhoto } from '$lib/modules/auftraege/server/attachments';
import { photoResponse } from '$lib/modules/auftraege/server/photo-http';
import type { RequestHandler } from './$types';

/** Foto am Angebot – wer Angebote sieht */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	requirePermission(locals, 'angebote.sehen');
	return photoResponse({ offerId: Number(params.id) }, Number(params.foto), url, `angebot-${params.id}`);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'angebote.bearbeiten');
	await deleteRecordPhoto({ offerId: Number(params.id) }, Number(params.foto));
	return new Response(null, { status: 204 });
};
