/**
 * Import und Export von Kunden, Anfragen, Aufträgen und Rechnungen.
 *
 * Import in zwei Schritten: `planImport` prüft die Datei mit der gewählten
 * Spaltenzuordnung und sagt, was neu ist, was schon da ist und was nicht
 * geht – ohne etwas zu schreiben. `runImport` plant noch einmal und schreibt
 * dann alles in einer Transaktion: ganz oder gar nicht.
 *
 * Werte aus Dateien anderer Programme: Datum als Excel-Datum, „12.10.2026",
 * „12.10.26" oder „2026-10-12"; Zahlen mit Dezimalkomma oder -punkt; ja/nein
 * auch als x, 1, wahr usw.
 *
 * Rechnungen kommen als **Altbestand** („importiert"): gesperrt wie
 * ausgestellte, aber ohne Archiv, Signatur und Prüfcode; offen/bezahlt bleibt
 * änderbar. Schon überfällige, offene melden sich nicht als „überfällig".
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { db, type Tx } from '$lib/server/db';
import { customers, inquiries, invoicePositions, invoices, offers, orderPositions, orders, parties } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { getSettings } from '$lib/server/settings';
import type { TableCell } from '$lib/server/table';
import { addDays, isValidIsoDate } from '$lib/modules/stunden/week';
import { invoiceLabel, invoiceTotals, parseAmount } from '../offer';
import { INVOICE_STAGE_LABELS } from '../signature';
import { TRANSFER, type TransferKind, type TransferMapping } from '../transfer';
import { audit } from './signatur/audit';

/* ------------------------------------------------------------ Werte */

const pad = (n: number) => String(n).padStart(2, '0');

export function toText(v: TableCell | undefined): string {
	if (v == null) return '';
	if (v instanceof Date) return `${pad(v.getUTCDate())}.${pad(v.getUTCMonth() + 1)}.${v.getUTCFullYear()}`;
	if (typeof v === 'boolean') return v ? 'ja' : 'nein';
	return String(v).replace(/\r\n/g, '\n').trim();
}

