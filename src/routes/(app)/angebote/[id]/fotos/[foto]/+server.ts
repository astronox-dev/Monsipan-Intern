import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { chainOfOffer, deleteCasePhoto } from '$lib/modules/auftraege/server/case-files';
import { photoResponse } from '$lib/modules/auftraege/server/photo-http';
import type { RequestHandler } from './$types';

/** Foto des Vorgangs (auch von der Anfrage oder vom Auftrag) – wer Angebote sieht */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	requirePermission(locals, 'angebote.sehen');
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Angebot nicht gefunden');
	return photoResponse(await chainOfOffer(id), Number(params.foto), url, `angebot-${id}`);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'angebote.bearbeiten');
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Angebot nicht gefunden');
	await deleteCasePhoto(await chainOfOffer(id), Number(params.foto));
	return new Response(null, { status: 204 });
};
