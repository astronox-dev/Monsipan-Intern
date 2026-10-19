import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { orderDetail } from '$lib/modules/auftraege/server/orders';
import { uploadPhoto } from '$lib/modules/auftraege/server/photo-http';
import type { RequestHandler } from './$types';

/** Foto an den Auftrag – wer Aufträge bearbeitet */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requirePermission(locals, 'auftraege.bearbeiten');
	const order = await orderDetail(Number(params.id));
	if (!order) error(404, 'Auftrag nicht gefunden');
	return uploadPhoto({ orderId: order.id }, user.id, request);
};