/** Datum „JJJJ-MM-TT"; null = leer, undefined = nicht lesbar */
export function toDate(v: TableCell | undefined): string | null | undefined {
	if (v == null || v === '') return null;
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
	if (typeof v === 'number') {
		// Excel-Seriennummer (Tage seit 30.12.1899)
		if (v < 1 || v > 100_000) return undefined;
		const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
		return toDate(d);
	}
	const s = String(v).trim();
	if (!s) return null;
	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
	let iso: string | null = null;
	if (m) iso = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
	else if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?!\d)/.exec(s))) {
		let year = Number(m[3]);
		if (m[3].length === 2) year += year < 70 ? 2000 : 1900;
		iso = `${year}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
	} else if (/^\d+([.,]\d+)?$/.test(s)) return toDate(Number(s.replace(',', '.')));
	return iso && isValidIsoDate(iso) ? iso : undefined;
}

/** Zahl; null = leer, undefined = nicht lesbar */
export function toNumber(v: TableCell | undefined): number | null | undefined {
	if (v == null || v === '') return null;
	if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
	if (typeof v === 'boolean' || v instanceof Date) return undefined;
	const s = v.replace(/%/g, '').trim();
	if (!s) return null;
	return parseAmount(s) ?? undefined;
}

const TRUE = /^(ja|j|yes|y|x|1|true|wahr|bezahlt|erledigt|aktiv|abgeschlossen|beglichen)$/i;
const FALSE = /^(nein|n|no|0|false|falsch|offen|inaktiv|gesperrt|unbezahlt|nicht bezahlt)$/i;

export function toBool(v: TableCell | undefined): boolean | null {
	if (v == null || v === '') return null;
	if (typeof v === 'boolean') return v;
	const s = toText(v);
	if (TRUE.test(s)) return true;
	if (FALSE.test(s)) return false;
	return null;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** „Partie Erich" findet auch „Erich" */
const partyKey = (s: string) => key(s).replace(/^partie\s+/, '');

function orderStatus(s: string): 'erstellt' | 'in_arbeit' | 'abgeschlossen' | null {
	const t = key(s);
	if (!t) return null;
	if (/abgeschlossen|fertig|erledigt|beendet|abgerechnet/.test(t)) return 'abgeschlossen';
	if (/arbeit|laufend|läuft|begonnen|aktiv|gestartet/.test(t)) return 'in_arbeit';
	return 'erstellt';
}

function invoiceKind(s: string): 'rechnung' | 'teilrechnung' | 'storno' {
	const t = key(s);
	if (/teil|abschlag/.test(t)) return 'teilrechnung';
	if (/storno|gutschrift/.test(t)) return 'storno';
	return 'rechnung';
}

/* ------------------------------------------------------------ Planen */

export interface ImportIssue {
	/** Zeile in der Datei (Überschrift = 1) */
	row: number;
	level: 'fehler' | 'hinweis';
	message: string;
}

export type ImportAction = 'neu' | 'aktualisieren' | 'ueberspringen' | 'fehler';

interface Item {
	rows: number[];
	label: string;
	action: ImportAction;
	existingId: number | null;
	data: Record<string, unknown>;
	positions: Record<string, unknown>[];
}

export interface ImportPlan {
	kind: TransferKind;
	items: Item[];
	issues: ImportIssue[];
	counts: Record<ImportAction, number>;
}

export interface ImportOptions {
	/** Vorhandene aktualisieren statt überspringen (Kunden, Aufträge) */
	update: boolean;
}

type Row = TableCell[];

/** Ein Wert der Zeile über die Zuordnung */
const cell = (row: Row, mapping: TransferMapping, field: string): TableCell | undefined => {
	const i = mapping[field];
	return i != null && i >= 0 ? row[i] : undefined;
};
const mapped = (mapping: TransferMapping, field: string) => mapping[field] != null && mapping[field] >= 0;

/**
 * Zeilen zu Belegen zusammenfassen: gleiche Nummer = derselbe Beleg; eine
 * Zeile ohne Nummer gehört zum Beleg darüber (so exportieren viele Programme
 * die Kopfdaten nur in der ersten Zeile).
 */
function group(rows: Row[], mapping: TransferMapping, issues: ImportIssue[]) {
	const groups = new Map<string, { rows: number[]; data: Row[] }>();
	let last: string | null = null;
	rows.forEach((row, i) => {
		const number = toText(cell(row, mapping, 'number'));
		const id = number || last;
		if (!id) {
			issues.push({ row: i + 2, level: 'fehler', message: 'Keine Nummer – die Zeile gehört zu keinem Beleg.' });
			return;
		}
		last = id;
		const g = groups.get(id) ?? { rows: [], data: [] };
		g.rows.push(i + 2);
		g.data.push(row);
		groups.set(id, g);
	});
	return groups;
}

/** Kopffeld: der erste nicht leere Wert der Zeilen */
const head = (data: Row[], mapping: TransferMapping, field: string): TableCell | undefined => {
	for (const row of data) {
		const v = cell(row, mapping, field);
		if (v != null && toText(v) !== '') return v;
	}
	return undefined;
};

const limit = (s: string, n: number) => s.slice(0, n);

export async function planImport(kind: TransferKind, rows: Row[], mapping: TransferMapping, options: ImportOptions): Promise<ImportPlan> {
	const issues: ImportIssue[] = [];
	const items: Item[] = [];
	const def = TRANSFER[kind];
	for (const f of def.fields.filter((f) => f.required)) {
		if (!mapped(mapping, f.key)) issues.push({ row: 1, level: 'fehler', message: `Pflichtfeld „${f.label}" ist keiner Spalte zugeordnet.` });
	}
	if (issues.length) return finish(kind, items, issues);

	if (kind === 'kunden') await planCustomers(rows, mapping, options, items, issues);
	else if (kind === 'anfragen') await planInquiries(rows, mapping, items, issues);
	else if (kind === 'auftraege') await planOrders(rows, mapping, options, items, issues);
	else await planInvoices(rows, mapping, items, issues);
	return finish(kind, items, issues);
}

