import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requireUser } from '$lib/server/guard';
import { customerReportMail, isMailConfigured, sendMail } from '$lib/server/mail';
import {
	checkDateRange,
	checkReport,
	customerSignOnSite,
	deleteReport,
	ensureCustomerToken,
	markLinkSent,
	materialProducts,
	mayEdit,
	mayReopen,
	mayView,
	mayWork,
	recentPlaces,
	releaseReport,
	removeCustomerSignature,
	reopenReport,
	reportDetail,
	saveReport,
	undoCheck,
	type SaveReport
} from '$lib/modules/tagesberichte/server/reports';
import { isValidSignature } from '$lib/modules/stunden/signature';
import { linkableOrders, orderLineChoices } from '$lib/modules/auftraege/server/orders';
import { notifyReport } from '$lib/modules/tagesberichte/server/notify';
import type { SessionUser } from '$lib/server/auth';
import { listPhotos } from '$lib/modules/tagesberichte/server/photos';
import { unitOptions } from '$lib/server/options';
import type { Actions, PageServerLoad } from './$types';

async function open(id: number, locals: App.Locals) {
	const user = requireUser(locals);
	if (!Number.isInteger(id)) error(404, 'Tagesbericht nicht gefunden');
	const report = await reportDetail(id);
	if (!report) error(404, 'Tagesbericht nicht gefunden');
	if (!mayView(user, report)) error(403, 'Diesen Tagesbericht darfst du nicht ansehen.');
	return { user, report };
}

/** Den Link bekommt der Kunde erst nach der Prüfung */
const linkReady = (status: string) => status === 'geprueft' || status === 'abgeschlossen';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const { user, report } = await open(Number(params.id), locals);
	const editable = mayEdit(user, report);
	const working = mayWork(user, report);
	const canLink = linkReady(report.status) && can(user.role, 'tagesberichte.kundenlink');
	// Aufträge zur Auswahl – nur wer ändern darf, braucht sie
	const orders = editable ? await linkableOrders(user, report.orderId) : [];
	return {
		report,
		places: await recentPlaces(),
		orders,
		// Je Auftrag seine Positionen – daraus wird die Bezeichnung einer Zeile gewählt
		orderLines: await orderLineChoices(orders.map((o) => o.id)),
		photos: await listPhotos(report.id),
		// Fotos ändern nichts, was der Kunde unterschreibt – sie gehen, solange am Bericht gearbeitet wird
		canPhotos: working,
		// Die Artikelauswahl braucht nur, wer auch eintragen darf
		products: editable ? await materialProducts() : [],
		// Einheiten der LB-Spalten – aus den Stammdaten
		units: editable ? await unitOptions() : [],
		editable,
		canDelete: report.status === 'entwurf' && editable && can(user.role, 'tagesberichte.loeschen'),
		canRelease: report.status === 'entwurf' && working && can(user.role, 'tagesberichte.freigeben'),
		// Vor der Prüfung kann der Kunde auf der Baustelle am Gerät unterschreiben
		canSignOnSite: working && !report.customerSignature,
		canRemoveCustomer: working && !!report.customerSignature,
		canCheck: report.status === 'freigegeben' && can(user.role, 'tagesberichte.pruefen'),
		canUncheck: report.status === 'geprueft' && can(user.role, 'tagesberichte.pruefung.zuruecknehmen'),
		canReopen: mayReopen(user.role, report.status),
		canLink,
		mailConfigured: isMailConfigured(),
		customerUrl: canLink && report.customerToken ? `${url.origin}/bericht/${report.customerToken}` : null
	};
};

/**
 * Das Formular auslesen. Spalten, Mengen und Materialzeilen kommen je Feld in
 * der Reihenfolge der Seite – sie werden über ihre Position zusammengesetzt.
 */
