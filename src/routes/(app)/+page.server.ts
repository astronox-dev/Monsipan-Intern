/**
 * Übersicht: was heute zu tun ist und die wichtigsten Zahlen je Bereich –
 * jeweils nur, was diese Person sehen darf. Ein Bereich ohne Recht fehlt ganz
 * (und wird gar nicht erst abgefragt).
 */
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { locations, movements, products, stock } from '$lib/server/db/schema';
import { lowStockProducts } from '$lib/modules/lager/server/alerts';
import { requireUser } from '$lib/server/guard';
import type { SessionUser } from '$lib/server/auth';
import { consumptionByMonth, listMovements } from '$lib/modules/lager/server/movements';
import { countInquiries } from '$lib/modules/auftraege/server/inquiries';
import { offerCounts } from '$lib/modules/auftraege/server/offers';
import { countOrders, listOrders } from '$lib/modules/auftraege/server/orders';
import { countInvoices, openGrossTotal, ordersToInvoice } from '$lib/modules/auftraege/server/invoices';
import { reportCounts } from '$lib/modules/tagesberichte/server/reports';
import { countReleased, maySeeTimesheets, seesOthers, weekOverview, type WeekRow } from '$lib/modules/stunden/server/timesheets';
import { addDays, isoWeek, mondayOf, today } from '$lib/modules/stunden/week';
import { partyOnDay, todayForParty } from '$lib/modules/planung/server/plan';
import { countOpenLeave } from '$lib/modules/planung/server/urlaub';
import { sickCounts } from '$lib/modules/planung/server/krank';
import { can, type Permission } from '$lib/permissions';
import type { PageServerLoad } from './$types';

/** Ein Punkt in „Zu erledigen": was, wie viele, wohin – und wie dringend */
export interface Todo {
	key: string;
	label: string;
	count: number;
	href: string;
	tone: 'danger' | 'warn' | 'info';
}

async function lagerData(user: SessionUser) {
	if (!can(user.role, 'lager.bestand.sehen')) return null;
	// Bewegungen und Auswertungen nur für Rollen, die sie sehen dürfen
	const showMovements = can(user.role, 'lager.bewegungen.sehen');
	const showReports = can(user.role, 'lager.berichte.sehen');
	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);

	const [productCount, units, locationCount, todayCount, low, consumption, recent] = await Promise.all([
		db.select({ n: sql<number>`count(*)` }).from(products).where(eq(products.active, true)).get(),
		db.select({ n: sql<number>`coalesce(sum(${stock.quantity}), 0)` }).from(stock).get(),
		db
			.select({ n: sql<number>`count(distinct ${stock.locationId})` })
			.from(stock)
			.innerJoin(locations, eq(locations.id, stock.locationId))
			.where(sql`${stock.quantity} > 0`)
			.get(),
		showMovements
			? db
					.select({ n: sql<number>`count(*)` })
					.from(movements)
					.where(and(gte(movements.createdAt, startOfDay), isNull(movements.cancelledAt)))
					.get()
			: null,
		lowStockProducts(),
		showReports ? consumptionByMonth(6) : null,
		showMovements ? listMovements({}, 8) : null
	]);
	return {
		kpi: {
			products: Number(productCount?.n ?? 0),
			units: Number(units?.n ?? 0),
			locations: Number(locationCount?.n ?? 0),
			today: todayCount ? Number(todayCount.n ?? 0) : null,
			low: low.length
		},
		low: low.slice(0, 6),
		consumption,
		recent
	};
}

async function auftragData(user: SessionUser, day: string) {
	const has = (p: Permission) => can(user.role, p);
	const sees = { anfragen: has('anfragen.sehen'), angebote: has('angebote.sehen'), auftraege: has('auftraege.sehen'), rechnungen: has('rechnungen.sehen') };
	if (!Object.values(sees).some(Boolean)) return null;
	const [inquiries, offers, orders, running, invoices, openInvoices, toInvoice] = await Promise.all([
		sees.anfragen ? countInquiries() : null,
		sees.angebote ? offerCounts() : null,
		sees.auftraege ? countOrders(user) : null,
		sees.auftraege ? listOrders(user, { status: 'offen' }, 6) : null,
		sees.rechnungen ? countInvoices(day) : null,
		sees.rechnungen ? openGrossTotal() : null,
		has('rechnungen.erstellen') ? ordersToInvoice() : null
	]);
	const openGross = openInvoices ?? 0;
	return {
		inquiries,
		offers,
		orders,
		running,
		invoices: invoices ? { ...invoices, openGross } : null,
		toInvoice: toInvoice ? toInvoice.length : null
	};
}

/** Zettel einer Woche: wie viele es gibt, wie viele freigegeben und wie viele noch offen sind */
const sheetStats = (rows: WeekRow[]) => ({
	total: rows.length,
	released: rows.filter((r) => r.status === 'freigegeben' || r.status === 'geprueft').length,
	open: rows.filter((r) => !r.status || r.status === 'entwurf').length
});