function finish(kind: TransferKind, items: Item[], issues: ImportIssue[]): ImportPlan {
	const counts: Record<ImportAction, number> = { neu: 0, aktualisieren: 0, ueberspringen: 0, fehler: 0 };
	for (const i of items) counts[i.action]++;
	issues.sort((a, b) => a.row - b.row);
	return { kind, items, issues, counts };
}

/** Text-Kopffelder einsammeln: nur zugeordnete, gekürzt */
function texts(get: (field: string) => TableCell | undefined, mapping: TransferMapping, fields: [string, number][]) {
	const out: Record<string, string> = {};
	for (const [field, max] of fields) if (mapped(mapping, field)) out[field] = limit(toText(get(field)), max);
	return out;
}

/* --------------------------------------------------- Kunden */

async function planCustomers(rows: Row[], mapping: TransferMapping, options: ImportOptions, items: Item[], issues: ImportIssue[]) {
	const existing = await db.select({ id: customers.id, name: customers.name, zip: customers.zip }).from(customers).all();
	const find = (name: string, zip: string) => existing.find((c) => key(c.name) === key(name) && (!zip || !c.zip || key(c.zip) === key(zip)));
	const seen = new Set<string>();
	rows.forEach((row, i) => {
		const r = i + 2;
		const get = (f: string) => cell(row, mapping, f);
		const data: Record<string, unknown> = texts(get, mapping, [
			['name', 160],
			['addition', 160],
			['street', 160],
			['zip', 12],
			['city', 120],
			['email', 200],
			['phone', 60],
			['contact', 160],
			['note', 2000]
		]);
		if (mapped(mapping, 'uid')) data.uid = toText(get('uid')).replace(/\s+/g, '').toUpperCase().slice(0, 30);
		if (mapped(mapping, 'active')) {
			const active = toBool(get('active'));
			if (active === null && toText(get('active'))) issues.push({ row: r, level: 'hinweis', message: `„${toText(get('active'))}" bei Aktiv nicht erkannt – gilt als aktiv.` });
			data.active = active ?? true;
		}
		const name = String(data.name ?? '');
		if (!name) {
			if (row.some((c) => toText(c))) issues.push({ row: r, level: 'fehler', message: 'Der Name fehlt.' });
			return;
		}
		const k = `${key(name)}|${key(String(data.zip ?? ''))}`;
		const item: Item = { rows: [r], label: name, action: 'neu', existingId: null, data, positions: [] };
		if (seen.has(k)) {
			item.action = 'ueberspringen';
			issues.push({ row: r, level: 'hinweis', message: `„${name}" steht mehrfach in der Datei – nur der erste wird übernommen.` });
		} else {
			const hit = find(name, String(data.zip ?? ''));
			if (hit) {
				item.existingId = hit.id;
				item.action = options.update ? 'aktualisieren' : 'ueberspringen';
			}
		}
		seen.add(k);
		items.push(item);
	});
}

/* --------------------------------------------------- Anfragen */

async function planInquiries(rows: Row[], mapping: TransferMapping, items: Item[], issues: ImportIssue[]) {
	const [existing, known] = await Promise.all([
		db.select({ receivedOn: inquiries.receivedOn, subject: inquiries.subject, senderEmail: inquiries.senderEmail }).from(inquiries).all(),
		db.select({ id: customers.id, name: customers.name }).from(customers).all()
	]);
	const keys = new Set(existing.map((e) => `${e.receivedOn}|${key(e.subject)}|${key(e.senderEmail)}`));
	rows.forEach((row, i) => {
		const r = i + 2;
		const get = (f: string) => cell(row, mapping, f);
		if (!row.some((c) => toText(c))) return;
		const receivedOn = toDate(get('receivedOn'));
		if (!receivedOn) {
			issues.push({ row: r, level: 'fehler', message: receivedOn === undefined ? `Eingang „${toText(get('receivedOn'))}" ist kein Datum.` : 'Der Eingang (Datum) fehlt.' });
			items.push({ rows: [r], label: `Zeile ${r}`, action: 'fehler', existingId: null, data: {}, positions: [] });
			return;
		}
		const data: Record<string, unknown> = {
			receivedOn,
			...texts(get, mapping, [
				['subject', 300],
				['body', 20000],
				['senderName', 160],
				['senderEmail', 200],
				['senderPhone', 60],
				['location', 300],
				['note', 2000]
			])
		};
		const customer = toText(get('customer'));
		if (customer) {
			const hit = known.find((c) => key(c.name) === key(customer));
			data.customerId = hit?.id ?? null;
			if (!hit) issues.push({ row: r, level: 'hinweis', message: `Kunde „${customer}" ist nicht im Kundenstamm – die Anfrage bleibt ohne Verknüpfung.` });
		}
		data.closed = toBool(get('closed')) === true;
		const k = `${receivedOn}|${key(String(data.subject ?? ''))}|${key(String(data.senderEmail ?? ''))}`;
		const label = [String(data.subject || data.senderName || ''), receivedOn].filter(Boolean).join(' · ');
		items.push({ rows: [r], label, action: keys.has(k) ? 'ueberspringen' : 'neu', existingId: null, data, positions: [] });
		keys.add(k);
	});
}