function readReport(form: FormData): SaveReport | { message: string } {
	const all = (name: string) => form.getAll(name).map(String);
	const lbPos = all('pos.lbpos');
	const units = all('pos.einheit');
	const totals = all('pos.gesamt');
	const positions = lbPos.map((p, i) => ({ lbPos: p, unit: units[i] ?? '', totalQuantity: totals[i] ?? '' }));

	// Zeilen kommen als zeile.<laufende Nummer>.* ; "neu" statt einer ID heißt: neue Zeile
	const indexes = new Set<string>();
	for (const key of form.keys()) {
		const m = key.match(/^zeile\.([^.]+)\.id$/);
		if (m) indexes.add(m[1]);
	}
	const rows = [...indexes]
		.sort((a, b) => Number(a) - Number(b))
		.map((i) => {
			const raw = String(form.get(`zeile.${i}.id`) ?? '');
			const id = raw === 'neu' || raw === '' ? null : Number(raw);
			return {
				id: Number.isInteger(id) ? id : null,
				label: String(form.get(`zeile.${i}.text`) ?? ''),
				quantities: all(`zeile.${i}.menge`)
			};
		});

	const products = all('material.artikel');
	const names = all('material.name');
	const codes = all('material.nr');
	const thickness = all('material.dicke');
	const materials = names.map((material, i) => {
		const product = Number(products[i]);
		return {
			productId: products[i] && Number.isInteger(product) ? product : null,
			material,
			code: codes[i] ?? '',
			filmThickness: thickness[i] ?? ''
		};
	});

	const date = String(form.get('datum') ?? '');
	const range = checkDateRange(date, String(form.get('datum_bis') ?? ''));
	if ('message' in range) return range;

	const order = Number(form.get('auftrag'));
	return {
		head: {
			number: String(form.get('nummer') ?? ''),
			date,
			dateTo: range.dateTo,
			orderId: Number.isInteger(order) && order > 0 ? order : null,
			road: String(form.get('strasse') ?? ''),
			site: String(form.get('baustelle') ?? ''),
			costCenter: String(form.get('kostenstelle') ?? ''),
			dailyOutput: String(form.get('tagesleistung') ?? ''),
			lvPosition: String(form.get('lvposition') ?? ''),
			note: String(form.get('notiz') ?? '')
		},
		positions,
		rows,
		materials
	};
}

/** Nur ein Auftrag, den dieser Benutzer sieht – der schon verknüpfte bleibt erlaubt */
async function orderProblem(user: SessionUser, data: SaveReport, current: number | null): Promise<string | null> {
	const id = data.head.orderId;
	if (id == null || id === current) return null;
	const allowed = await linkableOrders(user, current);
	return allowed.some((o) => o.id === id) ? null : 'Diesen Auftrag gibt es nicht (mehr) – bitte neu wählen.';
}

