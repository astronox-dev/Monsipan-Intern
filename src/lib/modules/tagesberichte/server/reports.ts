/**
 * Tagesberichte: anlegen, lesen, speichern und der Ablauf bis zur Unterschrift
 * des Kunden – freigeben (mit Unterschrift für den Auftragnehmer), prüfen,
 * Link an den Kunden, abgeschlossen sobald er unterschrieben hat.
 *
 * Wer kein Recht auf „alle sehen" hat, sieht die Berichte der eigenen Partie
 * und die selbst angelegten.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { can, type Role } from '$lib/permissions';
import { db } from '$lib/server/db';
import { broadcast } from '$lib/server/events';
import {
	categories,
	colors,
	dailyReportMaterials,
	dailyReportPositions,
	dailyReportRows,
	dailyReports,
	orders,
	parties,
	products,
	REPORT_STATUS,
	users,
	type ReportStatus
} from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import type { InkPages } from '$lib/ink';
import { addDays, isValidIsoDate } from '$lib/modules/stunden/week';
import { MAX_MATERIALS, MAX_POSITIONS } from '../sheet';

/** Zeilen, die ein neuer Bericht gleich mitbringt */
const START_ROWS = 10;

/** Wer freigegeben bzw. geprüft hat */
const releaser = alias(users, 'releaser');
const checker = alias(users, 'checker');

/** Alle, nur eigene bzw. Partie-Berichte – oder gar keine */
function scope(user: SessionUser) {
	if (can(user.role, 'tagesberichte.alle.sehen')) return undefined;
	if (!can(user.role, 'tagesberichte.sehen')) return eq(dailyReports.id, -1);
	const own = eq(dailyReports.createdBy, user.id);
	return user.partyId ? or(own, eq(dailyReports.partyId, user.partyId)) : own;
}

export interface ReportFilter {
	q?: string;
	from?: string;
	to?: string;
	/** Nur die Berichte zu diesem Auftrag */
	orderId?: number;
	/** Nur Berichte in diesem Stand */
	status?: string;
	/** Geprüfte und abgeschlossene weglassen – die Liste zeigt nur, was noch zu tun ist */
	pendingOnly?: boolean;
}

