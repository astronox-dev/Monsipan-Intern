import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { chainOfInquiry, deleteCasePhoto } from '$lib/modules/auftraege/server/case-files';
import { photoResponse } from '$lib/modules/auftraege/server/photo-http';
import type { RequestHandler } from './$types';

/** Foto des Vorgangs (auch vom Angebot oder Auftrag) – wer Anfragen sieht */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	requirePermission(locals, 'anfragen.sehen');
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Anfrage nicht gefunden');
	return photoResponse(await chainOfInquiry(id), Number(params.foto), url, `anfrage-${id}`);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'anfragen.bearbeiten');
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Anfrage nicht gefunden');
	await deleteCasePhoto(await chainOfInquiry(id), Number(params.foto));
	return new Response(null, { status: 204 });
};
