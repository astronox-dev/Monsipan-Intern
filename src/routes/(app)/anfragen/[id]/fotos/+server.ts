import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { inquiryDetail } from '$lib/modules/auftraege/server/inquiries';
import { uploadPhoto } from '$lib/modules/auftraege/server/photo-http';
import type { RequestHandler } from './$types';

/** Foto an die Anfrage – wer Anfragen bearbeitet */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requirePermission(locals, 'anfragen.bearbeiten');
	const inquiry = await inquiryDetail(Number(params.id));
	if (!inquiry) error(404, 'Anfrage nicht gefunden');
	return uploadPhoto({ inquiryId: inquiry.id }, user.id, request);
};