/* --------------------------------------------------- Positionen */

function readPositions(data: Row[], rows: number[], mapping: TransferMapping, issues: ImportIssue[], withPrice: boolean) {
	const out: Record<string, unknown>[] = [];
	let bad = false;
	data.forEach((row, i) => {
		const get = (f: string) => cell(row, mapping, f);
		const text = toText(get('posText'));
		const quantity = toNumber(get('posQuantity'));
		const price = withPrice ? toNumber(get('posPrice')) : null;
		const unit = limit(toText(get('posUnit')), 20);
		if (!text && quantity == null && !price) return;
		if (quantity === undefined) {
			issues.push({ row: rows[i], level: 'fehler', message: `Menge „${toText(get('posQuantity'))}" ist keine Zahl.` });
			bad = true;
		}
		if (price === undefined) {
			issues.push({ row: rows[i], level: 'fehler', message: `Einheitspreis „${toText(get('posPrice'))}" ist keine Zahl.` });
			bad = true;
		}
		const kindText = toText(get('posKind'));
		const titel = kindText ? /titel|überschrift|ueberschrift|gruppe|kapitel|abschnitt/i.test(kindText) : quantity == null && !price && !unit;
		out.push({
			number: limit(toText(get('posNumber')), 12),
			kind: titel ? 'titel' : 'position',
			text: limit(text, 4000),
			quantity: titel || quantity == null ? null : Math.round(quantity * 1000) / 1000,
			unit: titel ? '' : unit,
			unitPrice: titel || price == null ? null : Math.round(price * 10000) / 10000
		});
	});
	return { positions: out, bad };
}

/* --------------------------------------------------- Aufträge */

async function planOrders(rows: Row[], mapping: TransferMapping, options: ImportOptions, items: Item[], issues: ImportIssue[]) {
	const [existing, partyRows] = await Promise.all([
		db.select({ id: orders.id, number: orders.number }).from(orders).all(),
		db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.kind, 'gruppe')).all()
	]);
	const byNumber = new Map(existing.map((o) => [key(o.number), o.id]));
	for (const [number, g] of group(rows, mapping, issues)) {
		const get = (f: string) => head(g.data, mapping, f);
		const data: Record<string, unknown> = {
			number: limit(number, 30),
			...texts(get, mapping, [
				['projectNumber', 30],
				['title', 300],
				['location', 300],
				['customerName', 160],
				['customerAddition', 160],
				['customerStreet', 160],
				['customerZip', 12],
				['customerCity', 120],
				['customerContact', 160],
				['customerPhone', 60],
				['note', 2000]
			])
		};
		if (mapped(mapping, 'party')) {
			const name = toText(get('party'));
			const hit = name ? partyRows.find((p) => partyKey(p.name) === partyKey(name)) : undefined;
			data.partyId = hit?.id ?? null;
			if (name && !hit) issues.push({ row: g.rows[0], level: 'hinweis', message: `Partie „${name}" gibt es nicht – Auftrag ${number} bleibt nicht zugeteilt.` });
		}
		if (mapped(mapping, 'status')) data.status = orderStatus(toText(get('status'))) ?? 'erstellt';
		const { positions, bad } = readPositions(g.data, g.rows, mapping, issues, false);
		const existingId = byNumber.get(key(number)) ?? null;
		const action: ImportAction = bad ? 'fehler' : existingId ? (options.update ? 'aktualisieren' : 'ueberspringen') : 'neu';
		items.push({ rows: g.rows, label: `${number}${data.title ? ` · ${data.title}` : ''}`, action, existingId, data, positions });
	}
}

