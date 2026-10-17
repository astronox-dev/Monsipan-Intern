import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import { colorOptions } from '$lib/server/options';
import { mayViewOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import { createWorkOrder, hasWorkOrder, prefill } from '$lib/modules/auftraege/server/work-orders';
import { notifyOrderAssigned } from '$lib/modules/auftraege/server/notify';
import { sanitizeForm } from '$lib/modules/auftraege/work-order';
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
	const { order } = await open(Number(params.id), locals);
	return {
		order: { id: order.id, number: order.number, title: order.title, partyName: order.partyName },
		content: await prefill(order),
		colors: (await colorOptions()).filter((c) => c.ral).map((c) => ({ ral: c.ral as string, name: c.name }))
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals }) => {
		const { user, order } = await open(Number(params.id), locals);
		let raw: unknown;
		try {
			raw = JSON.parse(String((await request.formData()).get('inhalt') ?? '{}'));
		} catch {
			return fail(400, { message: 'Das Formular ist unvollständig angekommen – bitte die Seite neu laden.' });
		}
		// Ab jetzt sieht die Partie den Auftrag – als Arbeitsauftrag – und bekommt Bescheid
		if (await createWorkOrder(order, user.id, sanitizeForm(raw))) notifyOrderAssigned(order.id, user.id);
		redirect(303, `/auftraege/${order.id}/arbeitsauftrag`);
	}
};