/** Was im Formular steht, vor einem Statuswechsel speichern – nur wenn es mitkam und geändert werden darf */
async function saveIfEditable(form: FormData, report: { id: number; orderId: number | null }, editable: boolean, user: SessionUser) {
	if (!editable || !form.has('datum')) return null;
	const data = readReport(form);
	if ('message' in data) return fail(400, data);
	const problem = await orderProblem(user, data, report.orderId);
	if (problem) return fail(400, { message: problem });
	await saveReport(report.id, data);
	return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (!mayEdit(user, report)) return fail(403, { message: 'Dieser Bericht ist nicht (mehr) änderbar.' });
		const data = readReport(await request.formData());
		if ('message' in data) return fail(400, data);
		const problem = await orderProblem(user, data, report.orderId);
		if (problem) return fail(400, { message: problem });
		await saveReport(report.id, data);
		return { saved: true };
	},

	/** Freigeben geht nur mit Unterschrift – sie steht im Ausdruck bei „Für den Auftragnehmer" */
	release: async ({ params, request, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (report.status !== 'entwurf') return fail(400, { message: 'Dieser Bericht ist bereits freigegeben.' });
		if (!can(user.role, 'tagesberichte.freigeben') || !mayWork(user, report)) {
			return fail(403, { message: 'Freigeben darf nur, wer den Bericht auch erfassen darf.' });
		}
		const form = await request.formData();
		const signature = String(form.get('unterschrift') ?? '').trim();
		if (!signature) return fail(400, { message: 'Bitte unterschreiben – ohne Unterschrift wird der Bericht nicht freigegeben.' });
		if (!isValidSignature(signature)) {
			return fail(400, { message: 'Die Unterschrift konnte nicht gelesen werden – bitte neu unterschreiben.' });
		}
		// Hat der Kunde schon vor Ort unterschrieben, ist der Inhalt gesperrt und wird nicht gespeichert
		const invalid = await saveIfEditable(form, report, mayEdit(user, report), user);
		if (invalid) return invalid;
		await releaseReport(report.id, user.id, signature);
		notifyReport('tagesbericht.freigegeben', report.id, user.id);
		return { released: true };
	},

	/** Prüfen – wer prüft, darf vorher noch korrigieren; das wird dabei gespeichert */
	check: async ({ params, request, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (!can(user.role, 'tagesberichte.pruefen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		if (report.status !== 'freigegeben') return fail(400, { message: 'Geprüft werden kann nur ein freigegebener Bericht.' });
		const invalid = await saveIfEditable(await request.formData(), report, mayEdit(user, report), user);
		if (invalid) return invalid;
		// Mit der Unterschrift des Kunden vor Ort ist der Bericht damit fertig
		const status = await checkReport(report.id, user.id);
		return { checked: true, done: status === 'abgeschlossen' };
	},

	/**
	 * Der Kunde unterschreibt auf der Baustelle am Gerät. Was im Formular steht,
	 * wird vorher gespeichert – danach ist der Inhalt gesperrt.
	 */
	kundeVorOrt: async ({ params, request, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (!mayWork(user, report)) return fail(403, { message: 'Vor Ort unterschreiben geht nur vor der Prüfung.' });
		if (report.customerSignature) return fail(400, { message: 'Der Kunde hat bereits unterschrieben.' });
		const form = await request.formData();
		const name = String(form.get('kunde_name') ?? '').trim().replace(/\s+/g, ' ');
		const signature = String(form.get('kunde_unterschrift') ?? '').trim();
		if (name.length < 2 || name.length > 120) return fail(400, { message: 'Bitte den Namen des Kunden eintragen.' });
		if (!isValidSignature(signature)) return fail(400, { message: 'Die Unterschrift des Kunden fehlt oder war nicht lesbar.' });
		const invalid = await saveIfEditable(form, report, mayEdit(user, report), user);
		if (invalid) return invalid;
		if (!(await customerSignOnSite(report.id, name, signature))) {
			return fail(409, { message: 'Der Bericht wurde inzwischen geändert – bitte die Seite neu laden.' });
		}
		notifyReport('tagesbericht.unterschrieben', report.id, user.id);
		return { customerSigned: true };
	},

	/** Unterschrift des Kunden vor der Prüfung entfernen – danach lässt sich der Bericht wieder ändern */
	kundeEntfernen: async ({ params, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (!mayWork(user, report)) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		await removeCustomerSignature(report.id);
		return { customerRemoved: true };
	},

	uncheck: async ({ params, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (!can(user.role, 'tagesberichte.pruefung.zuruecknehmen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		if (report.status !== 'geprueft') return fail(400, { message: 'Dieser Bericht ist nicht (mehr) geprüft.' });
		await undoCheck(report.id);
		return { unchecked: true };
	},

	/** Wieder öffnen nur mit dem Recht für den jeweiligen Status */
	reopen: async ({ params, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (report.status === 'entwurf') return { reopened: true };
		if (!mayReopen(user.role, report.status)) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		await reopenReport(report.id);
		notifyReport('tagesbericht.geoeffnet', report.id, user.id);
		return { reopened: true };
	},

	delete: async ({ params, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (report.status !== 'entwurf' || !mayEdit(user, report) || !can(user.role, 'tagesberichte.loeschen')) {
			return fail(403, { message: 'Nur Berichte in Arbeit können gelöscht werden – und nur mit dem Recht zum Löschen.' });
		}
		await deleteReport(report.id);
		redirect(303, '/tagesberichte');
	},

	/** Link für den Kunden anlegen (falls ein alter Bericht noch keinen hat) */
	link: async ({ params, locals }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (!linkReady(report.status) || !can(user.role, 'tagesberichte.kundenlink')) {
			return fail(403, { message: 'Den Link gibt es erst nach der Prüfung.' });
		}
		await ensureCustomerToken(report.id);
		return { linked: true };
	},

	/** Link per E-Mail an den Kunden – mit dem Absender der App */
	sendLink: async ({ params, request, locals, url }) => {
		const { user, report } = await open(Number(params.id), locals);
		if (!linkReady(report.status) || !can(user.role, 'tagesberichte.kundenlink')) {
			return fail(403, { message: 'Den Link gibt es erst nach der Prüfung.' });
		}
		const email = String((await request.formData()).get('email') ?? '').trim();
		if (!EMAIL.test(email) || email.length > 200) return fail(400, { message: 'Bitte eine gültige E-Mail-Adresse eintragen.', email });
		if (!isMailConfigured()) return fail(400, { message: 'Der E-Mail-Versand ist nicht eingerichtet – bitte den Link kopieren oder teilen.', email });
		const token = await ensureCustomerToken(report.id);
		const ok = await sendMail(
			customerReportMail(
				email,
				{ number: report.number, date: report.date, dateTo: report.dateTo, road: report.road, site: report.site, signed: report.status === 'abgeschlossen' },
				`${url.origin}/bericht/${token}`
			)
		);
		if (!ok) return fail(500, { message: 'Die E-Mail konnte nicht verschickt werden – bitte später noch einmal versuchen.', email });
		await markLinkSent(report.id, email);
		return { sent: email };
	}
};
