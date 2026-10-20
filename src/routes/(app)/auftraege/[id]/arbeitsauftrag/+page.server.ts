import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import { ORDER_STATUS, type OrderStatus } from '$lib/server/db/schema';
import { isValidSignature } from '$lib/modules/stunden/signature';
import { mayOpenOrder, maySetOrderStatus, orderDetail, seesWholeOrder, setOrderStatus } from '$lib/modules/auftraege/server/orders';
import { notifyOrderStatus } from '$lib/modules/auftraege/server/notify';
import { listReports } from '$lib/modules/tagesberichte/server/reports';
import {
	addBriefing,
	closeBlocker,
	crewNames,
	deleteWorkOrder,
	getWorkOrder,
	removeBriefing,
	saveWorkOrderForm,
	setWorkOrderSignature,
	workScope
} from '$lib/modules/auftraege/server/work-orders';
import { isIsoDate, isPristineFoil, maySign, prefillFoil, sanitizeForm, SIGNATURE_ROLES, type SignatureRole, type WorkScope } from '$lib/modules/auftraege/work-order';
import { caseDocuments, casePhotos, chainFor } from '$lib/modules/auftraege/server/case-files';
import { orderPlanDays } from '$lib/modules/planung/server/plan';
import type { Actions, PageServerLoad } from './$types';

async function open(id: number, locals: App.Locals) {
	const user = requireUser(locals);
	const order = await orderDetail(id);
	// Fremde Aufträge gibt es für die Partie nicht – auch nicht als „verboten"
	if (!order || !(await mayOpenOrder(user, order))) error(404, 'Auftrag nicht gefunden');
	const work = await getWorkOrder(order.id);
	if (!work) {
		if (!seesWholeOrder(user)) error(404, 'Zu diesem Auftrag gibt es noch keinen Arbeitsauftrag.');
		redirect(303, `/auftraege/${order.id}`);
	}
	return { user, order, work, scope: workScope(user, order) };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user, order, work, scope } = await open(Number(params.id), locals);
	const chain = await chainFor(order);
	return {
		// Pläne und Fotos des ganzen Vorgangs – was für die Partie ist
		documents: await caseDocuments(chain, { crewOnly: true }),
		photos: await casePhotos(chain, 'auftrag'),
		// Wann der Auftrag in der Wochenplanung steht
		plan: { ...(await orderPlanDays(order.id)), party: order.partyName },
		order: {
			id: order.id,
			number: order.number,
			title: order.title,
			partyName: order.partyName,
			status: order.status,
			location: order.location,
			note: order.note,
		},
		work,
		// Das 3M-Protokoll – steht noch nichts drin, vorbelegt aus Baustelle, Datum und Folien-Leistungen
		foilStart: isPristineFoil(work.content.foil) ? { ...prefillFoil(work.content), signatures: work.content.foil.signatures } : work.content.foil,
		scope,
		locked: !!work.content.signatures.auftraggeber,
		/** Den ganzen Auftrag sieht nur das Büro – die Partie arbeitet hier */
		wholeOrder: seesWholeOrder(user),
		canStatus: maySetOrderStatus(user, order),
		reports: can(user.role, 'tagesberichte.sehen') ? await listReports(user, { orderId: order.id }) : [],
		canCreateReport: can(user.role, 'tagesberichte.erstellen') && order.status !== 'abgeschlossen',
		me: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
		crew: scope.site ? await crewNames(order.partyId) : []
	};
};

/** Formular aus dem Feld „inhalt" lesen und speichern – nur, was der Benutzer ändern darf */
async function saveForm(form: FormData, orderId: number, scope: WorkScope, userId: number) {
	let raw: unknown;
	try {
		raw = JSON.parse(String(form.get('inhalt') ?? '{}'));
	} catch {
		return 'Das Formular ist unvollständig angekommen – bitte die Seite neu laden.';
	}
	return saveWorkOrderForm(orderId, sanitizeForm(raw), scope, userId, (raw as { foil?: unknown } | null)?.foil);
}