/* --------------------------------------------------- Rechnungen */

async function planInvoices(rows: Row[], mapping: TransferMapping, items: Item[], issues: ImportIssue[]) {
	const [existing, orderRows, settings] = await Promise.all([
		db.select({ number: invoices.number }).from(invoices).all(),
		db.select({ id: orders.id, number: orders.number, offerId: orders.offerId }).from(orders).all(),
		getSettings()
	]);
	const taken = new Set(existing.map((i) => key(i.number)));
	const orderBy = new Map(orderRows.map((o) => [key(o.number), o]));
	const offerCustomers = new Map(
		(await db.select({ id: offers.id, customerId: offers.customerId }).from(offers).all()).map((o) => [o.id, o.customerId] as const)
	);
	for (const [number, g] of group(rows, mapping, issues)) {
		const first = g.rows[0];
		const get = (f: string) => head(g.data, mapping, f);
		const problems: string[] = [];
		const date = toDate(get('date'));
		if (!date) problems.push(date === undefined ? `Rechnungsdatum „${toText(get('date'))}" ist kein Datum.` : 'Das Rechnungsdatum fehlt.');
		const due = toDate(get('dueDate'));
		if (due === undefined) problems.push(`„Zahlbar bis" („${toText(get('dueDate'))}") ist kein Datum.`);
		const from = toDate(get('serviceFrom'));
		const to = toDate(get('serviceTo'));
		if (from === undefined || to === undefined) problems.push('Der Leistungszeitraum ist kein Datum.');
		const paidOn = toDate(get('paidOn'));
		if (paidOn === undefined) problems.push(`„Bezahlt am" („${toText(get('paidOn'))}") ist kein Datum.`);
		const vat = toNumber(get('vatRate'));
		if (vat === undefined || (vat != null && (vat < 0 || vat > 100))) problems.push(`USt-Satz „${toText(get('vatRate'))}" stimmt nicht.`);
		const net = toNumber(get('netTotal'));
		if (net === undefined) problems.push(`„Netto gesamt" („${toText(get('netTotal'))}") ist keine Zahl.`);
		const customerName = limit(toText(get('customerName')), 160);
		if (!customerName) problems.push('Der Kunde fehlt.');

		const data: Record<string, unknown> = {
			number: limit(number, 30),
			kind: invoiceKind(toText(get('kind'))),
			date,
			dueDate: due ?? (date ? addDays(date, settings.invoicePaymentDays) : null),
			serviceFrom: from ?? null,
			serviceTo: to ?? null,
			...texts(get, mapping, [
				['projectNumber', 30],
				['title', 300],
				['location', 300],
				['customerAddition', 160],
				['customerStreet', 160],
				['customerZip', 12],
				['customerCity', 120],
				['intro', 3000],
				['closing', 5000]
			]),
			customerName,
			customerUid: toText(get('customerUid')).replace(/\s+/g, '').toUpperCase().slice(0, 30),
			vatRate: vat ?? 20,
			reverseCharge: toBool(get('reverseCharge')) === true
		};
		if (data.dueDate && date && String(data.dueDate) < date) problems.push('„Zahlbar bis" liegt vor dem Rechnungsdatum.');
		const paid = toBool(get('paid')) === true || !!paidOn;
		data.status = paid ? 'bezahlt' : 'offen';
		data.paidOn = paid ? (paidOn ?? date ?? null) : null;
		const orderNumber = toText(get('orderNumber'));
		const order = orderNumber ? orderBy.get(key(orderNumber)) : undefined;
		data.orderId = order?.id ?? null;
		data.offerId = order?.offerId ?? null;
		data.customerId = order?.offerId ? (offerCustomers.get(order.offerId) ?? null) : null;
		if (orderNumber && !order) issues.push({ row: first, level: 'hinweis', message: `Auftrag ${orderNumber} gibt es nicht – Rechnung ${number} bleibt ohne Auftrag.` });

		let { positions, bad } = readPositions(g.data, g.rows, mapping, issues, true);
		const priced = positions.filter((l) => l.kind === 'position' && l.quantity != null);
		if (!priced.length) {
			if (net != null) {
				positions = [{ number: '1', kind: 'position', text: data.title ? `Leistungen lt. Rechnung – ${data.title}` : 'Leistungen lt. Rechnung', quantity: 1, unit: 'pauschal', unitPrice: net }];
			} else problems.push('Keine Position mit Menge und kein „Netto gesamt".');
		} else {
			for (const l of priced) if (l.unitPrice == null) issues.push({ row: first, level: 'hinweis', message: `Rechnung ${number}: „${String(l.text).slice(0, 40)}" ohne Einheitspreis – zählt mit 0.` });
			if (net != null) {
				const sum = invoiceTotals(positions as never, Number(data.vatRate), Boolean(data.reverseCharge)).net;
				if (Math.abs(sum - net) > 0.015) issues.push({ row: first, level: 'hinweis', message: `Rechnung ${number}: Positionen ergeben netto ${sum.toFixed(2)}, in der Datei steht ${net.toFixed(2)}.` });
			}
		}
		for (const p of problems) issues.push({ row: first, level: 'fehler', message: `Rechnung ${number}: ${p}` });
		const action: ImportAction = problems.length || bad ? 'fehler' : taken.has(key(number)) ? 'ueberspringen' : 'neu';
		items.push({ rows: g.rows, label: `${invoiceLabel(String(data.kind))} ${number}${customerName ? ` · ${customerName}` : ''}`, action, existingId: null, data, positions });
		taken.add(key(number));
	}
}

