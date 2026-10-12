/**
 * Rechnungen zum Auftrag: Preise aus dem Angebot, Mengen aus den gewählten
 * Tagesberichten; welche Spalte zu welcher Angebotsposition gehört, merkt sich
 * der Auftrag. Entweder eine Rechnung über alles oder nach und nach
 * Teilrechnungen – jeder geprüfte Bericht wird genau einmal abgerechnet. Die
 * erste Rechnung trägt die Nummer des Auftrags, weitere „-2", „-3" …
 *
 * Eine Rechnung beginnt als Entwurf – nur dann lässt sie sich ändern oder
 * löschen. Endgültig ausgestellt wird sie archiviert und signiert (siehe
 * signatur/signing.ts); Korrekturen gehen dann nur noch über ein Storno.
 * Unabhängig davon ist sie offen, bis sie als bezahlt markiert wird.
 */
import { and, asc, desc, eq, gt, inArray, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db, type Tx } from '$lib/server/db';
import {
	dailyReports,
	invoicePositions,
	invoices,
	offerPositions,
	offers,
	orderPositions,
	orders,
	users,
	type InvoiceKind,
	type InvoiceStatus
} from '$lib/server/db/schema';
import { col } from '$lib/server/db/sql';
import { getSettings } from '$lib/server/settings';
import type { SessionUser } from '$lib/server/auth';
import { addDays, isValidIsoDate, today } from '$lib/modules/stunden/week';
import { notify } from '$lib/server/notifications';
import { date as dateLabel } from '$lib/format';
import { lineNumbers, MAX_OFFER_LINES, money, parseAmount, round2, spacedNumber } from '../offer';
import {
	billedLines,
	COUNTED_STATUS,
	invoiceLines,
	nextInvoiceNumber,
	selectedColumns,
	selectedPeriod,
	suggestKind,
	suggestMapping,
	unitFamily,
	OWN_LINE,
	type Mapping,
	type MappingTarget,
	type PricedLine
} from '../summary';
import { orderSummary } from './summary';
import { audit } from './signatur/audit';

const creator = alias(users, 'creator');
const payer = alias(users, 'payer');
const issuer = alias(users, 'issuer');
const canceller = alias(users, 'canceller');
const original = alias(invoices, 'original');
const storno = alias(invoices, 'storno');

/** Zählt für Zahlung und Abrechnung: weder storniert noch selbst eine Stornorechnung */
export const activeInvoice = sql`${invoices.stage} <> 'storniert' and ${invoices.kind} <> 'storno'`;
const activeCol = sql`${col(invoices.stage)} <> 'storniert' and ${col(invoices.kind)} <> 'storno'`;

/** Netto je Rechnung, direkt in der Abfrage */
const netSum = sql<number>`(select coalesce(sum(round(${col(invoicePositions.quantity)} * ${col(invoicePositions.unitPrice)}, 2)), 0) from ${invoicePositions} where ${col(invoicePositions.invoiceId)} = ${col(invoices.id)} and ${col(invoicePositions.kind)} = 'position')`.mapWith(
	Number
);

export interface InvoiceFilter {
	q?: string;
	/** „offen", „ueberfaellig", „bezahlt", „entwurf" oder leer für alle */
	status?: string;
	/** Stichtag für „überfällig" – ohne Angabe heute */
	day?: string;
}

