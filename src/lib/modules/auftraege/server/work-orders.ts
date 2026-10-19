/**
 * Arbeitsauftrag am Auftrag: anlegen (vorbelegt aus Auftrag bzw. Angebot,
 * Wochenplanung und dem letzten Arbeitsauftrag), speichern nach Rechten –
 * samt 3M-Verlegeprotokoll –, Unterschriften und Unterweisungen.
 * Inhalt und Regeln stehen in ../work-order.ts.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { planEntries, users, workOrders } from '$lib/server/db/schema';
import { can } from '$lib/permissions';
import type { SessionUser } from '$lib/server/auth';
import { today } from '$lib/modules/stunden/week';
import { syncWorkOrderPlan } from '$lib/modules/planung/server/plan';
import { isValidSignature } from '$lib/modules/stunden/signature';
import {
	closeMessage,
	creationForm,
	emptyForm,
	guessLine,
	isPristineFoil,
	lineTitle,
	MAX_BRIEFINGS,
	MAX_WORK_LINES,
	mergeForm,
	prefillFoil,
	readContent,
	sanitizeFoil,
	sanitizeForm,
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
		.where(eq(planEntries.orderId, orderId))
		.get();
	return { first: row?.first ?? '', last: row?.last ?? '' };
}

/** Was meist gleich bleibt, kommt vom zuletzt angelegten Arbeitsauftrag: Beilagen, Evaluierung, Rückseite, Folientyp */
async function lastDefaults() {
	const row = await db.select({ content: workOrders.content }).from(workOrders).orderBy(desc(workOrders.createdAt), desc(workOrders.id)).limit(1).get();
	if (!row) return null;
	const c = readContent(row.content);
	return {
		attachments: c.attachments,
		evaluation: c.evaluation,
		ppe: c.ppe,
		hazards: c.hazards,
		filmType: c.foil.films.find((f) => f.type)?.type ?? ''
	};
}

/** Woraus ein Arbeitsauftrag entsteht – ein Auftrag oder, beim Erstellen in einem Schritt, das Angebot */
export interface WorkOrderSource {
	/** Nur bei einem schon bestehenden Auftrag – für die Tage aus der Wochenplanung */
	orderId?: number;
	title: string;
	location: string;
	customerContact: string;
	customerPhone: string;
	lines: { kind: string; text: string; quantity: number | null; unit: string }[];
}

/**
 * Vorbelegt: BV, Ausführungsort als Baustelle, Ansprechpartner des Kunden,
 * die Positionen als Leistungen (erste Zeile, Menge, Einheit – Art, RAL und
 * MSK aus dem Text erraten), die Tage aus der Wochenplanung, Beilagen,
 * Evaluierung und Rückseite wie beim letzten Arbeitsauftrag. Mit einer
 * Folien-Leistung steht das Folienverlegeprotokoll gleich auf „ja".
 */
export async function prefill(source: WorkOrderSource, defaults?: Awaited<ReturnType<typeof lastDefaults>>): Promise<WorkOrderContent> {
	const form = emptyForm();
	const [days, last] = await Promise.all([source.orderId ? plannedDays(source.orderId) : null, defaults === undefined ? lastDefaults() : defaults]);
	form.title = source.title;
	form.site = source.location;
	form.startDate = days?.first ?? '';
	form.endDate = days?.last ?? '';
	form.contacts[0] = { name: source.customerContact, phone: source.customerPhone };
	form.lines = source.lines
		.filter((l) => l.kind === 'position' && l.text.trim())
		.slice(0, MAX_WORK_LINES)
		.map((l) => ({ text: lineTitle(l.text), ...guessLine(l.text), quantity: l.quantity, unit: l.unit, done: null }));
	if (last) {
		// Pläne hängen am einzelnen Auftrag – das Häkchen setzt erst, wer welche hochlädt
		form.attachments = { ...last.attachments, plans: false };
		form.evaluation = last.evaluation;
		form.ppe = last.ppe;
		form.hazards = last.hazards;
	}
	if (form.lines.some((l) => l.kind === 'Folie')) form.foilProtocol = 'ja';
	return { ...form, signatures: {}, briefings: [], foil: prefillFoil(form, last?.filmType) };
}

/** Bestehender Auftrag als Quelle */
export const orderSource = (order: OrderDetail): WorkOrderSource => ({
	orderId: order.id,
	title: order.title,
	location: order.location,
	customerContact: order.customerContact,
	customerPhone: order.customerPhone,
	lines: order.lines
});

/**
 * Anlegen – mit dem, was das Büro vorher ausgefüllt hat (Kopf, Beilagen,
 * Evaluierung, Angaben zu den Leistungen, Folienverlegeprotokoll, Rückseite).
 * Die Leistungen selbst kommen immer aus dem Auftrag; das 3M-Protokoll wird
 * aus dem Ergebnis vorbelegt. Mit `bl` unterschreibt der Bauleiter gleich mit.
 * Gibt es schon einen, bleibt er, wie er ist; zurück kommt, ob einer neu
 * angelegt wurde.
 */
