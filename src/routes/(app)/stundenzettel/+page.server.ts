import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import { borrowCandidates, borrowWeek, mayRecordFor, maySeeTimesheets, openSheet, partyName, weekOverview } from '$lib/modules/stunden/server/timesheets';
import { isValidIsoDate, mondayOf, today } from '$lib/modules/stunden/week';
import { notifySheet } from '$lib/modules/stunden/server/notify';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);
	if (!maySeeTimesheets(user)) error(403, 'Dafür fehlt dir die Berechtigung.');
	const param = url.searchParams.get('woche') ?? '';
	const weekStart = mondayOf(isValidIsoDate(param) ? param : today());
	const rows = await weekOverview(user, weekStart);
	// Wer diese Woche schon übernommen ist, steht nicht noch einmal zur Auswahl
	const taken = new Set(rows.filter((r) => r.writingPartyId && r.writingPartyId === user.partyId).map((r) => r.user.id));
	return {
		weekStart,
		rows,
		ownPartyId: user.partyId,
		ownPartyName: await partyName(user.partyId),
		candidates: (await borrowCandidates(user)).filter((c) => !taken.has(c.id)),
		canCreate: can(user.role, 'stunden.erstellen'),
		canCheck: can(user.role, 'stunden.pruefen')
	};
};

export const actions: Actions = {
	/** Woche für einen Mitarbeiter öffnen – legt den Zettel an, wenn es ihn noch nicht gibt */
	open: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		const userId = Number(form.get('userId'));
		const weekStart = String(form.get('weekStart') ?? '');
		const month = String(form.get('monat') ?? '');
		if (!Number.isInteger(userId) || !isValidIsoDate(weekStart)) error(400, 'Ungültige Angaben');

		// Ausgenommene Personen ohne Zettel stehen nicht in der Übersicht – für sie wird nichts angelegt
		const allowed = await weekOverview(user, weekStart);
		const row = allowed.find((r) => r.user.id === userId && r.month === month);
		if (!row) error(403, 'Für diese Person darfst du keine Stunden erfassen.');
		// Ansehen reicht zum Öffnen; anlegen darf nur, wer erstellen und für diese Partie eintragen darf –
		// oder bei wessen Partie der Arbeiter laut Wochenplanung an Tagen dieser Woche eingeteilt ist
		const mayRecord = mayRecordFor(user, { partyId: row.user.partyId, writingPartyId: row.writingPartyId }) || row.guestDays.length > 0;
		if (!row.sheetId && (!can(user.role, 'stunden.erstellen') || !mayRecord)) {
			error(403, 'Für diese Person darfst du keinen Stundenzettel anlegen – sie gehört zu einer anderen Partie.');
		}

		const id = row.sheetId ?? (await openSheet(userId, weekStart, month, user.id));
		redirect(303, `/stundenzettel/${id}`);
	},

	/** Arbeiter einer anderen Partie für diese Woche übernehmen – die eigene Partie schreibt dann den ganzen Zettel */
	aushilfe: async ({ request, locals }) => {
		const user = requireUser(locals);
		if (!can(user.role, 'stunden.aushilfe')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const form = await request.formData();
		const personId = Number(form.get('userId'));
		const weekStart = String(form.get('weekStart') ?? '');
		if (!Number.isInteger(personId) || !isValidIsoDate(weekStart)) return fail(400, { message: 'Bitte eine Person wählen.' });
		const result = await borrowWeek(user, personId, weekStart);
		if ('error' in result) return fail(400, { message: result.error });
		notifySheet('stunden.aushilfe', result.id, user.id);
		redirect(303, `/stundenzettel/${result.id}`);
	}
};