const roleOf = (v: FormDataEntryValue | null) => ((SIGNATURE_ROLES as readonly string[]).includes(String(v)) ? (String(v) as SignatureRole) : null);

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		const { user, order, scope } = await open(Number(params.id), locals);
		if (!scope.office && !scope.site) return fail(403, { message: 'Diesen Arbeitsauftrag darfst du nur ansehen.' });
		const problem = await saveForm(await request.formData(), order.id, scope, user.id);
		if (problem) return fail(400, { message: problem });
		return { saved: true };
	},

	/** Stand des Auftrags – die Partie setzt ihn hier, das Büro am Auftrag */
	status: async ({ params, request, locals }) => {
		const { user, order, work, scope } = await open(Number(params.id), locals);
		const form = await request.formData();
		const status = String(form.get('status') ?? '') as OrderStatus;
		if (!ORDER_STATUS.includes(status) || status === 'erstellt') return fail(400, { message: 'Unbekannter Stand' });
		if (!maySetOrderStatus(user, order)) return fail(403, { message: 'Den Stand setzt die Partie, der der Auftrag gehört.' });
		// Was im Formular steht (etwa die Haken der Checkliste), gilt – vorher speichern
		if (form.has('inhalt') && (scope.office || scope.site) && !work.content.signatures.auftraggeber) {
			const problem = await saveForm(form, order.id, scope, user.id);
			if (problem) return fail(400, { message: problem });
		}
		if (status === 'abgeschlossen' && order.status !== 'abgeschlossen') {
			const blocker = await closeBlocker(order.id);
			if (blocker) return fail(400, { message: blocker });
		}
		await setOrderStatus(order.id, status, user.id);
		if (status !== order.status) notifyOrderStatus(order.id, status, user.id);
		return { status };
	},

	/** Unterschreiben – was im Formular steht, wird vorher gespeichert */
	sign: async ({ params, request, locals }) => {
		const { user, order, work, scope } = await open(Number(params.id), locals);
		const form = await request.formData();
		const role = roleOf(form.get('wer'));
		if (!role) return fail(400, { message: 'Unbekannte Unterschrift.' });
		if (!maySign(role, scope)) return fail(403, { message: 'Diese Unterschrift darfst du nicht setzen.' });
		const name = String(form.get('name') ?? '').trim().slice(0, 120);
		const path = String(form.get('unterschrift') ?? '');
		if (name.length < 2) return fail(400, { message: 'Bitte den Namen eintragen.' });
		if (!isValidSignature(path)) return fail(400, { message: 'Bitte unterschreiben.' });
		if (!work.content.signatures.auftraggeber) {
			const problem = await saveForm(form, order.id, scope, user.id);
			if (problem) return fail(400, { message: problem });
		}
		const problem = await setWorkOrderSignature(order.id, role, { path, name, at: Date.now() }, user.id);
		if (problem) return fail(400, { message: problem });
		// Mit der Unterschrift des Auftraggebers ist die Arbeit fertig – auf Wunsch gleich abschließen
		const wantsClose = role === 'auftraggeber' && form.get('abschliessen') === '1' && maySetOrderStatus(user, order) && order.status !== 'abgeschlossen';
		// Ohne abgehakte Checkliste bleibt es bei der Unterschrift
		const blocker = wantsClose ? await closeBlocker(order.id) : null;
		const close = wantsClose && !blocker;
		if (close) {
			await setOrderStatus(order.id, 'abgeschlossen', user.id);
			notifyOrderStatus(order.id, 'abgeschlossen', user.id);
		}
		return { signed: role, closed: close, closeBlocker: blocker };
	},

	unsign: async ({ params, request, locals }) => {
		const { user, order, scope } = await open(Number(params.id), locals);
		const role = roleOf((await request.formData()).get('wer'));
		if (!role) return fail(400, { message: 'Unbekannte Unterschrift.' });
		if (!maySign(role, scope)) return fail(403, { message: 'Diese Unterschrift darfst du nicht entfernen.' });
		const problem = await setWorkOrderSignature(order.id, role, null, user.id);
		if (problem) return fail(400, { message: problem });
		return { unsigned: role };
	},

	/** Unterweisung: Datum, Name und Unterschrift der Person – am Gerät */
	brief: async ({ params, request, locals }) => {
		const { user, order, work, scope } = await open(Number(params.id), locals);
		if (!scope.site) return fail(403, { message: 'Unterweisungen trägt die Partie oder das Büro ein.' });
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim().slice(0, 120);
		const date = String(form.get('datum') ?? '');
		const signature = String(form.get('unterschrift') ?? '');
		if (name.length < 2) return fail(400, { message: 'Bitte den Namen eintragen.' });
		if (!isIsoDate(date)) return fail(400, { message: 'Das Datum stimmt nicht.' });
		if (!isValidSignature(signature)) return fail(400, { message: 'Bitte unterschreiben lassen.' });
		if (!work.content.signatures.auftraggeber) {
			const problem = await saveForm(form, order.id, scope, user.id);
			if (problem) return fail(400, { message: problem });
		}
		const problem = await addBriefing(order.id, { date, name, signature, at: Date.now() }, user.id);
		if (problem) return fail(400, { message: problem });
		return { briefed: name };
	},

	unbrief: async ({ params, request, locals }) => {
		const { user, order, scope } = await open(Number(params.id), locals);
		if (!scope.site) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const index = Number((await request.formData()).get('nr'));
		if (!Number.isInteger(index) || index < 0) return fail(400, { message: 'Unterweisung fehlt.' });
		const problem = await removeBriefing(order.id, index, user.id);
		if (problem) return fail(400, { message: problem });
		return { unbriefed: true };
	},

	delete: async ({ params, locals }) => {
		const { order, scope } = await open(Number(params.id), locals);
		if (!scope.office) return fail(403, { message: 'Den Arbeitsauftrag löscht das Büro.' });
		await deleteWorkOrder(order.id);
		redirect(303, `/auftraege/${order.id}`);
	}
};
