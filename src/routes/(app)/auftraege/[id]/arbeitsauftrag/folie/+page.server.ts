import { error, fail, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guard';
import { isValidSignature } from '$lib/modules/stunden/signature';
import { mayViewOrder, orderDetail, seesWholeOrder } from '$lib/modules/auftraege/server/orders';
import { getWorkOrder, saveFoilProtocol, setFoilSignature, workScope } from '$lib/modules/auftraege/server/work-orders';
import { FOIL_SIGNATURE_ROLES, type FoilSignatureRole } from '$lib/modules/auftraege/work-order';
import type { Actions, PageServerLoad } from './$types';

/** Das Verlegeprotokoll gibt es nur, wenn im Arbeitsauftrag „Folienverlegeprotokoll: ja" steht */
async function open(id: number, locals: App.Locals) {
	const user = requireUser(locals);
	const order = await orderDetail(id);
	if (!order || !mayViewOrder(user, order)) error(404, 'Auftrag nicht gefunden');
	const work = await getWorkOrder(order.id);
	if (!work) {
		if (!seesWholeOrder(user)) error(404, 'Zu diesem Auftrag gibt es noch keinen Arbeitsauftrag.');
		redirect(303, `/auftraege/${order.id}`);
	}
	if (work.content.foilProtocol !== 'ja') redirect(303, `/auftraege/${order.id}/arbeitsauftrag`);
	return { user, order, work, scope: workScope(user, order) };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user, order, work, scope } = await open(Number(params.id), locals);
	return {
		order: { id: order.id, number: order.number, title: work.content.title || order.title },
		foil: work.content.foil,
		// Ausfüllen darf, wer auf der Baustelle am Arbeitsauftrag arbeitet
		canEdit: scope.site,
		lockedByOrder: !!work.content.signatures.auftraggeber,
		updatedAt: work.updatedAt,
		updatedByName: work.updatedByName,
		me: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
		contact: work.content.contacts[0]?.name ?? ''
	};
};

function readFoil(form: FormData): unknown | null {
	try {
		return JSON.parse(String(form.get('inhalt') ?? '{}'));
	} catch {
		return null;
	}
}

const roleOf = (v: FormDataEntryValue | null) => ((FOIL_SIGNATURE_ROLES as readonly string[]).includes(String(v)) ? (String(v) as FoilSignatureRole) : null);

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		const { user, order, scope } = await open(Number(params.id), locals);
		if (!scope.site) return fail(403, { message: 'Das Verlegeprotokoll füllt die Partie aus.' });
		const raw = readFoil(await request.formData());
		if (raw === null) return fail(400, { message: 'Das Formular ist unvollständig angekommen – bitte die Seite neu laden.' });
		const problem = await saveFoilProtocol(order.id, raw, user.id);
		if (problem) return fail(400, { message: problem });
		return { saved: true };
	},

	/** Unterschreiben – was im Formular steht, wird vorher gespeichert */
	sign: async ({ params, request, locals }) => {
		const { user, order, work, scope } = await open(Number(params.id), locals);
		if (!scope.site) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		const role = roleOf(form.get('wer'));
		if (!role) return fail(400, { message: 'Unbekannte Unterschrift.' });
		const name = String(form.get('name') ?? '').trim().slice(0, 120);
		const path = String(form.get('unterschrift') ?? '');
		if (name.length < 2) return fail(400, { message: 'Bitte den Namen eintragen.' });
		if (!isValidSignature(path)) return fail(400, { message: 'Bitte unterschreiben.' });
		if (!work.content.foil.signatures.auftraggeber) {
			const raw = readFoil(form);
			if (raw !== null) {
				const problem = await saveFoilProtocol(order.id, raw, user.id);
				if (problem) return fail(400, { message: problem });
			}
		}
		const problem = await setFoilSignature(order.id, role, { path, name, at: Date.now() }, user.id);
		if (problem) return fail(400, { message: problem });
		return { signed: role };
	},

	unsign: async ({ params, request, locals }) => {
		const { user, order, scope } = await open(Number(params.id), locals);
		if (!scope.site) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const role = roleOf((await request.formData()).get('wer'));
		if (!role) return fail(400, { message: 'Unbekannte Unterschrift.' });
		const problem = await setFoilSignature(order.id, role, null, user.id);
		if (problem) return fail(400, { message: problem });
		return { unsigned: role };
	}
};
