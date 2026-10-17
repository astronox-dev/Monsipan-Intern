/**
 * Arbeitsauftrag am Auftrag: anlegen (vorbelegt aus dem Auftrag und der
 * Wochenplanung), speichern nach Rechten, Unterschriften und Unterweisungen.
 * Inhalt und Regeln stehen in ../work-order.ts.
 */
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { planEntries, users, workOrders } from '$lib/server/db/schema';
import { can } from '$lib/permissions';
import type { SessionUser } from '$lib/server/auth';
import {
	creationForm,
	emptyFoil,
	emptyForm,
	lineTitle,
	sanitizeFoil,
	type FoilSignatureRole,
	MAX_BRIEFINGS,
	MAX_WORK_LINES,
	mergeForm,
	readContent,
	type SignatureRole,
	type WorkBriefing,
	type WorkOrderContent,
	type WorkOrderForm,
	type WorkScope,
	type WorkSignature
} from '../work-order';
import { mayViewOrder, maySetOrderStatus, type OrderDetail } from './orders';

/** Büro: wer Aufträge bearbeitet; Baustelle: zusätzlich die Partie, die den Stand setzt */
export function workScope(user: SessionUser, order: { partyId: number | null }): WorkScope {
	const office = can(user.role, 'auftraege.bearbeiten') && mayViewOrder(user, order);
	return { office, site: office || maySetOrderStatus(user, order) };
}

export async function getWorkOrder(orderId: number) {
	const row = await db.select().from(workOrders).where(eq(workOrders.orderId, orderId)).get();
	if (!row) return null;
	const editor = row.updatedBy ? await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, row.updatedBy)).get() : null;
	return {
		id: row.id,
		orderId: row.orderId,
		content: readContent(row.content),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		updatedByName: editor ? [editor.firstName, editor.lastName].filter(Boolean).join(' ') : ''
	};
}

export type WorkOrderDetail = NonNullable<Awaited<ReturnType<typeof getWorkOrder>>>;

/** Für die Auftragsseite: gibt es einen, und hat der Auftraggeber schon unterschrieben? */
export async function workOrderSummary(orderId: number) {
	const w = await getWorkOrder(orderId);
	if (!w) return null;
	return { customerSigned: w.content.signatures.auftraggeber?.at ?? null, updatedAt: w.updatedAt ?? w.createdAt };
}

/** Erster und letzter Tag, an dem der Auftrag in der Wochenplanung steht */
async function plannedDays(orderId: number) {
	const row = await db
		.select({ first: sql<string | null>`min(${planEntries.date})`, last: sql<string | null>`max(${planEntries.date})` })
		.from(planEntries)
		.where(and(eq(planEntries.orderId, orderId), isNotNull(planEntries.date)))
		.get();
	return { first: row?.first ?? '', last: row?.last ?? '' };
}

/**
 * Vorbelegt aus dem Auftrag: BV, Nummer, Ausführungsort als Baustelle, der
 * Ansprechpartner des Kunden, die Positionen als Leistungen (erste Zeile,
 * Menge, Einheit) und – wenn eingeplant – die Tage aus der Wochenplanung.
 */
export async function prefill(order: OrderDetail): Promise<WorkOrderContent> {
	const form = emptyForm();
	const days = await plannedDays(order.id);
	form.title = order.title;
	form.site = order.location;
	form.startDate = days.first;
	form.endDate = days.last;
	form.contacts[0] = { name: order.customerContact, phone: order.customerPhone };
	form.lines = order.lines
		.filter((l) => l.kind === 'position' && l.text.trim())
		.slice(0, MAX_WORK_LINES)
		.map((l) => ({ text: lineTitle(l.text), kind: '', ral: '', msk: '', quantity: l.quantity, unit: l.unit, done: null }));
	return { ...form, signatures: {}, briefings: [], foil: { ...emptyFoil(), place: form.site } };
}

/**
 * Anlegen – mit dem, was das Büro vorher ausgefüllt hat (Kopf, Beilagen,
 * Evaluierung, Angaben zu den Leistungen, Rückseite). Die Leistungen selbst
 * kommen immer aus dem Auftrag. Gibt es schon einen, bleibt er, wie er ist;
 * zurück kommt, ob einer neu angelegt wurde.
 */
export async function createWorkOrder(order: OrderDetail, userId: number, form?: WorkOrderForm): Promise<boolean> {
	const prefilled = await prefill(order);
	const content: WorkOrderContent = form ? { ...prefilled, ...creationForm(prefilled, form), foil: { ...prefilled.foil, place: form.site } } : prefilled;
	const rows = await db.insert(workOrders).values({ orderId: order.id, content, createdBy: userId }).onConflictDoNothing().returning({ id: workOrders.id });
	return rows.length > 0;
}