export async function createWorkOrder(order: OrderDetail, userId: number, form?: WorkOrderForm, bl?: WorkSignature): Promise<boolean> {
	const last = await lastDefaults();
	const prefilled = await prefill(orderSource(order), last);
	const made = form ? creationForm(prefilled, form) : prefilled;
	const content: WorkOrderContent = {
		...prefilled,
		...made,
		signDate: bl ? today() : made.signDate,
		signatures: bl ? { bl } : {},
		// Aus den Leistungen, wie sie jetzt feststehen – der Folientyp vom letzten Protokoll
		foil: prefillFoil(made, last?.filmType)
	};
	const rows = await db.insert(workOrders).values({ orderId: order.id, content, createdBy: userId }).onConflictDoNothing().returning({ id: workOrders.id });
	// Mit Termin und Partie steht der Auftrag gleich in der Wochenplanung
	if (rows.length) await syncWorkOrderPlan(order.id, userId);
	return rows.length > 0;
}

/** Abschließen erst mit abgehakter Vorarbeiter-Checkliste – ohne Arbeitsauftrag gibt es keine */
export async function closeBlocker(orderId: number): Promise<string | null> {
	const row = await db.select({ content: workOrders.content }).from(workOrders).where(eq(workOrders.orderId, orderId)).get();
	return row ? closeMessage(readContent(row.content)) : null;
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

/**
 * Formular speichern – nur, was der Benutzer ändern darf. Das 3M-Protokoll
 * (`foil`) gehört zur Baustelle; steht es neu auf „ja" und ist noch leer,
 * wird es vorbelegt. Gibt eine Meldung zurück, wenn nicht gespeichert wurde.
 */
export async function saveWorkOrderForm(orderId: number, form: WorkOrderForm, scope: WorkScope, userId: number, foil?: unknown) {
	const problem = await change(orderId, userId, (c) => {
		if (c.signatures.auftraggeber) return LOCKED;
		const next: WorkOrderContent = { ...c, ...mergeForm(c, form, scope) };
		if (scope.site && foil !== undefined && next.foilProtocol === 'ja') next.foil = { ...sanitizeFoil(foil), signatures: c.foil.signatures };
		if (next.foilProtocol === 'ja' && isPristineFoil(next.foil)) next.foil = { ...prefillFoil(next), signatures: c.foil.signatures };
		return next;
	});
	// Den Termin ändert nur das Büro – die Wochenplanung zieht mit
	if (!problem && scope.office) await syncWorkOrderPlan(orderId, userId);
	return problem;
}

/**
 * Unterschrift setzen oder entfernen. Unterschreibt der Auftraggeber, ist die
 * Arbeit fertig: „Arbeit fertig am" bekommt den Tag, wenn noch keiner steht.
 */
export function setWorkOrderSignature(orderId: number, role: SignatureRole, signature: WorkSignature | null, userId: number) {
	return change(orderId, userId, (c) => {
		// Nach dem Auftraggeber ist alles fest – nur seine eigene Unterschrift lässt sich wieder entfernen
		if (c.signatures.auftraggeber && role !== 'auftraggeber') return LOCKED;
		const signatures = { ...c.signatures };
		if (signature) signatures[role] = signature;
		else delete signatures[role];
		const finishedOn = role === 'auftraggeber' && signature && !c.finishedOn ? today() : c.finishedOn;
		return { ...c, signatures, finishedOn };
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

export async function deleteWorkOrder(orderId: number) {
	await db.delete(workOrders).where(eq(workOrders.orderId, orderId));
	// Was der Termin in die Wochenplanung gestellt hat, geht mit
	await syncWorkOrderPlan(orderId, null);
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

/**
 * Das Vorab-Formular aus der Anfrage lesen: Inhalt („inhalt") und – bei
 * „… und als BL unterschreiben" – Name und Unterschrift des Bauleiters.
 */
export function readCreation(form: FormData): { form: WorkOrderForm; bl?: WorkSignature } | { message: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(String(form.get('inhalt') ?? '{}'));
	} catch {
		return { message: 'Das Formular ist unvollständig angekommen – bitte die Seite neu laden.' };
	}
	const path = String(form.get('bl_unterschrift') ?? '');
	if (!path) return { form: sanitizeForm(raw) };
	const name = String(form.get('bl_name') ?? '').trim().slice(0, 120);
	if (name.length < 2) return { message: 'Bitte den Namen für die Unterschrift eintragen.' };
	if (!isValidSignature(path)) return { message: 'Die Unterschrift ist nicht angekommen – bitte noch einmal unterschreiben.' };
	return { form: sanitizeForm(raw), bl: { path, name, at: Date.now() } };
}
