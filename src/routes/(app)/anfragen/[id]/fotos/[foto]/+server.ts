import { requirePermission } from '$lib/server/guard';
import { deleteRecordPhoto } from '$lib/modules/auftraege/server/attachments';
import { photoResponse } from '$lib/modules/auftraege/server/photo-http';
import type { RequestHandler } from './$types';

/** Foto der Anfrage – wer Anfragen sieht */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	requirePermission(locals, 'anfragen.sehen');
	return photoResponse({ inquiryId: Number(params.id) }, Number(params.foto), url, `anfrage-${params.id}`);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'anfragen.bearbeiten');
	await deleteRecordPhoto({ inquiryId: Number(params.id) }, Number(params.foto));
	return new Response(null, { status: 204 });
};