export async function listReports(user: SessionUser, filter: ReportFilter = {}, limit = 100) {
	const where = [scope(user)];
	// Berichte über mehrere Tage zählen, sobald einer ihrer Tage im Zeitraum liegt
	if (filter.from) where.push(sql`coalesce(${dailyReports.dateTo}, ${dailyReports.date}) >= ${filter.from}`);
	if (filter.to) where.push(sql`${dailyReports.date} <= ${filter.to}`);
	if (filter.orderId) where.push(eq(dailyReports.orderId, filter.orderId));
	if (filter.status && (REPORT_STATUS as readonly string[]).includes(filter.status)) where.push(eq(dailyReports.status, filter.status as ReportStatus));
	else if (filter.pendingOnly) where.push(inArray(dailyReports.status, ['entwurf', 'freigegeben']));
	if (filter.q?.trim()) {
		const q = `%${filter.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(
			or(
				like(dailyReports.number, q),
				like(dailyReports.road, q),
				like(dailyReports.site, q),
				like(dailyReports.lvPosition, q)
			)
		);
	}
	return db
		.select({
			id: dailyReports.id,
			number: dailyReports.number,
			date: dailyReports.date,
			dateTo: dailyReports.dateTo,
			road: dailyReports.road,
			site: dailyReports.site,
			status: dailyReports.status,
			dailyOutput: dailyReports.dailyOutput,
			partyName: parties.name,
			orderNumber: orders.number,
			invoiceId: dailyReports.invoiceId,
			authorFirst: users.firstName,
			authorLast: users.lastName
		})
		.from(dailyReports)
		.leftJoin(parties, eq(parties.id, dailyReports.partyId))
		.leftJoin(users, eq(users.id, dailyReports.createdBy))
		.leftJoin(orders, eq(orders.id, dailyReports.orderId))
		.where(and(...where.filter(Boolean)))
		.orderBy(desc(dailyReports.date), desc(dailyReports.id))
		.limit(limit)
		.all();
}

/** Für die Übersicht: Berichte je Stand und die der laufenden Woche – so weit sichtbar */
export async function reportCounts(user: SessionUser, weekStart: string) {
	const weekEnd = addDays(weekStart, 6);
	const count = (cond: SQL) => sql<number>`coalesce(sum(case when ${cond} then 1 else 0 end), 0)`.mapWith(Number);
	const row = await db
		.select({
			entwurf: count(eq(dailyReports.status, 'entwurf')),
			freigegeben: count(eq(dailyReports.status, 'freigegeben')),
			geprueft: count(eq(dailyReports.status, 'geprueft')),
			week: count(sql`${dailyReports.date} <= ${weekEnd} and coalesce(${dailyReports.dateTo}, ${dailyReports.date}) >= ${weekStart}`)
		})
		.from(dailyReports)
		.where(scope(user))
		.get();
	return { entwurf: row?.entwurf ?? 0, freigegeben: row?.freigegeben ?? 0, geprueft: row?.geprueft ?? 0, week: row?.week ?? 0 };
}

/** Freigegeben und noch nicht geprüft – die Zahl im Menü für alle, die prüfen dürfen */
export async function reportsToCheck(user: SessionUser): Promise<number> {
	const row = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(dailyReports)
		.where(and(eq(dailyReports.status, 'freigegeben'), scope(user)))
		.get();
	return row?.n ?? 0;
}

/** Nächste freie Nummer vorschlagen: höchste rein numerische Nummer plus eins */
export async function nextNumber(): Promise<string> {
	const rows = await db.select({ number: dailyReports.number }).from(dailyReports).all();
	const max = rows.reduce((m, r) => {
		const n = Number(r.number);
		return Number.isInteger(n) && n > m ? n : m;
	}, 0);
	return String(max + 1);
}

export async function createReport(
	user: SessionUser,
	data: { date: string; dateTo: string | null; number: string; road: string; site: string; orderId: number | null }
) {
	return db.transaction(async (tx) => {
		const row = await tx
			.insert(dailyReports)
			.values({
				date: data.date,
				dateTo: data.dateTo,
				orderId: data.orderId,
				number: data.number.slice(0, 40),
				road: data.road.slice(0, 120),
				site: data.site.slice(0, 200),
				partyId: user.partyId,
				createdBy: user.id,
				updatedAt: new Date()
			})
			.returning({ id: dailyReports.id })
			.get();
		// Eine LB-Position zum Start – weitere kommen nach Bedarf dazu
		await tx.insert(dailyReportPositions).values({ reportId: row.id, idx: 1 });
		for (let i = 0; i < START_ROWS; i++) await tx.insert(dailyReportRows).values({ reportId: row.id, sortOrder: i });
		return row.id;
	});
}

/** Kopf und was für die Rechte zählt – für Fotos und andere kleine Anfragen */
export async function reportAccess(id: number) {
	if (!Number.isInteger(id)) return null;
	const row = await db
		.select({
			id: dailyReports.id,
			number: dailyReports.number,
			date: dailyReports.date,
			dateTo: dailyReports.dateTo,
			road: dailyReports.road,
			site: dailyReports.site,
			status: dailyReports.status,
			createdBy: dailyReports.createdBy,
			partyId: dailyReports.partyId
		})
		.from(dailyReports)
		.where(eq(dailyReports.id, id))
		.get();
	return row ?? null;
}

export async function reportDetail(id: number) {
	return loadReport(eq(dailyReports.id, id));
}

/** Für die Seite des Kunden: der Bericht zu seinem Link */
export async function reportByToken(token: string) {
	if (!/^[0-9a-f]{32}$/.test(token)) return null;
	return loadReport(eq(dailyReports.customerToken, token));
}

async function loadReport(where: SQL) {
	const report = await db
		.select({
			id: dailyReports.id,
			number: dailyReports.number,
			date: dailyReports.date,
			dateTo: dailyReports.dateTo,
			road: dailyReports.road,
			site: dailyReports.site,
			costCenter: dailyReports.costCenter,
			dailyOutput: dailyReports.dailyOutput,
			lvPosition: dailyReports.lvPosition,
			note: dailyReports.note,
			status: dailyReports.status,
			partyId: dailyReports.partyId,
			partyName: parties.name,
			orderId: dailyReports.orderId,
			orderNumber: orders.number,
			orderTitle: orders.title,
			createdBy: dailyReports.createdBy,
			releasedAt: dailyReports.releasedAt,
			releaseSignature: dailyReports.releaseSignature,
			releasedByFirst: releaser.firstName,
			releasedByLast: releaser.lastName,
			checkedAt: dailyReports.checkedAt,
			checkedByFirst: checker.firstName,
			checkedByLast: checker.lastName,
			customerToken: dailyReports.customerToken,
			customerName: dailyReports.customerName,
			customerSignature: dailyReports.customerSignature,
			customerSignedAt: dailyReports.customerSignedAt,
			customerSignedOnSite: dailyReports.customerSignedOnSite,
			ink: dailyReports.ink,
			customerEmail: dailyReports.customerEmail,
			customerLinkSentAt: dailyReports.customerLinkSentAt,
			authorFirst: users.firstName,
			authorLast: users.lastName
		})
		.from(dailyReports)
		.leftJoin(parties, eq(parties.id, dailyReports.partyId))
		.leftJoin(users, eq(users.id, dailyReports.createdBy))
		.leftJoin(releaser, eq(releaser.id, dailyReports.releasedBy))
		.leftJoin(checker, eq(checker.id, dailyReports.checkedBy))
		.leftJoin(orders, eq(orders.id, dailyReports.orderId))
		.where(where)
		.get();
	if (!report) return null;
	const id = report.id;

	const [positions, rows, materials] = await Promise.all([
		db
			.select({
				idx: dailyReportPositions.idx,
				lbPos: dailyReportPositions.lbPos,
				unit: dailyReportPositions.unit,
				totalQuantity: dailyReportPositions.totalQuantity
			})
			.from(dailyReportPositions)
			.where(eq(dailyReportPositions.reportId, id))
			.orderBy(asc(dailyReportPositions.idx))
			.all(),
		db
			.select({ id: dailyReportRows.id, label: dailyReportRows.label, quantities: dailyReportRows.quantities })
			.from(dailyReportRows)
			.where(eq(dailyReportRows.reportId, id))
			.orderBy(asc(dailyReportRows.sortOrder), asc(dailyReportRows.id))
			.all(),
		db
			.select({
				productId: dailyReportMaterials.productId,
				productName: products.name,
				material: dailyReportMaterials.material,
				code: dailyReportMaterials.code,
				filmThickness: dailyReportMaterials.filmThickness
			})
			.from(dailyReportMaterials)
			.leftJoin(products, eq(products.id, dailyReportMaterials.productId))
			.where(eq(dailyReportMaterials.reportId, id))
			.orderBy(asc(dailyReportMaterials.sortOrder), asc(dailyReportMaterials.id))
			.all()
	]);
	return { ...report, positions, rows, materials };
}

export type ReportDetail = NonNullable<Awaited<ReturnType<typeof reportDetail>>>;

/** Längster Zeitraum eines Berichts – fängt Tippfehler im Jahr ab */
const MAX_RANGE_DAYS = 62;

/**
 * Erster und letzter Tag prüfen. „bis" ist freiwillig: leer oder derselbe Tag
 * heißt ein Tag (null). Sonst der letzte Tag – oder ein Fehlertext.
 */
export function checkDateRange(from: string, to: string): { dateTo: string | null } | { message: string } {
	if (!isValidIsoDate(from)) return { message: 'Das Datum ist ungültig.' };
	const last = to.trim();
	if (!last || last === from) return { dateTo: null };
	if (!isValidIsoDate(last)) return { message: 'Das Datum „bis" ist ungültig.' };
	if (last < from) return { message: 'Der letzte Tag liegt vor dem ersten – bitte „bis" prüfen.' };
	if (last > addDays(from, MAX_RANGE_DAYS)) return { message: `Ein Bericht kann höchstens ${MAX_RANGE_DAYS} Tage umfassen.` };
	return { dateTo: last };
}

const num = (v: unknown) => {
	const s = String(v ?? '').trim().replace(',', '.');
	if (!s) return null;
	const n = Number(s);
	return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
};

export interface SaveReport {
	head: {
		number: string;
		date: string;
		/** Letzter Tag bei mehreren Tagen, sonst null */
		dateTo: string | null;
		/** Auftrag, zu dem der Bericht gehört */
		orderId: number | null;
		road: string;
		site: string;
		costCenter: string;
		dailyOutput: string;
		lvPosition: string;
		note: string;
	};
	/** In der Reihenfolge der Spalten; die Mengen der Zeilen stehen in derselben Reihenfolge */
	positions: { lbPos: string; unit: string; totalQuantity: string }[];
	rows: { id: number | null; label: string; quantities: string[] }[];
	materials: { productId: number | null; material: string; code: string; filmThickness: string }[];
}

export async function saveReport(id: number, data: SaveReport) {
	await db.transaction(async (tx) => {
		await tx
			.update(dailyReports)
			.set({
				number: data.head.number.slice(0, 40),
				date: data.head.date,
				dateTo: data.head.dateTo,
				orderId: data.head.orderId,
				road: data.head.road.slice(0, 120),
				site: data.head.site.slice(0, 200),
				costCenter: data.head.costCenter.slice(0, 60),
				dailyOutput: data.head.dailyOutput.slice(0, 200),
				lvPosition: data.head.lvPosition.slice(0, 200),
				note: data.head.note.slice(0, 2000),
				updatedAt: new Date()
			})
			.where(eq(dailyReports.id, id));

		// Positionen werden neu geschrieben – ihre Reihenfolge ist zugleich die der Mengen
		const positions = data.positions.slice(0, MAX_POSITIONS);
		await tx.delete(dailyReportPositions).where(eq(dailyReportPositions.reportId, id));
		for (const [i, p] of positions.entries()) {
			await tx.insert(dailyReportPositions).values({
				reportId: id,
				idx: i + 1,
				lbPos: p.lbPos.slice(0, 40),
				unit: p.unit.slice(0, 20),
				totalQuantity: num(p.totalQuantity)
			});
		}

		const keep: number[] = [];
		let order = 0;
		for (const r of data.rows) {
			const quantities = positions.map((_, i) => num(r.quantities[i]));
			const empty = !r.label.trim() && quantities.every((q) => q == null);
			if (empty && r.id == null) continue;
			const values = { label: r.label.slice(0, 200), sortOrder: order++, quantities };
			if (r.id == null) {
				const created = await tx
					.insert(dailyReportRows)
					.values({ reportId: id, ...values })
					.returning({ id: dailyReportRows.id })
					.get();
				keep.push(created.id);
			} else {
				await tx.update(dailyReportRows).set(values).where(and(eq(dailyReportRows.id, r.id), eq(dailyReportRows.reportId, id)));
				keep.push(r.id);
			}
		}
		// Zeilen, die im Formular nicht mehr vorkommen, sind gelöscht worden
		const existing = await tx.select({ id: dailyReportRows.id }).from(dailyReportRows).where(eq(dailyReportRows.reportId, id)).all();
		const gone = existing.filter((e) => !keep.includes(e.id)).map((e) => e.id);
		if (gone.length) await tx.delete(dailyReportRows).where(inArray(dailyReportRows.id, gone));

		// Materialblock ebenso neu; leere Zeilen fallen weg
		const materials = data.materials
			.filter((m) => m.productId != null || m.material.trim() || m.code.trim() || m.filmThickness.trim())
			.slice(0, MAX_MATERIALS);
		const wanted = materials.map((m) => m.productId).filter((p): p is number => p != null);
		const known = new Set(
			wanted.length
				? (await tx.select({ id: products.id }).from(products).where(inArray(products.id, wanted)).all()).map((p) => p.id)
				: []
		);
		await tx.delete(dailyReportMaterials).where(eq(dailyReportMaterials.reportId, id));
		for (const [i, m] of materials.entries()) {
			await tx.insert(dailyReportMaterials).values({
				reportId: id,
				sortOrder: i,
				productId: m.productId != null && known.has(m.productId) ? m.productId : null,
				material: m.material.slice(0, 60),
				code: m.code.slice(0, 120),
				filmThickness: m.filmThickness.trim().slice(0, 30)
			});
		}
	});
}

/* ------------------------------------------------------------- Ablauf */

const NO_CHECK = { checkedBy: null, checkedAt: null };
const NO_CUSTOMER = { customerName: null, customerSignature: null, customerSignedAt: null, customerSignedOnSite: false };
/** Vor der Prüfung: in Arbeit oder freigegeben */
const BEFORE_CHECK = inArray(dailyReports.status, ['entwurf', 'freigegeben']);
/** Offene Browser zählen die Berichte zum Prüfen im Menü neu */
const badgesChanged = () => broadcast('badges', {});

/**
 * Freigeben mit Unterschrift – sie steht im Ausdruck bei „Für den Auftragnehmer".
 * Eine Unterschrift, die der Kunde schon vor Ort geleistet hat, bleibt.
 */
export async function releaseReport(id: number, userId: number, signature: string) {
	await db
		.update(dailyReports)
		.set({ status: 'freigegeben', releasedBy: userId, releasedAt: new Date(), releaseSignature: signature, ...NO_CHECK, updatedAt: new Date() })
		.where(and(eq(dailyReports.id, id), eq(dailyReports.status, 'entwurf')));
	badgesChanged();
}

/**
 * Prüfen; dabei entsteht der Link für den Kunden, falls es noch keinen gibt.
 * Hat der Kunde schon vor Ort unterschrieben, ist der Bericht damit fertig.
 */
export async function checkReport(id: number, userId: number): Promise<'geprueft' | 'abgeschlossen'> {
	const row = await db.select({ signed: dailyReports.customerSignature }).from(dailyReports).where(eq(dailyReports.id, id)).get();
	const status = row?.signed ? 'abgeschlossen' : 'geprueft';
	await db
		.update(dailyReports)
		.set({ status, checkedBy: userId, checkedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(dailyReports.id, id), eq(dailyReports.status, 'freigegeben')));
	await ensureCustomerToken(id);
	badgesChanged();
	return status;
}

/** Der Kunde unterschreibt auf der Baustelle am Gerät – vor der Prüfung, der Inhalt ist danach gesperrt */
export async function customerSignOnSite(id: number, name: string, signature: string): Promise<boolean> {
	const done = await db
		.update(dailyReports)
		.set({ customerName: name, customerSignature: signature, customerSignedAt: new Date(), customerSignedOnSite: true, updatedAt: new Date() })
		.where(and(eq(dailyReports.id, id), BEFORE_CHECK, sql`${dailyReports.customerSignature} is null`))
		.returning({ id: dailyReports.id });
	return done.length > 0;
}

/** Unterschrift des Kunden vor der Prüfung wieder entfernen – dann lässt sich der Bericht wieder ändern */
export async function removeCustomerSignature(id: number) {
	await db
		.update(dailyReports)
		.set({ ...NO_CUSTOMER, updatedAt: new Date() })
		.where(and(eq(dailyReports.id, id), BEFORE_CHECK));
}

/** Prüfung zurücknehmen – die Freigabe samt Unterschrift bleibt */
export async function undoCheck(id: number) {
	await db
		.update(dailyReports)
		.set({ status: 'freigegeben', ...NO_CHECK, updatedAt: new Date() })
		.where(and(eq(dailyReports.id, id), eq(dailyReports.status, 'geprueft')));
	badgesChanged();
}

/**
 * Wieder öffnen: zurück auf „in Arbeit", alle Unterschriften verfallen. Der
 * Link des Kunden bleibt – er unterschreibt später über denselben neu.
 */
export async function reopenReport(id: number) {
	await db
		.update(dailyReports)
		.set({ status: 'entwurf', releasedBy: null, releasedAt: null, releaseSignature: null, ...NO_CHECK, ...NO_CUSTOMER, updatedAt: new Date() })
		.where(eq(dailyReports.id, id));
	badgesChanged();
}

/** Link für den Kunden: 128 Bit Zufall, bleibt dauerhaft gleich */
export async function ensureCustomerToken(id: number): Promise<string> {
	const row = await db.select({ token: dailyReports.customerToken }).from(dailyReports).where(eq(dailyReports.id, id)).get();
	if (row?.token) return row.token;
	const token = randomBytes(16).toString('hex');
	await db.update(dailyReports).set({ customerToken: token }).where(and(eq(dailyReports.id, id), sql`${dailyReports.customerToken} is null`));
	const after = await db.select({ token: dailyReports.customerToken }).from(dailyReports).where(eq(dailyReports.id, id)).get();
	return after?.token ?? token;
}

export async function markLinkSent(id: number, email: string) {
	await db.update(dailyReports).set({ customerEmail: email, customerLinkSentAt: new Date() }).where(eq(dailyReports.id, id));
}

/**
 * Der Kunde unterschreibt. Nur ein geprüfter Bericht nimmt die Unterschrift an –
 * kommen zwei gleichzeitig, gewinnt die erste.
 */
export async function customerSign(id: number, name: string, signature: string): Promise<boolean> {
	const done = await db
		.update(dailyReports)
		.set({
			status: 'abgeschlossen',
			customerName: name,
			customerSignature: signature,
			customerSignedAt: new Date(),
			customerSignedOnSite: false,
			updatedAt: new Date()
		})
		.where(and(eq(dailyReports.id, id), eq(dailyReports.status, 'geprueft')))
		.returning({ id: dailyReports.id });
	return done.length > 0;
}

/** Handschrift vom Tablet speichern – leer heißt: keine Handschrift mehr */
export async function saveReportInk(id: number, ink: InkPages) {
	await db
		.update(dailyReports)
		.set({ ink: Object.keys(ink).length ? ink : null, updatedAt: new Date() })
		.where(eq(dailyReports.id, id));
}

export async function deleteReport(id: number) {
	await db.delete(dailyReports).where(eq(dailyReports.id, id));
	badgesChanged();
}

export function mayView(user: SessionUser, report: { createdBy: number | null; partyId: number | null }): boolean {
	if (can(user.role, 'tagesberichte.alle.sehen')) return true;
	if (!can(user.role, 'tagesberichte.sehen')) return false;
	if (report.createdBy === user.id) return true;
	return !!user.partyId && user.partyId === report.partyId;
}

/**
 * Am Bericht arbeiten: in Arbeit wer bearbeiten darf, freigegeben nur noch wer
 * prüft (um vor dem Prüfen zu korrigieren). Geprüfte und abgeschlossene
 * Berichte nur nach dem Wieder öffnen.
 */
export function mayWork(user: SessionUser, report: { createdBy: number | null; partyId: number | null; status: string }): boolean {
	if (!mayView(user, report)) return false;
	if (report.status === 'entwurf') return can(user.role, 'tagesberichte.bearbeiten');
	if (report.status === 'freigegeben') return can(user.role, 'tagesberichte.pruefen');
	return false;
}

/**
 * Ändern: wie oben – aber nicht mehr, sobald der Kunde vor Ort unterschrieben
 * hat. Sonst stünde seine Unterschrift unter anderen Zahlen, als er gesehen hat.
 */
export function mayEdit(
	user: SessionUser,
	report: { createdBy: number | null; partyId: number | null; status: string; customerSignature?: string | null }
): boolean {
	return mayWork(user, report) && !report.customerSignature;
}

/** Wieder öffnen hängt am Status – jeder hat sein eigenes Recht */
export function mayReopen(role: Role, status: string): boolean {
	if (status === 'freigegeben') return can(role, 'tagesberichte.oeffnen.freigegeben');
	if (status === 'geprueft') return can(role, 'tagesberichte.oeffnen.geprueft');
	if (status === 'abgeschlossen') return can(role, 'tagesberichte.oeffnen.abgeschlossen');
	return false;
}

/**
 * Artikel für den Materialblock: alle aktiven, mit Farbe und Materialart.
 * Daraus kommen Material (die Farbe) und Kenn-Nr. (der Artikelname).
 */
export async function materialProducts() {
	return db
		.select({
			id: products.id,
			name: products.name,
			articleNumber: products.articleNumber,
			colorName: colors.name,
			categoryName: categories.name
		})
		.from(products)
		.leftJoin(colors, eq(colors.id, products.colorId))
		.leftJoin(categories, eq(categories.id, products.categoryId))
		.where(eq(products.active, true))
		.orderBy(asc(sql`coalesce(${categories.sortOrder}, 9999)`), asc(categories.name), asc(products.name))
		.all();
}

/** Zuletzt verwendete Straßen und Baustellen als Vorschläge */
export async function recentPlaces(): Promise<{ roads: string[]; sites: string[] }> {
	const rows = await db
		.select({ road: dailyReports.road, site: dailyReports.site })
		.from(dailyReports)
		.orderBy(desc(dailyReports.date))
		.limit(200)
		.all();
	const uniq = (list: string[]) => [...new Set(list.filter((v) => v.trim()))].slice(0, 50);
	return { roads: uniq(rows.map((r) => r.road)), sites: uniq(rows.map((r) => r.site)) };
}