export async function hasWorkOrder(orderId: number): Promise<boolean> {
	return !!(await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.orderId, orderId)).get());
}

/** Inhalt lesen, ändern und zurückschreiben – in einer Transaktion */
async function change(orderId: number, userId: number, fn: (c: WorkOrderContent) => WorkOrderContent | string): Promise<string | null> {
	return db.transaction(async (tx) => {
		const row = await tx.select({ content: workOrders.content }).from(workOrders).where(eq(workOrders.orderId, orderId)).get();
		if (!row) return 'Zu diesem Auftrag gibt es keinen Arbeitsauftrag.';
		const next = fn(readContent(row.content));
		if (typeof next === 'string') return next;
		await tx.update(workOrders).set({ content: next, updatedBy: userId, updatedAt: new Date() }).where(eq(workOrders.orderId, orderId));
		return null;
	});
}

const LOCKED = 'Der Auftraggeber hat schon unterschrieben – zum Ändern zuerst seine Unterschrift entfernen.';

/** Formular speichern – nur, was der Benutzer ändern darf. Gibt eine Meldung zurück, wenn nicht. */
export function saveWorkOrderForm(orderId: number, form: WorkOrderForm, scope: WorkScope, userId: number) {
	return change(orderId, userId, (c) => (c.signatures.auftraggeber ? LOCKED : { ...c, ...mergeForm(c, form, scope) }));
}

export function setWorkOrderSignature(orderId: number, role: SignatureRole, signature: WorkSignature | null, userId: number) {
	return change(orderId, userId, (c) => {
		// Nach dem Auftraggeber ist alles fest – nur seine eigene Unterschrift lässt sich wieder entfernen
		if (c.signatures.auftraggeber && role !== 'auftraggeber') return LOCKED;
		const signatures = { ...c.signatures };
		if (signature) signatures[role] = signature;
		else delete signatures[role];
		return { ...c, signatures };
	});
}

export function addBriefing(orderId: number, briefing: WorkBriefing, userId: number) {
	return change(orderId, userId, (c) => {
		if (c.signatures.auftraggeber) return LOCKED;
		if (c.briefings.length >= MAX_BRIEFINGS) return `Mehr als ${MAX_BRIEFINGS} Unterweisungen passen nicht aufs Formular.`;
		return { ...c, briefings: [...c.briefings, briefing] };
	});
}

export function removeBriefing(orderId: number, index: number, userId: number) {
	return change(orderId, userId, (c) => {
		if (c.signatures.auftraggeber) return LOCKED;
		if (!c.briefings[index]) return 'Diese Unterweisung gibt es nicht mehr.';
		return { ...c, briefings: c.briefings.filter((_, i) => i !== index) };
	});
}

const FOIL_LOCKED = 'Der Auftraggeber hat das Verlegeprotokoll schon unterschrieben – zum Ändern zuerst seine Unterschrift entfernen.';

/** 3M-Verlegeprotokoll speichern – die Unterschriften bleiben, wie sie sind */
export function saveFoilProtocol(orderId: number, raw: unknown, userId: number) {
	return change(orderId, userId, (c) => {
		if (c.signatures.auftraggeber) return LOCKED;
		if (c.foil.signatures.auftraggeber) return FOIL_LOCKED;
		return { ...c, foil: { ...sanitizeFoil(raw), signatures: c.foil.signatures } };
	});
}

export function setFoilSignature(orderId: number, role: FoilSignatureRole, signature: WorkSignature | null, userId: number) {
	return change(orderId, userId, (c) => {
		if (c.signatures.auftraggeber) return LOCKED;
		if (c.foil.signatures.auftraggeber && role !== 'auftraggeber') return FOIL_LOCKED;
		const signatures = { ...c.foil.signatures };
		if (signature) signatures[role] = signature;
		else delete signatures[role];
		return { ...c, foil: { ...c.foil, signatures } };
	});
}

export async function deleteWorkOrder(orderId: number) {
	await db.delete(workOrders).where(eq(workOrders.orderId, orderId));
}

/** Namen für die Unterweisung: die aktiven Leute der Partie des Auftrags */
export async function crewNames(partyId: number | null): Promise<string[]> {
	if (!partyId) return [];
	const rows = await db
		.select({ firstName: users.firstName, lastName: users.lastName, username: users.username })
		.from(users)
		.where(and(eq(users.partyId, partyId), eq(users.active, true), sql`${users.deletedAt} is null`))
		.orderBy(asc(users.firstName), asc(users.lastName))
		.all();
	return rows.map((u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username);
}
