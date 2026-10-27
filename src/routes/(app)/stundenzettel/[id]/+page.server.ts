import { error, fail, redirect } from '@sveltejs/kit';
import { can, type Role } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import {
	deleteSheet,
	guestEditDays,
	handBackWeek,
	mayEdit,
	mayRecordFor,
	mayViewSheet,
	recentSites,
	saveSheet,
	saveSheetDays,
	setStatus,
	sheetDetail,
	totals,
	undoCheck,
	type DayInput
} from '$lib/modules/stunden/server/timesheets';
import { isValidSignature } from '$lib/modules/stunden/signature';
import { joinPlaces } from '$lib/modules/stunden/week';
import { notifySheet } from '$lib/modules/stunden/server/notify';
import { knownCostCenters } from '$lib/modules/stunden/server/kostenstellen';
import type { Actions, PageServerLoad } from './$types';

async function load_(id: number, locals: App.Locals) {
	const user = requireUser(locals);
	if (!Number.isInteger(id)) error(404, 'Stundenzettel nicht gefunden');
	const sheet = await sheetDetail(id);
	if (!sheet) error(404, 'Stundenzettel nicht gefunden');
	if (!(await mayViewSheet(user, sheet))) error(403, 'Diesen Stundenzettel darfst du nicht ansehen.');
	return { user, sheet };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user, sheet } = await load_(Number(params.id), locals);
	return {
		sheet,
		totals: totals(sheet.days),
		sites: await recentSites(),
		// Vorschläge, damit dieselbe Kostenstelle gleich geschrieben wird
		costCenters: await knownCostCenters(),
		editable: mayEdit(user, sheet),
		// Laut Wochenplanung bei der eigenen Partie: diese Tage einträgt man selbst, den Rest die schreibende Partie
		guestDays: await guestEditDays(user, sheet),
		guestPartyId: user.partyId,
		canDelete: sheet.status === 'entwurf' && mayEdit(user, sheet) && can(user.role, 'stunden.loeschen'),
		canRelease: can(user.role, 'stunden.freigeben'),
		canCheck: can(user.role, 'stunden.pruefen'),
		canReopen: mayReopen(user.role, sheet.status),
		canUncheck: sheet.status === 'geprueft' && can(user.role, 'stunden.pruefung.zuruecknehmen'),
		// Zurückgeben kann, wer die übernommene Woche schreibt – solange sie in Arbeit ist
		canHandBack: !!sheet.writingPartyId && sheet.status === 'entwurf' && mayRecordFor(user, sheet)
	};
};

/**
 * Die Tageszeilen aus dem Formular lesen. Beginn und Ende kommen je Zeitraum
 * einmal, in derselben Reihenfolge – sie werden paarweise zusammengesetzt.
 */
function readDays(form: FormData, dates: string[]): DayInput[] {
	const value = (name: string, date: string) => String(form.get(`${name}.${date}`) ?? '');
	const times = (date: string) => {
		const from = form.getAll(`beginn.${date}`).map(String);
		const to = form.getAll(`ende.${date}`).map(String);
		return Array.from({ length: Math.max(from.length, to.length) }, (_, i) => ({ from: from[i] ?? '', to: to[i] ?? '' }));
	};
	// Baustelle und Kostenstelle kommen je Zeile einmal, paarweise
	const places = (date: string) => {
		const sites = form.getAll(`baustelle.${date}`).map(String);
		const costs = form.getAll(`kostenstelle.${date}`).map(String);
		return joinPlaces(Array.from({ length: Math.max(sites.length, costs.length) }, (_, i) => ({ site: sites[i] ?? '', costCenter: costs[i] ?? '' })));
	};
	return dates.map((date) => ({
		date,
		...places(date),
		times: times(date),
		normalHours: value('norm', date),
		overtime50: value('ue50', date),
		overtime100: value('ue100', date),
		vacationHours: value('urlaub', date),
		holidayHours: value('feiertag', date),
		rainHours: value('regen', date),
		sickHours: value('efzg', date)
	}));
}

/** Wieder öffnen hängt am Status: für freigegebene und geprüfte Wochen gibt es je ein eigenes Recht */
function mayReopen(role: Role, status: string): boolean {
	if (status === 'freigegeben') return can(role, 'stunden.oeffnen.freigegeben');
	if (status === 'geprueft') return can(role, 'stunden.oeffnen.geprueft');
	return false;
}