function invoiceWhere(filter: InvoiceFilter): SQL | undefined {
	const where: (SQL | undefined)[] = [];
	if (filter.status === 'offen' || filter.status === 'bezahlt') where.push(eq(invoices.status, filter.status), activeInvoice);
	// Überfällig: offen und „zahlbar bis" vorbei – genau wie das Abzeichen in der Liste
	if (filter.status === 'ueberfaellig') where.push(eq(invoices.status, 'offen'), activeInvoice, lt(invoices.dueDate, filter.day ?? today()));
	if (filter.status === 'entwurf') where.push(eq(invoices.stage, 'entwurf'));
	if (filter.q?.trim()) {
		const q = `%${filter.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(or(like(invoices.number, q), like(invoices.title, q), like(invoices.customerName, q), like(invoices.location, q), like(invoices.projectNumber, q)));
	}
	return and(...where);
}

/** Wie viele Rechnungen der Filter trifft – zum Blättern */
export async function countListed(filter: InvoiceFilter = {}): Promise<number> {
	const row = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(invoices).where(invoiceWhere(filter)).get();
	return row?.n ?? 0;
}

/** Summe aller offenen Beträge (brutto) – unabhängig davon, wie viele es sind */
export async function openGrossTotal(): Promise<number> {
	const row = await db
		.select({
			gross: sql<number>`coalesce(sum(round(${netSum} * (1 + (case when ${invoices.reverseCharge} then 0 else ${invoices.vatRate} end) / 100.0), 2)), 0)`.mapWith(Number)
		})
		.from(invoices)
		.where(and(eq(invoices.status, 'offen'), activeInvoice))
		.get();
	return round2(row?.gross ?? 0);
}

export async function listInvoices(filter: InvoiceFilter = {}, limit = 300, offset = 0) {
	return db
		.select({
			id: invoices.id,
			number: invoices.number,
			kind: invoices.kind,
			date: invoices.date,
			dueDate: invoices.dueDate,
			title: invoices.title,
			customerName: invoices.customerName,
			customerCity: invoices.customerCity,
			status: invoices.status,
			stage: invoices.stage,
			paidOn: invoices.paidOn,
			vatRate: invoices.vatRate,
			reverseCharge: invoices.reverseCharge,
			net: netSum
		})
		.from(invoices)
		.where(invoiceWhere(filter))
		// Offene nach Fälligkeit, bezahlte nach Datum
		.orderBy(sql`case ${invoices.status} when 'offen' then 0 else 1 end`, sql`case ${invoices.status} when 'offen' then ${invoices.dueDate} end`, desc(invoices.date), desc(invoices.id))
		.limit(limit)
		.offset(offset)
		.all();
}

export async function countInvoices(day = today()) {
	const row = await db
		.select({
			open: sql<number>`sum(case when ${invoices.status} = 'offen' and ${activeInvoice} then 1 else 0 end)`.mapWith(Number),
			paid: sql<number>`sum(case when ${invoices.status} = 'bezahlt' and ${activeInvoice} then 1 else 0 end)`.mapWith(Number),
			overdue: sql<number>`sum(case when ${invoices.status} = 'offen' and ${activeInvoice} and ${invoices.dueDate} < ${day} then 1 else 0 end)`.mapWith(Number),
			drafts: sql<number>`sum(case when ${invoices.stage} = 'entwurf' then 1 else 0 end)`.mapWith(Number),
			all: sql<number>`count(*)`.mapWith(Number)
		})
		.from(invoices)
		.get();
	return { open: row?.open ?? 0, paid: row?.paid ?? 0, overdue: row?.overdue ?? 0, drafts: row?.drafts ?? 0, all: row?.all ?? 0 };
}

/** Geprüft, aber auf keiner Rechnung – als SQL für Unterabfragen je Auftrag */
const unbilledReport = sql`exists (select 1 from ${dailyReports} where ${col(dailyReports.orderId)} = ${col(orders.id)} and ${col(dailyReports.status)} in (${sql.join(
	COUNTED_STATUS.map((s) => sql`${s}`),
	sql`, `
)}) and ${col(dailyReports.invoiceId)} is null)`;

/**
 * Abgeschlossene Aufträge, bei denen noch etwas abzurechnen ist: ohne
 * Rechnung oder mit geprüften Tagesberichten, die auf keiner Rechnung stehen.
 */
export function ordersToInvoice() {
	return db
		.select({ id: orders.id, number: orders.number, title: orders.title, customerName: orders.customerName, location: orders.location, statusAt: orders.statusAt })
		.from(orders)
		.where(
			and(
				eq(orders.status, 'abgeschlossen'),
				or(sql`not exists (select 1 from ${invoices} where ${col(invoices.orderId)} = ${col(orders.id)} and ${activeCol})`, unbilledReport)
			)
		)
		.orderBy(asc(orders.statusAt))
		.limit(100)
		.all();
}

/** Alle Rechnungen zum Auftrag, in der Reihenfolge, in der sie geschrieben wurden */
export async function invoicesForOrder(orderId: number) {
	const rows = await db
		.select({
			id: invoices.id,
			number: invoices.number,
			kind: invoices.kind,
			date: invoices.date,
			status: invoices.status,
			stage: invoices.stage,
			vatRate: invoices.vatRate,
			reverseCharge: invoices.reverseCharge,
			net: netSum,
			reports: sql<number>`(select count(*) from ${dailyReports} where ${col(dailyReports.invoiceId)} = ${col(invoices.id)})`.mapWith(Number)
		})
		.from(invoices)
		.where(eq(invoices.orderId, orderId))
		.orderBy(asc(invoices.id))
		.all();
	return rows.map((r) => ({ ...r, gross: grossOf(r) }));
}

/**
 * Kann zum Auftrag (noch) eine Rechnung geschrieben werden? Die erste geht ab
 * „in Arbeit" (als Teilrechnung) bzw. nach dem Abschluss auch ohne Berichte;
 * jede weitere braucht geprüfte Berichte, die noch auf keiner Rechnung stehen.
 * Gibt null zurück, wenn es geht – sonst den Grund.
 */
export function invoiceBlocker(s: { status: string; previous: number; available: number }): string | null {
	if (s.status === 'erstellt') return 'Rechnungen gibt es, sobald der Auftrag in Arbeit ist.';
	if (s.available) return null;
	if (s.previous) return 'Alle geprüften Tagesberichte sind schon abgerechnet.';
	if (s.status !== 'abgeschlossen') return 'Für eine Teilrechnung braucht es mindestens einen geprüften Tagesbericht.';
	return null;
}

/** Geprüfte Berichte des Auftrags, die noch auf keiner Rechnung stehen */
export async function unbilledReports(orderId: number): Promise<number> {
	const row = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(dailyReports)
		.where(and(eq(dailyReports.orderId, orderId), inArray(dailyReports.status, [...COUNTED_STATUS] as never[]), isNull(dailyReports.invoiceId)))
		.get();
	return row?.n ?? 0;
}

/** Rechnungsstand je Auftrag – für die Liste der Aufträge: offen, solange eine offen ist */
export async function invoiceStates(orderIds: number[]): Promise<Record<number, InvoiceStatus>> {
	if (!orderIds.length) return {};
	const rows = await db
		.select({ orderId: invoices.orderId, status: invoices.status })
		.from(invoices)
		.where(and(inArray(invoices.orderId, orderIds), activeInvoice))
		.all();
	const out: Record<number, InvoiceStatus> = {};
	for (const r of rows) {
		if (r.orderId == null) continue;
		if (out[r.orderId] !== 'offen') out[r.orderId] = r.status;
	}
	return out;
}

/* ------------------------------------------------------------ Entwurf */

/**
 * Pauschalen, die schon auf einer früheren Rechnung zum Auftrag stehen – die
 * kommen nicht von selbst noch einmal. Erkannt an der Positionsnummer.
 */
async function flatBilledLines(invoiceIds: number[], lines: PricedLine[]): Promise<number[]> {
	if (!invoiceIds.length) return [];
	const billed = await db
		.select({ number: invoicePositions.number })
		.from(invoicePositions)
		.where(and(inArray(invoicePositions.invoiceId, invoiceIds), eq(invoicePositions.kind, 'position'), gt(invoicePositions.quantity, 0)))
		.all();
	const numbers = lineNumbers(lines);
	const done = new Set(billed.map((b) => b.number));
	return lines.filter((l, i) => l.kind === 'position' && unitFamily(l.unit) === 'pauschal' && done.has(numbers[i])).map((l) => l.id);
}

/**
 * Alles für eine neue Rechnung zum Auftrag: Positionen mit Preisen aus dem
 * Angebot (ohne Angebot die des Auftrags, ohne Preise), die Tagesberichte, die
 * noch abzurechnen sind (alle vorgewählt), die vorgeschlagene Zuordnung und die
 * Vorgaben für Kopf und Texte. `blocked` sagt, warum es gerade keine gibt.
 */
export async function invoiceDraft(orderId: number) {
	const order = await db.select().from(orders).where(eq(orders.id, orderId)).get();
	if (!order) return null;
	const offer = order.offerId ? await db.select().from(offers).where(eq(offers.id, order.offerId)).get() : undefined;
	const lines: PricedLine[] = offer
		? await db
				.select({
					id: offerPositions.id,
					kind: offerPositions.kind,
					text: offerPositions.text,
					quantity: offerPositions.quantity,
					unit: offerPositions.unit,
					unitPrice: offerPositions.unitPrice
				})
				.from(offerPositions)
				.where(eq(offerPositions.offerId, offer.id))
				.orderBy(asc(offerPositions.sortOrder), asc(offerPositions.id))
				.all()
		: (
				await db
					.select({ id: orderPositions.id, kind: orderPositions.kind, text: orderPositions.text, quantity: orderPositions.quantity, unit: orderPositions.unit })
					.from(orderPositions)
					.where(eq(orderPositions.orderId, orderId))
					.orderBy(asc(orderPositions.sortOrder), asc(orderPositions.id))
					.all()
			).map((l) => ({ ...l, unitPrice: null }));
	const [summary, settings, previous] = await Promise.all([
		orderSummary(orderId),
		getSettings(),
		db
			.select({ id: invoices.id, number: invoices.number, kind: invoices.kind, date: invoices.date, status: invoices.status, state: invoices.state, section: invoices.section })
			.from(invoices)
			.where(and(eq(invoices.orderId, orderId), activeInvoice))
			.orderBy(asc(invoices.id))
			.all()
	]);
	// Zur Wahl stehen die geprüften Berichte, die noch auf keiner Rechnung stehen – vorgewählt sind alle
	const reports = summary.reports.filter((r) => r.counted && r.invoiceId == null);
	const all = new Set(reports.map((r) => r.id));
	const columns = selectedColumns(
		summary.columns.filter((c) => reports.some((r) => r.values[c.key] != null)),
		reports,
		all
	);
	const pending = summary.reports.filter((r) => !r.counted).length;
	const period = selectedPeriod(reports, all);
	const last = previous.at(-1);
	const date = today();
	return {
		order: {
			id: order.id,
			number: order.number,
			title: order.title,
			status: order.status,
			partyId: order.partyId,
			offerId: order.offerId,
			offerNumber: offer?.number ?? null
		},
		lines,
		columns,
		reports,
		pending,
		previous,
		flatBilled: await flatBilledLines(
			previous.map((p) => p.id),
			lines
		),
		blocked: invoiceBlocker({ status: order.status, previous: previous.length, available: reports.length }),
		mapping: suggestMapping(columns, lines, order.invoiceMapping),
		head: {
			kind: suggestKind({ closed: order.status === 'abgeschlossen', previous: previous.length, available: reports.length, selected: reports.length, pending }) as Exclude<InvoiceKind, 'storno'>,
			// Bundesland und Abschnitt wie auf der letzten Rechnung zum Auftrag
			state: last?.state ?? '',
			section: last?.section ?? '',
			date,
			dueDate: addDays(date, settings.invoicePaymentDays),
			serviceFrom: period?.from ?? '',
			serviceTo: period?.to ?? '',
			projectNumber: order.projectNumber,
			title: order.title,
			location: order.location,
			customerName: offer?.customerName ?? order.customerName,
			customerAddition: offer?.customerAddition ?? order.customerAddition,
			customerStreet: offer?.customerStreet ?? order.customerStreet,
			customerZip: offer?.customerZip ?? order.customerZip,
			customerCity: offer?.customerCity ?? order.customerCity,
			customerUid: offer?.customerUid ?? '',
			intro: settings.invoiceIntro,
			closing: settings.invoiceClosing,
			vatRate: offer?.vatRate ?? 20,
			reverseCharge: false
		},
		paymentDays: settings.invoicePaymentDays
	};
}

export type InvoiceDraft = NonNullable<Awaited<ReturnType<typeof invoiceDraft>>>;

/** Die vorgeschlagenen Zeilen zum Entwurf – Mengen aller noch offenen Berichte nach der Zuordnung */
export function draftLines(draft: InvoiceDraft, mapping: Mapping = draft.mapping) {
	return invoiceLines(draft.lines, draft.columns, mapping, draft.flatBilled);
}

/* ------------------------------------------------------------ Speichern */

export interface SaveInvoice {
	head: {
		kind: InvoiceKind;
		state: string;
		section: string;
		date: string;
		dueDate: string;
		serviceFrom: string | null;
		serviceTo: string | null;
		title: string;
		location: string;
		projectNumber: string;
		customerName: string;
		customerAddition: string;
		customerStreet: string;
		customerZip: string;
		customerCity: string;
		customerUid: string;
		intro: string;
		closing: string;
		vatRate: number;
		reverseCharge: boolean;
	};
	lines: { number: string; kind: 'position' | 'titel'; text: string; quantity: number | null; unit: string; unitPrice: number | null }[];
}

/**
 * Formular auslesen – Zeilen wie beim Angebot als z.<Nr>.art/text/menge/
 * einheit/preis. Gibt die Daten oder eine Meldung zurück.
 */
export function readInvoice(form: FormData): SaveInvoice | { message: string } {
	const s = (k: string) => String(form.get(k) ?? '');
	const date = s('datum');
	if (!isValidIsoDate(date)) return { message: 'Das Rechnungsdatum ist ungültig.' };
	const dueDate = s('faellig');
	if (!isValidIsoDate(dueDate)) return { message: 'Das Datum „zahlbar bis" ist ungültig.' };
	if (dueDate < date) return { message: '„Zahlbar bis" liegt vor dem Rechnungsdatum.' };
	const from = s('von').trim();
	const to = s('bis').trim();
	if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to))) return { message: 'Der Leistungszeitraum ist ungültig.' };
	if (from && to && to < from) return { message: 'Der Leistungszeitraum endet vor seinem Beginn.' };
	const vat = parseAmount(s('ust'));
	if (vat == null || vat < 0 || vat > 100) return { message: 'Die Umsatzsteuer stimmt nicht.' };

	const indexes = new Set<number>();
	for (const key of form.keys()) {
		const m = /^z\.(\d+)\.art$/.exec(key);
		if (m) indexes.add(Number(m[1]));
	}
	const lines: SaveInvoice['lines'] = [];
	for (const [n, i] of [...indexes].sort((a, b) => a - b).entries()) {
		const titel = s(`z.${i}.art`) === 'titel';
		const text = s(`z.${i}.text`).replace(/\r\n/g, '\n').trim();
		const number = s(`z.${i}.nr`).trim().slice(0, 12);
		if (titel) {
			lines.push({ number, kind: 'titel', text, quantity: null, unit: '', unitPrice: null });
			continue;
		}
		const rawQty = s(`z.${i}.menge`).trim();
		const rawPrice = s(`z.${i}.preis`).trim();
		const quantity = parseAmount(rawQty);
		const unitPrice = parseAmount(rawPrice);
		if (rawQty && quantity == null) return { message: `Die Menge in Zeile ${n + 1} ist keine Zahl.` };
		if (rawPrice && unitPrice == null) return { message: `Der Einheitspreis in Zeile ${n + 1} ist keine Zahl.` };
		if (quantity && unitPrice == null) return { message: `In Zeile ${n + 1} fehlt der Einheitspreis.` };
		lines.push({
			number,
			kind: 'position',
			text,
			quantity: quantity == null ? null : Math.round(quantity * 1000) / 1000,
			unit: s(`z.${i}.einheit`).trim(),
			unitPrice: unitPrice == null ? null : Math.round(unitPrice * 10000) / 10000
		});
	}
	const billed = billedLines(lines).slice(0, MAX_OFFER_LINES);
	if (!billed.some((l) => l.kind === 'position')) return { message: 'Die Rechnung hat keine Position mit Menge.' };
	const reverseCharge = form.get('reverse') === 'on';
	const uid = s('k_uid').replace(/\s+/g, '').toUpperCase().slice(0, 30);
	if (reverseCharge && !uid) return { message: 'Für den Übergang der Steuerschuld braucht es die UID-Nummer des Kunden.' };
	const name = s('k_name').trim();
	if (!name) return { message: 'Bitte den Kunden eintragen.' };

	const kind = s('rechnungsart');
	return {
		head: {
			// Stornorechnungen entstehen nur beim Stornieren – nicht aus dem Formular
			kind: kind === 'teilrechnung' ? 'teilrechnung' : 'rechnung',
			state: s('bundesland').trim().slice(0, 60),
			section: s('abschnitt').trim().slice(0, 120),
			date,
			dueDate,
			serviceFrom: from || null,
			serviceTo: to || null,
			title: s('titel').trim().slice(0, 300),
			location: s('ort').trim().slice(0, 300),
			projectNumber: s('projekt').trim().slice(0, 30),
			customerName: name.slice(0, 160),
			customerAddition: s('k_zusatz').trim().slice(0, 160),
			customerStreet: s('k_strasse').trim().slice(0, 160),
			customerZip: s('k_plz').trim().slice(0, 12),
			customerCity: s('k_ort').trim().slice(0, 120),
			customerUid: uid,
			intro: s('einleitung').replace(/\r\n/g, '\n').trimEnd().slice(0, 3000),
			closing: s('schluss').replace(/\r\n/g, '\n').trimEnd().slice(0, 5000),
			vatRate: Math.round(vat * 100) / 100,
			reverseCharge
		},
		lines: billed
	};
}

/** Die angekreuzten Tagesberichte: bericht = ID, mehrfach */
export function readReports(form: FormData): number[] {
	return [...new Set(form.getAll('bericht').map(Number))].filter((n) => Number.isInteger(n) && n > 0);
}

/** Zuordnung aus dem Formular: m.<Schlüssel> = Positions-ID, „nein" oder „eigene" */
export function readMapping(form: FormData, keys: string[]): Record<string, MappingTarget> {
	const out: Record<string, MappingTarget> = {};
	for (const key of keys) {
		const v = String(form.get(`m.${key}`) ?? '');
		if (v === 'nein') out[key] = null;
		else if (v === OWN_LINE) out[key] = OWN_LINE;
		else if (/^\d+$/.test(v)) out[key] = Number(v);
	}
	return out;
}

async function writeLines(tx: Tx, invoiceId: number, lines: SaveInvoice['lines']) {
	await tx.delete(invoicePositions).where(eq(invoicePositions.invoiceId, invoiceId));
	for (const [i, l] of lines.entries()) {
		await tx.insert(invoicePositions).values({
			invoiceId,
			sortOrder: i,
			number: l.number,
			kind: l.kind,
			text: l.text.slice(0, 4000),
			quantity: l.kind === 'titel' ? null : l.quantity,
			unit: l.kind === 'titel' ? '' : l.unit.slice(0, 20),
			unitPrice: l.kind === 'titel' ? null : l.unitPrice
		});
	}
}

/**
 * Rechnung anlegen – die erste mit der Nummer des Auftrags, weitere mit „-2",
 * „-3" … Die gewählten Berichte gelten danach als abgerechnet; die Zuordnung
 * der Spalten merkt sich der Auftrag. Gibt die ID zurück oder eine Meldung.
 */
export async function createInvoice(
	user: SessionUser,
	orderId: number,
	data: SaveInvoice,
	mapping: Record<string, MappingTarget>,
	reportIds: number[]
): Promise<number | { message: string }> {
	return db.transaction(async (tx) => {
		const order = await tx.select().from(orders).where(eq(orders.id, orderId)).get();
		if (!order) return { message: 'Den Auftrag gibt es nicht mehr.' };
		const previous = await tx
			.select({ id: invoices.id })
			.from(invoices)
			.where(and(eq(invoices.orderId, orderId), activeInvoice))
			.all();
		const chosen = reportIds.length
			? await tx
					.select({ id: dailyReports.id, status: dailyReports.status, invoiceId: dailyReports.invoiceId })
					.from(dailyReports)
					.where(and(eq(dailyReports.orderId, orderId), inArray(dailyReports.id, reportIds)))
					.all()
			: [];
		if (chosen.length !== reportIds.length) return { message: 'Ein gewählter Tagesbericht gehört nicht mehr zu diesem Auftrag – bitte neu laden.' };
		if (chosen.some((r) => !COUNTED_STATUS.includes(r.status))) return { message: 'Abgerechnet werden nur geprüfte Tagesberichte.' };
		if (chosen.some((r) => r.invoiceId != null)) return { message: 'Ein gewählter Tagesbericht ist inzwischen abgerechnet – bitte neu laden.' };
		const blocked = invoiceBlocker({ status: order.status, previous: previous.length, available: chosen.length });
		if (blocked) return { message: chosen.length || order.status === 'erstellt' ? blocked : 'Bitte mindestens einen Tagesbericht wählen.' };
		const taken = await tx
			.select({ number: invoices.number })
			.from(invoices)
			.where(or(eq(invoices.number, order.number), like(invoices.number, `${order.number}-%`)))
			.all();
		const offer = order.offerId ? await tx.select({ customerId: offers.customerId }).from(offers).where(eq(offers.id, order.offerId)).get() : undefined;
		const number = nextInvoiceNumber(
			order.number,
			new Set(taken.map((t) => t.number))
		);
		const row = await tx
			.insert(invoices)
			.values({
				number,
				orderId,
				offerId: order.offerId,
				customerId: offer?.customerId ?? null,
				...data.head,
				status: 'offen',
				createdBy: user.id,
				updatedAt: new Date()
			})
			.returning({ id: invoices.id })
			.get();
		await writeLines(tx, row.id, data.lines);
		await audit({ invoiceId: row.id, invoiceNumber: number, user, action: 'erstellt', detail: { art: data.head.kind, tagesberichte: reportIds.length } }, tx);
		if (reportIds.length) await tx.update(dailyReports).set({ invoiceId: row.id }).where(inArray(dailyReports.id, reportIds));
		await tx
			.update(orders)
			.set({ invoiceMapping: { ...(order.invoiceMapping ?? {}), ...mapping }, updatedAt: new Date() })
			.where(eq(orders.id, orderId));
		return row.id;
	});
}

/** Entwurf ändern – ausgestellte und bezahlte bleiben, wie sie sind */
export async function saveInvoice(id: number, data: SaveInvoice): Promise<boolean> {
	return db.transaction(async (tx) => {
		const done = await tx
			.update(invoices)
			// Neues Zahlungsziel: „überfällig" gilt dann wieder neu
			.set({ ...data.head, overdueNotifiedAt: null, updatedAt: new Date() })
			.where(and(eq(invoices.id, id), eq(invoices.status, 'offen'), eq(invoices.stage, 'entwurf')))
			.returning({ id: invoices.id });
		if (!done.length) return false;
		await writeLines(tx, id, data.lines);
		return true;
	});
}

export async function invoiceDetail(id: number) {
	if (!Number.isInteger(id)) return null;
	const invoice = await db
		.select({
			id: invoices.id,
			number: invoices.number,
			kind: invoices.kind,
			state: invoices.state,
			section: invoices.section,
			orderId: invoices.orderId,
			orderNumber: orders.number,
			orderStatus: orders.status,
			offerId: invoices.offerId,
			date: invoices.date,
			serviceFrom: invoices.serviceFrom,
			serviceTo: invoices.serviceTo,
			dueDate: invoices.dueDate,
			projectNumber: invoices.projectNumber,
			title: invoices.title,
			location: invoices.location,
			customerName: invoices.customerName,
			customerAddition: invoices.customerAddition,
			customerStreet: invoices.customerStreet,
			customerZip: invoices.customerZip,
			customerCity: invoices.customerCity,
			customerUid: invoices.customerUid,
			intro: invoices.intro,
			closing: invoices.closing,
			vatRate: invoices.vatRate,
			reverseCharge: invoices.reverseCharge,
			status: invoices.status,
			paidOn: invoices.paidOn,
			paidByFirst: payer.firstName,
			paidByLast: payer.lastName,
			createdAt: invoices.createdAt,
			updatedAt: invoices.updatedAt,
			creatorFirst: creator.firstName,
			creatorLast: creator.lastName,
			stage: invoices.stage,
			issuedAt: invoices.issuedAt,
			issuerFirst: issuer.firstName,
			issuerLast: issuer.lastName,
			verifyToken: invoices.verifyToken,
			retainUntil: invoices.retainUntil,
			signError: invoices.signError,
			checkedAt: invoices.checkedAt,
			checkResult: invoices.checkResult,
			checkDetail: invoices.checkDetail,
			cancelledAt: invoices.cancelledAt,
			cancellerFirst: canceller.firstName,
			cancellerLast: canceller.lastName,
			cancelReason: invoices.cancelReason,
			stornoId: invoices.stornoId,
			stornoNumber: storno.number,
			cancelsId: invoices.cancelsId,
			cancelsNumber: original.number,
			cancelsKind: original.kind,
			cancelsDate: original.date
		})
		.from(invoices)
		.leftJoin(orders, eq(orders.id, invoices.orderId))
		.leftJoin(creator, eq(creator.id, invoices.createdBy))
		.leftJoin(payer, eq(payer.id, invoices.paidBy))
		.leftJoin(issuer, eq(issuer.id, invoices.issuedBy))
		.leftJoin(canceller, eq(canceller.id, invoices.cancelledBy))
		.leftJoin(original, eq(original.id, invoices.cancelsId))
		.leftJoin(storno, eq(storno.id, invoices.stornoId))
		.where(eq(invoices.id, id))
		.get();
	if (!invoice) return null;
	const lines = await db
		.select({
			id: invoicePositions.id,
			number: invoicePositions.number,
			kind: invoicePositions.kind,
			text: invoicePositions.text,
			quantity: invoicePositions.quantity,
			unit: invoicePositions.unit,
			unitPrice: invoicePositions.unitPrice
		})
		.from(invoicePositions)
		.where(eq(invoicePositions.invoiceId, id))
		.orderBy(asc(invoicePositions.sortOrder), asc(invoicePositions.id))
		.all();
	// Die Tagesberichte, die mit dieser Rechnung abgerechnet sind
	const reports = await db
		.select({ id: dailyReports.id, number: dailyReports.number, date: dailyReports.date, dateTo: dailyReports.dateTo, site: dailyReports.site })
		.from(dailyReports)
		.where(eq(dailyReports.invoiceId, id))
		.orderBy(asc(dailyReports.date), asc(dailyReports.id))
		.all();
	return { ...invoice, lines, reports };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof invoiceDetail>>>;

export async function setInvoicePaid(id: number, paidOn: string, userId: number) {
	await db
		.update(invoices)
		.set({ status: 'bezahlt', paidOn, paidBy: userId, updatedAt: new Date() })
		.where(eq(invoices.id, id));
}

export async function setInvoiceOpen(id: number) {
	await db
		.update(invoices)
		.set({ status: 'offen', paidOn: null, paidBy: null, overdueNotifiedAt: null, updatedAt: new Date() })
		.where(eq(invoices.id, id));
}

/** Brutto einer Rechnung aus dem Netto der Abfrage */
export const grossOf = (i: { net: number; vatRate: number; reverseCharge: boolean }) => round2(i.net * (1 + (i.reverseCharge ? 0 : i.vatRate) / 100));

/** Am Tag nach „zahlbar bis" melden – einmal je Rechnung, solange sie offen ist */
export async function notifyOverdueInvoices(day = today()) {
	const due = await db
		.select({
			id: invoices.id,
			number: invoices.number,
			customerName: invoices.customerName,
			dueDate: invoices.dueDate,
			vatRate: invoices.vatRate,
			reverseCharge: invoices.reverseCharge,
			net: netSum
		})
		.from(invoices)
		.where(and(eq(invoices.status, 'offen'), activeInvoice, lt(invoices.dueDate, day), isNull(invoices.overdueNotifiedAt)))
		.all();
	for (const i of due) {
		await db.update(invoices).set({ overdueNotifiedAt: new Date() }).where(eq(invoices.id, i.id));
		notify({
			event: 'rechnung.ueberfaellig',
			title: `Rechnung ${spacedNumber(i.number)} überfällig`,
			body: [i.customerName, money(grossOf(i)), `zahlbar bis ${dateLabel(i.dueDate)}`].filter(Boolean).join(' · '),
			url: `/rechnungen/${i.id}`
		});
	}
}

/** Nur offene Entwürfe lassen sich löschen – ihre Tagesberichte sind dann wieder abzurechnen */
export async function deleteInvoice(id: number): Promise<boolean> {
	return db.transaction(async (tx) => {
		const invoice = await tx.select({ status: invoices.status, stage: invoices.stage }).from(invoices).where(eq(invoices.id, id)).get();
		if (invoice?.status !== 'offen' || invoice.stage !== 'entwurf') return false;
		// Erst die Berichte lösen – sie verweisen auf die Rechnung
		await tx.update(dailyReports).set({ invoiceId: null }).where(eq(dailyReports.invoiceId, id));
		await tx.delete(invoices).where(eq(invoices.id, id));
		return true;
	});
}
