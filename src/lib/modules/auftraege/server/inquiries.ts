/**
 * Anfragen: eine hineinkopierte E-Mail mit Absender, Betreff und Ort – oder
 * eine Anfrage über das Kontaktformular der Webseite (siehe ./website). Daraus
 * wird ein Angebot – mit Kunde, BV und Ausführungsort aus der Anfrage. Ist das
 * Angebot angenommen (oder die Anfrage von Hand abgelegt), ist sie erledigt und
 * steht nicht mehr bei den offenen.
 *
 * Stand: Neu → In Arbeit (von Hand, noch ohne Angebot – oder das Angebot ist
 * noch ein Entwurf) → der Stand des Angebots → erledigt.
 */
import { and, desc, eq, isNotNull, isNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '$lib/server/db';
import { customers, inquiries, offers, users } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { companyDomain, MAX_INQUIRY_TEXT } from '../inquiry';
import { createOffer } from './offers';

const creator = alias(users, 'creator');
const worker = alias(users, 'worker');

/** Erledigt: Angebot angenommen oder von Hand abgelegt */
const done = or(isNotNull(inquiries.closedAt), eq(offers.status, 'angenommen'));
const open = and(isNull(inquiries.closedAt), or(isNull(offers.id), ne(offers.status, 'angenommen')));
/** Noch niemand dran: kein Angebot, nicht in Arbeit genommen */
const fresh = and(isNull(inquiries.closedAt), isNull(offers.id), isNull(inquiries.inProgressAt));
/** In Arbeit: von Hand genommen (noch ohne Angebot) oder das Angebot ist ein Entwurf */
const working = and(isNull(inquiries.closedAt), or(and(isNull(offers.id), isNotNull(inquiries.inProgressAt)), eq(offers.status, 'entwurf')));

export const INQUIRY_STATES = ['offen', 'neu', 'inarbeit', 'erledigt'] as const;
export type InquiryState = (typeof INQUIRY_STATES)[number];
const STATE_WHERE: Record<InquiryState, SQL | undefined> = { offen: open, neu: fresh, inarbeit: working, erledigt: done };

export interface InquiryFilter {
	q?: string;
	/** „offen" (Standard), „neu", „inarbeit" oder „erledigt" */
	state?: string;
}

export async function listInquiries(filter: InquiryFilter = {}, limit = 200) {
	const where: (SQL | undefined)[] = [STATE_WHERE[filter.state as InquiryState] ?? open];
	if (filter.q?.trim()) {
		const q = `%${filter.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(
			or(
				like(inquiries.subject, q),
				like(inquiries.senderName, q),
				like(inquiries.senderEmail, q),
				like(inquiries.senderCompany, q),
				like(inquiries.location, q),
				like(customers.name, q),
				like(offers.number, q)
			)
		);
	}
	return db
		.select({
			id: inquiries.id,
			receivedOn: inquiries.receivedOn,
			subject: inquiries.subject,
			senderName: inquiries.senderName,
			senderEmail: inquiries.senderEmail,
			senderCompany: inquiries.senderCompany,
			source: inquiries.source,
			location: inquiries.location,
			customerName: customers.name,
			closedAt: inquiries.closedAt,
			inProgressAt: inquiries.inProgressAt,
			offerId: offers.id,
			offerNumber: offers.number,
			offerStatus: offers.status
		})
		.from(inquiries)
		.leftJoin(customers, eq(customers.id, inquiries.customerId))
		.leftJoin(offers, eq(offers.id, inquiries.offerId))
		.where(and(...where))
		.orderBy(desc(inquiries.receivedOn), desc(inquiries.id))
		.limit(limit)
		.all();
}

/** Wie viele je Stand – für die Zahlen an den Reitern; `fresh` = ohne Angebot (Übersicht) */
export async function countInquiries() {
	const row = await db
		.select({
			open: sql<number>`sum(case when ${open} then 1 else 0 end)`.mapWith(Number),
			neu: sql<number>`sum(case when ${fresh} then 1 else 0 end)`.mapWith(Number),
			working: sql<number>`sum(case when ${working} then 1 else 0 end)`.mapWith(Number),
			done: sql<number>`sum(case when ${done} then 1 else 0 end)`.mapWith(Number),
			fresh: sql<number>`sum(case when ${inquiries.closedAt} is null and ${inquiries.offerId} is null then 1 else 0 end)`.mapWith(Number)
		})
		.from(inquiries)
		.leftJoin(offers, eq(offers.id, inquiries.offerId))
		.get();
	return { open: row?.open ?? 0, neu: row?.neu ?? 0, working: row?.working ?? 0, done: row?.done ?? 0, fresh: row?.fresh ?? 0 };
}

export interface InquiryInput {
	receivedOn: string;
	subject: string;
	body: string;
	senderName: string;
	senderEmail: string;
	senderPhone: string;
	senderCompany: string;
	customerId: number | null;
	location: string;
	note: string;
}

/** Formular auslesen und kürzen */
export function readInquiry(form: FormData): InquiryInput {
	const s = (k: string, max: number) =>
		String(form.get(k) ?? '')
			.replace(/\r\n/g, '\n')
			.trim()
			.slice(0, max);
	const customer = Number(form.get('kunde'));
	return {
		receivedOn: s('eingang', 10),
		subject: s('betreff', 300),
		body: s('text', MAX_INQUIRY_TEXT),
		senderName: s('name', 160),
		senderEmail: s('email', 200),
		senderPhone: s('telefon', 60),
		senderCompany: s('firma', 160),
		customerId: Number.isInteger(customer) && customer > 0 ? customer : null,
		location: s('ort', 300),
		note: s('notiz', 2000)
	};
}

export function inquiryProblem(i: InquiryInput): string | null {
	if (!i.body && !i.subject) return 'Bitte die E-Mail einfügen oder zumindest einen Betreff eintragen.';
	if (i.senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.senderEmail)) return 'Die E-Mail-Adresse stimmt nicht.';
	return null;
}

/** Neue Anfrage – von Hand (`user`) oder ohne Person über die Webseite (`source`) */
export async function createInquiry(user: Pick<SessionUser, 'id'> | null, data: InquiryInput, source = ''): Promise<number> {
	const row = await db
		.insert(inquiries)
		.values({ ...data, source, createdBy: user?.id ?? null, updatedAt: new Date() })
		.returning({ id: inquiries.id })
		.get();
	return row.id;
}

export async function updateInquiry(id: number, data: InquiryInput) {
	await db
		.update(inquiries)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(inquiries.id, id));
}

export async function inquiryDetail(id: number) {
	if (!Number.isInteger(id)) return null;
	const row = await db
		.select({
			id: inquiries.id,
			receivedOn: inquiries.receivedOn,
			subject: inquiries.subject,
			body: inquiries.body,
			senderName: inquiries.senderName,
			senderEmail: inquiries.senderEmail,
			senderPhone: inquiries.senderPhone,
			senderCompany: inquiries.senderCompany,
			source: inquiries.source,
			customerId: inquiries.customerId,
			customerName: customers.name,
			customerCity: customers.city,
			location: inquiries.location,
			note: inquiries.note,
			closedAt: inquiries.closedAt,
			inProgressAt: inquiries.inProgressAt,
			workerFirst: worker.firstName,
			workerLast: worker.lastName,
			offerId: offers.id,
			offerNumber: offers.number,
			offerStatus: offers.status,
			createdAt: inquiries.createdAt,
			creatorFirst: creator.firstName,
			creatorLast: creator.lastName
		})
		.from(inquiries)
		.leftJoin(customers, eq(customers.id, inquiries.customerId))
		.leftJoin(offers, eq(offers.id, inquiries.offerId))
		.leftJoin(creator, eq(creator.id, inquiries.createdBy))
		.leftJoin(worker, eq(worker.id, inquiries.inProgressBy))
		.where(eq(inquiries.id, id))
		.get();
	return row ?? null;
}

export type InquiryDetail = NonNullable<Awaited<ReturnType<typeof inquiryDetail>>>;

/** Die Anfrage zu einem Angebot – fürs Angebot, um die E-Mail daneben zu sehen */
export function inquiryForOffer(offerId: number) {
	return db
		.select({ id: inquiries.id, receivedOn: inquiries.receivedOn, subject: inquiries.subject, body: inquiries.body, senderName: inquiries.senderName, senderEmail: inquiries.senderEmail })
		.from(inquiries)
		.where(eq(inquiries.offerId, offerId))
		.get();
}

export async function setInquiryCustomer(id: number, customerId: number) {
	await db.update(inquiries).set({ customerId, updatedAt: new Date() }).where(eq(inquiries.id, id));
}

/** In Arbeit nehmen (`userId`) bzw. zurück auf neu (`null`) */
export async function setInquiryInProgress(id: number, userId: number | null) {
	await db
		.update(inquiries)
		.set({ inProgressAt: userId ? new Date() : null, inProgressBy: userId, updatedAt: new Date() })
		.where(eq(inquiries.id, id));
}

/** Von Hand ablegen bzw. wieder zu den offenen holen */
export async function closeInquiry(id: number, closed: boolean) {
	await db
		.update(inquiries)
		.set({ closedAt: closed ? new Date() : null, updatedAt: new Date() })
		.where(eq(inquiries.id, id));
}

/** Das Angebot bleibt – es verliert nur den Verweis auf die Anfrage */
export async function deleteInquiry(id: number) {
	await db.delete(inquiries).where(eq(inquiries.id, id));
}

/**
 * Passender Kunde zur Absender-Adresse: dieselbe E-Mail, sonst dieselbe
 * Firmen-Domain (nicht bei Freemail-Adressen) – nur wenn es genau einen gibt.
 */
export async function matchCustomer(email: string): Promise<number | null> {
	const e = email.trim().toLowerCase();
	if (!e) return null;
	const exact = await db
		.select({ id: customers.id })
		.from(customers)
		.where(and(eq(customers.active, true), sql`lower(${customers.email}) = ${e}`))
		.all();
	if (exact.length === 1) return exact[0].id;
	const domain = companyDomain(e);
	if (!domain) return null;
	const same = await db
		.select({ id: customers.id })
		.from(customers)
		.where(and(eq(customers.active, true), sql`lower(${customers.email}) like ${`%@${domain}`}`))
		.all();
	return same.length === 1 ? same[0].id : null;
}

/**
 * Angebot aus der Anfrage: Kunde, BV (Betreff) und Ausführungsort gehen mit,
 * die Anfrage verweist danach auf das Angebot. Gibt die ID des Angebots zurück.
 */
export async function offerFromInquiry(
	user: SessionUser,
	inquiry: InquiryDetail,
	data: { number: string; projectNumber: string; date: string; title: string; customerId: number | null }
): Promise<number> {
	const id = await createOffer(user, { ...data, location: inquiry.location });
	await db.update(inquiries).set({ offerId: id, customerId: data.customerId ?? inquiry.customerId, updatedAt: new Date() }).where(eq(inquiries.id, inquiry.id));
	return id;
}
