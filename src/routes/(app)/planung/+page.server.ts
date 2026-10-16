import { fail } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import {
	addEntry,
	addNote,
	claimOrder,
	deleteEntry,
	deleteNote,
	moveEntry,
	planOrders,
	planWeek,
	readEntry,
	resetCrew,
	seesAllPlans,
	sendWeek,
	setCrew,
	setPartyOrder,
	setNoteDone,
	updateEntry,
	updateNote
} from '$lib/modules/planung/server/plan';
import { isValidIsoDate, mondayOf, today } from '$lib/modules/stunden/week';
import { notifyOrderAssigned } from '$lib/modules/auftraege/server/notify';
import type { SessionUser } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const user = requirePermission(locals, 'planung.sehen');
	const raw = url.searchParams.get('woche') ?? '';
	const weekStart = mondayOf(isValidIsoDate(raw) ? raw : today());
	const week = await planWeek(user, weekStart);
	const canEdit = can(user.role, 'planung.bearbeiten');
	return {
		weekStart,
		today: today(),
		...week,
		all: seesAllPlans(user),
		canEdit,
		canOpenOrders: can(user.role, 'auftraege.sehen'),
		// Zur Auswahl: offene Aufträge und die schon eingeplanten
		orders: canEdit ? await planOrders(week.entries.map((e) => e.orderId).filter((id): id is number => id != null)) : []
	};
};

const id = (form: FormData) => Number(form.get('id'));

/** Ein noch nicht zugeteilter Auftrag geht an die Partie, bei der er eingeplant wird */
async function assign(user: SessionUser, input: { orderId: number | null; partyId: number }): Promise<boolean> {
	if (!input.orderId || !(await claimOrder(input.orderId, input.partyId))) return false;
	notifyOrderAssigned(input.orderId, user.id);
	return true;
}

export const actions: Actions = {
	/** Neu – auf einem oder mehreren Tagen der Woche */
	add: async ({ request, locals }) => {
		const user = requirePermission(locals, 'planung.bearbeiten');
		const form = await request.formData();
		const days = form.getAll('tage').map(String).filter(isValidIsoDate);
		if (!days.length) return fail(400, { message: 'Bitte mindestens einen Tag wählen.' });
		form.set('datum', days[0]);
		const input = readEntry(form);
		if ('message' in input) return fail(400, input);
		for (const date of days) {
			const result = await addEntry(user, { ...input, date });
			if (typeof result !== 'number') return fail(400, result);
		}
		return { saved: days.length, assigned: await assign(user, input) };
	},

	update: async ({ request, locals }) => {
		const user = requirePermission(locals, 'planung.bearbeiten');
		const form = await request.formData();
		const input = readEntry(form);
		if ('message' in input) return fail(400, input);
		const result = await updateEntry(id(form), input);
		if (result !== true) return fail(400, result);
		return { saved: 1, assigned: await assign(user, input) };
	},

	/** Per Ziehen auf ein anderes Feld – vor einen anderen Eintrag (`vor`) oder ans Ende */
	move: async ({ request, locals }) => {
		const user = requirePermission(locals, 'planung.bearbeiten');
		const form = await request.formData();
		const date = String(form.get('datum') ?? '');
		const partyId = Number(form.get('partie'));
		const before = Number(form.get('vor'));
		if (!isValidIsoDate(date) || !Number.isInteger(partyId)) return fail(400, { message: 'Tag oder Partie fehlt.' });
		const result = await moveEntry(id(form), { date, partyId, beforeId: Number.isInteger(before) && before > 0 ? before : null });
		if ('message' in result) return fail(400, result);
		return { moved: true, assigned: await assign(user, { orderId: result.orderId, partyId }) };
	},

	/** Reihenfolge der Spalten – `partie` mehrfach, in der neuen Reihenfolge */
	order: async ({ request, locals }) => {
		requirePermission(locals, 'planung.bearbeiten');
		const ids = (await request.formData())
			.getAll('partie')
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0);
		if (!ids.length) return fail(400, { message: 'Keine Partien.' });
		await setPartyOrder(ids);
		return { ordered: true };
	},

	/**
	 * Person für diese Woche (`woche`) oder nur einen Tag (`tag`) zu einer
	 * anderen Partie – die feste Partie im Konto bleibt
	 */
	crew: async ({ request, locals }) => {
		const user = requirePermission(locals, 'planung.bearbeiten');
		const form = await request.formData();
		const userId = Number(form.get('person'));
		const partyId = Number(form.get('partie'));
		const week = String(form.get('woche') ?? '');
		const day = String(form.get('tag') ?? '');
		if (!Number.isInteger(userId) || !Number.isInteger(partyId)) return fail(400, { message: 'Person oder Partie fehlt.' });
		const problem = isValidIsoDate(day)
			? await setCrew(user, { userId, partyId, date: day })
			: isValidIsoDate(week)
				? await setCrew(user, { userId, partyId, weekStart: mondayOf(week) })
				: 'Woche oder Tag fehlt.';
		if (problem) return fail(400, { message: problem });
		return { crew: true };
	},

	/** Abweichung aufheben – Woche bzw. Tag */
	crewReset: async ({ request, locals }) => {
		requirePermission(locals, 'planung.bearbeiten');
		const form = await request.formData();
		const userId = Number(form.get('person'));
		const week = String(form.get('woche') ?? '');
		const day = String(form.get('tag') ?? '');
		if (!Number.isInteger(userId)) return fail(400, { message: 'Person fehlt.' });
		if (isValidIsoDate(day)) await resetCrew({ userId, date: day });
		else if (isValidIsoDate(week)) await resetCrew({ userId, weekStart: mondayOf(week) });
		else return fail(400, { message: 'Woche oder Tag fehlt.' });
		return { crew: true };
	},

	remove: async ({ request, locals }) => {
		requirePermission(locals, 'planung.bearbeiten');
		await deleteEntry(id(await request.formData()));
		return { removed: true };
	},

	/** Die Woche an die Partien schicken – eine Benachrichtigung je Partie */
	send: async ({ request, locals }) => {
		const user = requirePermission(locals, 'planung.bearbeiten');
		const week = String((await request.formData()).get('woche') ?? '');
		if (!isValidIsoDate(week)) return fail(400, { message: 'Die Woche fehlt.' });
		return { sent: await sendWeek(user, mondayOf(week)) };
	},

	note: async ({ request, locals }) => {
		const user = requirePermission(locals, 'planung.bearbeiten');
		if (!(await addNote(user, (await request.formData()).get('text')))) return fail(400, { message: 'Die Notiz ist leer.' });
		return { noted: true };
	},

	noteEdit: async ({ request, locals }) => {
		requirePermission(locals, 'planung.bearbeiten');
		const form = await request.formData();
		if (!(await updateNote(id(form), form.get('text')))) return fail(400, { message: 'Die Notiz ist leer.' });
		return { noted: true };
	},

	noteDone: async ({ request, locals }) => {
		requirePermission(locals, 'planung.bearbeiten');
		const form = await request.formData();
		await setNoteDone(id(form), form.get('erledigt') === 'ja');
		return { noted: true };
	},

	noteRemove: async ({ request, locals }) => {
		requirePermission(locals, 'planung.bearbeiten');
		await deleteNote(id(await request.formData()));
		return { noted: true };
	}
};
