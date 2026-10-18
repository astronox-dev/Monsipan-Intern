import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import { colorOptions } from '$lib/server/options';
import { mayViewOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import { createWorkOrder, hasWorkOrder, orderSource, prefill, readCreation } from '$lib/modules/auftraege/server/work-orders';
import { notifyOrderAssigned } from '$lib/modules/auftraege/server/notify';
import type { Actions, PageServerLoad } from './$types';

/** Erstellen darf das Büro – gibt es schon einen Arbeitsauftrag, geht es gleich dorthin */
async function open(id: number, locals: App.Locals) {
	const user = requireUser(locals);
	const order = await orderDetail(id);
	if (!order || !mayViewOrder(user, order) || !seesWholeOrder(user)) error(404, 'Auftrag nicht gefunden');
	if (!can(user.role, 'auftraege.bearbeiten')) error(403, 'Den Arbeitsauftrag legt das Büro an.');
	if (await hasWorkOrder(order.id)) redirect(303, `/auftraege/${order.id}/arbeitsauftrag`);
	return { user, order };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user, order } = await open(Number(params.id), locals);
	return {
		order: { id: order.id, number: order.number, title: order.title, partyName: order.partyName, hasPlans: order.documents.length > 0 },
		content: await prefill(orderSource(order)),
		colors: (await colorOptions()).filter((c) => c.ral).map((c) => ({ ral: c.ral as string, name: c.name })),
		me: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		const read = readCreation(await request.formData());
		if ('message' in read) return fail(400, { message: read.message });
		// Ab jetzt sieht die Partie den Auftrag – als Arbeitsauftrag – und bekommt Bescheid
		if (await createWorkOrder(order, user.id, read.form, read.bl)) notifyOrderAssigned(order.id, user.id);
		redirect(303, `/auftraege/${order.id}/arbeitsauftrag`);
	}
};