/* ------------------------------------------------------------ Schreiben */

export interface ImportResult {
	created: number;
	updated: number;
	skipped: number;
	failed: number;
}

export async function runImport(
	kind: TransferKind,
	rows: Row[],
	mapping: TransferMapping,
	options: ImportOptions,
	user: SessionUser,
	fileName: string
): Promise<{ plan: ImportPlan; result: ImportResult }> {
	const plan = await planImport(kind, rows, mapping, options);
	const result: ImportResult = { created: 0, updated: 0, skipped: plan.counts.ueberspringen, failed: plan.counts.fehler };
	if (plan.issues.some((i) => i.row === 1 && i.level === 'fehler')) return { plan, result };
	const now = new Date();
	await db.transaction(async (tx) => {
		for (const item of plan.items) {
			if (item.action === 'neu') {
				await insertItem(tx, kind, item, user, now, fileName);
				result.created++;
			} else if (item.action === 'aktualisieren' && item.existingId) {
				await updateItem(tx, kind, item, now);
				result.updated++;
			}
		}
	});
	return { plan, result };
}

async function writePositions(tx: Tx, table: 'order' | 'invoice', id: number, positions: Record<string, unknown>[]) {
	for (const [i, l] of positions.entries()) {
		if (table === 'order') {
			await tx
				.insert(orderPositions)
				.values({ orderId: id, sortOrder: i, kind: l.kind as 'position', text: String(l.text), quantity: l.quantity as number | null, unit: String(l.unit) });
		} else {
			await tx.insert(invoicePositions).values({
				invoiceId: id,
				sortOrder: i,
				number: String(l.number ?? ''),
				kind: l.kind as 'position',
				text: String(l.text),
				quantity: l.quantity as number | null,
				unit: String(l.unit),
				unitPrice: l.unitPrice as number | null
			});
		}
	}
}

