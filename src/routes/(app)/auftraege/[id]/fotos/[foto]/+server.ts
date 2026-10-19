import { error } from '@sveltejs/kit';
import { requirePermission, requireUser } from '$lib/server/guard';
import { mayViewOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import { hasWorkOrder } from '$lib/modules/auftraege/server/work-orders';
import { chainOfOrder, deleteCasePhoto } from '$lib/modules/auftraege/server/case-files';
import { photoResponse } from '$lib/modules/auftraege/server/photo-http';
import type { RequestHandler } from './$types';

/** Foto des Vorgangs (auch von Anfrage oder Angebot) – wer den Auftrag sieht, die Partie über den Arbeitsauftrag */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = requireUser(locals);
	const order = await orderDetail(Number(params.id));
	if (!order || !mayViewOrder(user, order)) error(404, 'Auftrag nicht gefunden');
	if (!seesWholeOrder(user) && !(await hasWorkOrder(order.id))) error(404, 'Auftrag nicht gefunden');
	return photoResponse(await chainOfOrder(order.id), Number(params.foto), url, `auftrag-${order.number}`);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'auftraege.bearbeiten');
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Auftrag nicht gefunden');
	await deleteCasePhoto(await chainOfOrder(id), Number(params.foto));
	return new Response(null, { status: 204 });
};