async function dokuData(user: SessionUser, monday: string) {
	const has = (p: Permission) => can(user.role, p);
	const seesReports = has('tagesberichte.sehen');
	const seesSheets = maySeeTimesheets(user);
	if (!seesReports && !seesSheets) return null;
	// Wer selbst freigibt (und nicht prüft), bekommt einen Hinweis auf die Vorwoche
	const lastWeekMonday = addDays(monday, -7);
	const writes = seesOthers(user) && has('stunden.freigeben') && !has('stunden.pruefen');
	const [reports, thisWeek, lastWeek, released] = await Promise.all([
		seesReports ? reportCounts(user, monday) : null,
		seesSheets ? weekOverview(user, monday) : null,
		writes ? weekOverview(user, lastWeekMonday) : null,
		has('stunden.pruefen') ? countReleased(user) : null
	]);
	const own = thisWeek?.filter((r) => r.user.id === user.id) ?? [];
	return {
		reports,
		sheets: thisWeek
			? {
					...sheetStats(thisWeek),
					others: seesOthers(user),
					// Für alle, die nur den eigenen sehen: der Stand des eigenen Zettels
					own: own.length ? (own.find((r) => r.status === 'entwurf' || !r.status)?.status ?? own[0].status) : undefined
				}
			: null,
		lastWeekOpen: lastWeek ? sheetStats(lastWeek).open : null,
		lastWeekMonday,
		released
	};
}

/** Planung: was die eigene Partie heute vorhat, offene Urlaubsanträge, Krankenstände ohne Beleg */
async function planData(user: SessionUser, day: string) {
	// Wer heute laut Planung bei einer anderen Partie aushilft, sieht deren Tag
	const party = can(user.role, 'planung.sehen') ? await partyOnDay(user.id, user.partyId, day) : null;
	const today = party ? await todayForParty(party, day) : null;
	const [openLeave, sick] = await Promise.all([
		can(user.role, 'urlaub.genehmigen') ? countOpenLeave() : null,
		can(user.role, 'krankenstand.alle.sehen') ? sickCounts(day) : null
	]);
	return { today, openLeave, sick };
}

export const load: PageServerLoad = async ({ depends, locals }) => {
	depends('app:stock');
	const user = requireUser(locals);
	const has = (p: Permission) => can(user.role, p);
	const day = today();
	const monday = mondayOf(day);

	const [lager, auftrag, doku, plan] = await Promise.all([lagerData(user), auftragData(user, day), dokuData(user, monday), planData(user, day)]);

	// Zu erledigen – das Dringendste zuerst, nur was diese Person auch angehen darf
	const todos: Todo[] = [];
	const add = (show: boolean, count: number | null | undefined, t: Omit<Todo, 'count'>) => {
		if (show && count) todos.push({ ...t, count });
	};
	add(!!auftrag?.invoices, auftrag?.invoices?.overdue, { key: 'ueberfaellig', label: 'Rechnungen überfällig', href: '/rechnungen?stand=ueberfaellig', tone: 'danger' });
	add(true, auftrag?.toInvoice, { key: 'abrechnen', label: 'Aufträge abgeschlossen – Rechnung schreiben', href: '/rechnungen', tone: 'warn' });
	add(has('angebote.bearbeiten'), auftrag?.offers?.aenderung, { key: 'aenderung', label: 'Änderungswunsch zu Angeboten', href: '/angebote?status=aenderung', tone: 'warn' });
	add(has('auftraege.erstellen'), auftrag?.offers?.acceptedWithoutOrder, {
		key: 'auftrag',
		label: 'Angebote angenommen – Auftrag erstellen',
		href: '/angebote?status=angenommen',
		tone: 'warn'
	});
	add(has('anfragen.bearbeiten') || has('angebote.erstellen'), auftrag?.inquiries?.fresh, { key: 'anfragen', label: 'Anfragen ohne Angebot', href: '/anfragen', tone: 'info' });
	add(has('tagesberichte.pruefen'), doku?.reports?.freigegeben, { key: 'tb-pruefen', label: 'Tagesberichte zu prüfen', href: '/tagesberichte?stand=freigegeben', tone: 'warn' });
	add(has('tagesberichte.freigeben') && !has('tagesberichte.pruefen'), doku?.reports?.entwurf, {
		key: 'tb-offen',
		label: 'Tagesberichte noch nicht freigegeben',
		href: '/tagesberichte?stand=entwurf',
		tone: 'info'
	});
	add(has('tagesberichte.kundenlink'), doku?.reports?.geprueft, { key: 'tb-kunde', label: 'Tagesberichte – Unterschrift des Kunden offen', href: '/tagesberichte?stand=geprueft', tone: 'info' });
	add(true, doku?.released, { key: 'sz-pruefen', label: 'Stundenzettel zu prüfen', href: '/stundenzettel', tone: 'warn' });
	add(true, doku?.lastWeekOpen, { key: 'sz-vorwoche', label: 'Stundenzettel der Vorwoche noch nicht freigegeben', href: `/stundenzettel?woche=${doku?.lastWeekMonday}`, tone: 'warn' });
	add(has('urlaub.genehmigen'), plan.openLeave, { key: 'urlaub', label: 'Urlaubsanträge zu entscheiden', href: '/urlaub', tone: 'warn' });
	add(has('krankenstand.bearbeiten'), plan.sick?.withoutDoc, { key: 'krankmeldung', label: 'Krankenstände ohne Krankmeldung', href: '/krankenstand', tone: 'info' });
	add(has('auftraege.status') && !has('auftraege.bearbeiten'), auftrag?.orders?.erstellt, { key: 'auftraege-neu', label: 'Neue Aufträge', href: '/auftraege?status=erstellt', tone: 'info' });
	// Nachbestellen ist Sache derer, die den Hinweis auf den Mindestbestand bekommen
	add(!!lager && has('lager.warnungen.sehen'), lager?.kpi.low, {
		key: 'nachbestellen',
		label: 'Artikel nachbestellen',
		href: has('lager.berichte.sehen') ? '/lager/bestellliste' : '/lager/bestand?status=nachbestellen',
		tone: 'warn'
	});

	return { todos, lager, auftrag, doku, plan, week: isoWeek(monday).week };
};