async function insertItem(tx: Tx, kind: TransferKind, item: Item, user: SessionUser, now: Date, fileName: string) {
	const d = item.data;
	if (kind === 'kunden') {
		await tx.insert(customers).values({ ...(d as { name: string }), updatedAt: now });
	} else if (kind === 'anfragen') {
		const { closed, ...rest } = d;
		await tx.insert(inquiries).values({ ...(rest as { receivedOn: string }), closedAt: closed ? now : null, createdBy: user.id, updatedAt: now });
	} else if (kind === 'auftraege') {
		const status = (d.status as 'erstellt' | 'in_arbeit' | 'abgeschlossen' | undefined) ?? 'erstellt';
		const row = await tx
			.insert(orders)
			.values({
				...(d as { number: string }),
				status,
				statusAt: status === 'erstellt' ? null : now,
				statusBy: status === 'erstellt' ? null : user.id,
				createdBy: user.id,
				updatedAt: now
			})
			.returning({ id: orders.id })
			.get();
		await writePositions(tx, 'order', row.id, item.positions);
	} else {
		// Erst als Entwurf mit Positionen, dann gesperrt als Altbestand – die Trigger lassen Positionen nur an Entwürfen zu
		const date = String(d.date);
		const open = d.status === 'offen';
		const row = await tx
			.insert(invoices)
			.values({ ...(d as { number: string; date: string; dueDate: string }), stage: 'entwurf', createdBy: user.id, updatedAt: now })
			.returning({ id: invoices.id })
			.get();
		await writePositions(tx, 'invoice', row.id, item.positions);
		await tx
			.update(invoices)
			.set({
				stage: 'importiert',
				issuedAt: new Date(`${date}T12:00:00Z`),
				// Schon überfällig beim Import: keine Meldung „überfällig" für alte Rechnungen
				overdueNotifiedAt: open && String(d.dueDate) < now.toISOString().slice(0, 10) ? now : null
			})
			.where(eq(invoices.id, row.id));
		await audit({ invoiceId: row.id, invoiceNumber: String(d.number), user, action: 'importiert', detail: { datei: fileName, zeilen: item.rows } }, tx);
	}
}

async function updateItem(tx: Tx, kind: TransferKind, item: Item, now: Date) {
	// Nur, was in der Datei steht – leere Felder überschreiben nichts
	const set = Object.fromEntries(Object.entries(item.data).filter(([k, v]) => k !== 'number' && v !== '' && v != null));
	if (kind === 'kunden') {
		await tx
			.update(customers)
			.set({ ...set, updatedAt: now })
			.where(eq(customers.id, item.existingId!));
	} else if (kind === 'auftraege') {
		if ('partyId' in item.data) set.partyId = item.data.partyId;
		await tx
			.update(orders)
			.set({ ...set, updatedAt: now })
			.where(eq(orders.id, item.existingId!));
		if (item.positions.length) {
			await tx.delete(orderPositions).where(eq(orderPositions.orderId, item.existingId!));
			await writePositions(tx, 'order', item.existingId!, item.positions);
		}
	}
}

/* ------------------------------------------------------------ Export */

export interface ExportTable {
	header: string[];
	rows: TableCell[][];
	widths: number[];
}

const asDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const yesNo = (b: boolean) => (b ? 'ja' : 'nein');
const ORDER_STATUS_TEXT: Record<string, string> = { erstellt: 'erstellt', in_arbeit: 'in Arbeit', abgeschlossen: 'abgeschlossen' };

/** Überschriften wie die Felder – so ordnet ein späterer Import alles von selbst zu */
function headerOf(kind: TransferKind, extra: string[] = []) {
	return [...TRANSFER[kind].fields.map((f) => f.label), ...extra];
}

function widthsOf(header: string[]) {
	return header.map((h) => (/text|einleitung|schluss|notiz|hinweis/i.test(h) ? 40 : /kunde|bv|ort|betreff|absender|firma/i.test(h) ? 28 : 16));
}

/** Nur die Überschriften – für die Vorlage */
export function exportHeader(kind: TransferKind): Omit<ExportTable, 'rows'> {
	const header = kind === 'anfragen' ? headerOf(kind, ['Angebot']) : kind === 'rechnungen' ? headerOf(kind, ['Stufe', 'USt gesamt', 'Brutto gesamt']) : headerOf(kind);
	return { header, widths: widthsOf(header) };
}