function readHead(form: FormData) {
	return {
		allowanceDays: String(form.get('ausloeseTage') ?? ''),
		allowanceAmount: String(form.get('ausloeseBetrag') ?? ''),
		vazPercent: String(form.get('vazProzent') ?? ''),
		note: String(form.get('notiz') ?? '')
	};
}

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		const { user, sheet } = await load_(Number(params.id), locals);
		if (!mayEdit(user, sheet)) {
			// Aushilfe laut Wochenplanung: nur die eigenen Tage, Kopf und Freigabe bleiben bei der schreibenden Partie
			const days = await guestEditDays(user, sheet);
			if (!days.length) return fail(403, { message: 'Diese Woche ist nicht (mehr) änderbar.' });
			await saveSheetDays(sheet.id, readDays(await request.formData(), days));
			return { saved: true };
		}
		const form = await request.formData();
		await saveSheet(
			sheet.id,
			readHead(form),
			readDays(
				form,
				sheet.days.map((d) => d.date)
			)
		);
		return { saved: true };
	},

	/** Speichert den aktuellen Stand und gibt frei – mit Unterschrift, wenn eine mitkommt */
	release: async ({ params, request, locals }) => {
		const { user, sheet } = await load_(Number(params.id), locals);
		if (!can(user.role, 'stunden.freigeben') || !mayEdit(user, sheet)) {
			return fail(403, { message: 'Freigeben darf nur, wer die Woche auch erfassen darf.' });
		}
		if (sheet.status !== 'entwurf') return fail(400, { message: 'Diese Woche ist bereits freigegeben.' });
		const form = await request.formData();
		const raw = form.get('ohneUnterschrift') ? '' : String(form.get('unterschrift') ?? '').trim();
		if (raw && !isValidSignature(raw)) {
			return fail(400, { message: 'Die Unterschrift konnte nicht gelesen werden – bitte neu unterschreiben.' });
		}
		// Was im Formular steht, aber noch nicht gespeichert war, geht nicht verloren
		await saveSheet(
			sheet.id,
			readHead(form),
			readDays(
				form,
				sheet.days.map((d) => d.date)
			)
		);
		await setStatus(sheet.id, 'freigegeben', user.id, raw || null);
		notifySheet('stunden.freigegeben', sheet.id, user.id);
		return { released: true };
	},

	/** Prüfen geht nur mit Unterschrift – sie steht danach beim Feld „überprüft" */
	check: async ({ params, request, locals }) => {
		const { user, sheet } = await load_(Number(params.id), locals);
		if (!can(user.role, 'stunden.pruefen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		if (sheet.status !== 'freigegeben') return fail(400, { message: 'Geprüft werden kann nur eine freigegebene Woche.' });
		const form = await request.formData();
		const raw = String(form.get('unterschrift') ?? '').trim();
		if (!raw) return fail(400, { message: 'Bitte unterschreiben – ohne Unterschrift wird die Woche nicht als geprüft markiert.' });
		if (!isValidSignature(raw)) {
			return fail(400, { message: 'Die Unterschrift konnte nicht gelesen werden – bitte neu unterschreiben.' });
		}
		await setStatus(sheet.id, 'geprueft', user.id, raw);
		return { checked: true };
	},

	/** Prüfung zurücknehmen – die Woche bleibt freigegeben, nur die Prüf-Unterschrift verfällt */
	uncheck: async ({ params, locals }) => {
		const { user, sheet } = await load_(Number(params.id), locals);
		if (!can(user.role, 'stunden.pruefung.zuruecknehmen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		if (sheet.status !== 'geprueft') return fail(400, { message: 'Diese Woche ist nicht geprüft.' });
		await undoCheck(sheet.id);
		return { unchecked: true };
	},

	/** Wieder öffnen nur mit dem Recht für den jeweiligen Status – standardmäßig nicht der Partieführer */
	reopen: async ({ params, locals }) => {
		const { user, sheet } = await load_(Number(params.id), locals);
		if (sheet.status === 'entwurf') return { reopened: true };
		if (!mayReopen(user.role, sheet.status)) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		await setStatus(sheet.id, 'entwurf', user.id);
		notifySheet('stunden.geoeffnet', sheet.id, user.id);
		return { reopened: true };
	},

	delete: async ({ params, locals }) => {
		const { user, sheet } = await load_(Number(params.id), locals);
		if (!mayEdit(user, sheet) || sheet.status !== 'entwurf' || !can(user.role, 'stunden.loeschen')) {
			return fail(403, { message: 'Nur Wochen in Arbeit können gelöscht werden – und nur mit dem Recht zum Löschen.' });
		}
		const week = sheet.weekStart;
		await deleteSheet(sheet.id);
		redirect(303, `/stundenzettel?woche=${week}&monat=${sheet.month}`);
	},

	/** Übernommene Woche an die eigene Partie des Mitarbeiters zurückgeben */
	zurueckgeben: async ({ params, locals }) => {
		const { user, sheet } = await load_(Number(params.id), locals);
		if (!sheet.writingPartyId) return fail(400, { message: 'Diese Woche ist nicht übernommen.' });
		if (!mayRecordFor(user, sheet)) return fail(403, { message: 'Zurückgeben kann nur, wer die Woche übernommen hat.' });
		const problem = await handBackWeek(sheet.userId, sheet.weekStart);
		if (problem) return fail(400, { message: problem });
		redirect(303, `/stundenzettel?woche=${sheet.weekStart}&monat=${sheet.month}`);
	}
};