export async function exportTable(kind: TransferKind): Promise<ExportTable> {
	if (kind === 'kunden') {
		const header = headerOf(kind);
		const list = await db.select().from(customers).orderBy(asc(customers.name)).all();
		return {
			header,
			widths: widthsOf(header),
			rows: list.map((c) => [c.name, c.addition, c.street, c.zip, c.city, c.uid, c.email, c.phone, c.contact, c.note, yesNo(c.active)])
		};
	}
	if (kind === 'anfragen') {
		const header = headerOf(kind, ['Angebot']);
		const list = await db
			.select({ i: inquiries, customer: customers.name, offer: offers.number })
			.from(inquiries)
			.leftJoin(customers, eq(customers.id, inquiries.customerId))
			.leftJoin(offers, eq(offers.id, inquiries.offerId))
			.orderBy(asc(inquiries.receivedOn), asc(inquiries.id))
			.all();
		return {
			header,
			widths: widthsOf(header),
			rows: list.map(({ i, customer, offer }) => [
				asDate(i.receivedOn),
				i.subject,
				i.body,
				i.senderName,
				i.senderEmail,
				i.senderPhone,
				customer ?? '',
				i.location,
				i.note,
				yesNo(!!i.closedAt),
				offer ?? ''
			])
		};
	}
	if (kind === 'auftraege') {
		const header = headerOf(kind);
		const list = await db
			.select({ o: orders, party: parties.name })
			.from(orders)
			.leftJoin(parties, eq(parties.id, orders.partyId))
			.orderBy(asc(orders.number))
			.all();
		const lines = list.length ? await db.select().from(orderPositions).where(inArray(orderPositions.orderId, list.map((l) => l.o.id))).orderBy(asc(orderPositions.sortOrder), asc(orderPositions.id)).all() : [];
		const rows: TableCell[][] = [];
		for (const { o, party } of list) {
			const headCells = [
				o.number,
				o.projectNumber,
				o.title,
				o.location,
				o.customerName,
				o.customerAddition,
				o.customerStreet,
				o.customerZip,
				o.customerCity,
				o.customerContact,
				o.customerPhone,
				party ?? '',
				ORDER_STATUS_TEXT[o.status] ?? o.status,
				o.note
			];
			const own = lines.filter((l) => l.orderId === o.id);
			if (!own.length) rows.push([...headCells, '', '', null, '']);
			for (const l of own) rows.push([...headCells, l.kind === 'titel' ? 'Titel' : 'Position', l.text, l.quantity, l.unit]);
		}
		return { header, rows, widths: widthsOf(header) };
	}
	const header = headerOf(kind, ['Stufe', 'USt gesamt', 'Brutto gesamt']);
	const list = await db
		.select({ i: invoices, orderNumber: orders.number })
		.from(invoices)
		.leftJoin(orders, eq(orders.id, invoices.orderId))
		.orderBy(asc(invoices.date), asc(invoices.number))
		.all();
	const lines = list.length ? await db.select().from(invoicePositions).where(inArray(invoicePositions.invoiceId, list.map((l) => l.i.id))).orderBy(asc(invoicePositions.sortOrder), asc(invoicePositions.id)).all() : [];
	const rows: TableCell[][] = [];
	for (const { i, orderNumber } of list) {
		const own = lines.filter((l) => l.invoiceId === i.id);
		const totals = invoiceTotals(own, i.vatRate, i.reverseCharge);
		const headCells: TableCell[] = [
			i.number,
			invoiceLabel(i.kind),
			asDate(i.date),
			asDate(i.dueDate),
			asDate(i.serviceFrom),
			asDate(i.serviceTo),
			orderNumber ?? '',
			i.projectNumber,
			i.title,
			i.location,
			i.customerName,
			i.customerAddition,
			i.customerStreet,
			i.customerZip,
			i.customerCity,
			i.customerUid,
			i.intro,
			i.closing,
			i.vatRate,
			yesNo(i.reverseCharge),
			yesNo(i.status === 'bezahlt'),
			asDate(i.paidOn),
			totals.net
		];
		const tail: TableCell[] = [INVOICE_STAGE_LABELS[i.stage]?.label ?? i.stage, totals.vat, totals.gross];
		if (!own.length) rows.push([...headCells, '', '', '', null, '', null, ...tail]);
		for (const l of own) rows.push([...headCells, l.number, l.kind === 'titel' ? 'Titel' : 'Position', l.text, l.quantity, l.unit, l.unitPrice, ...tail]);
	}
	return { header, rows, widths: widthsOf(header) };
}
