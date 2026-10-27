/**
 * Angebote: anlegen, bearbeiten, freigeben, Link an den Kunden. Der Kunde
 * nimmt über den Link an (Name und Unterschrift) oder wünscht Änderungen –
 * dann wird das Angebot überarbeitet und neu freigegeben, der Link bleibt.
 * Sagt er anders zu (Telefon, E-Mail), wird es intern auf angenommen gesetzt.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { can } from '$lib/permissions';
import { db } from '$lib/server/db';
import { customers, offerPositions, offers, orders, planEntries, users, type OfferStatus } from '$lib/server/db/schema';
import { col } from '$lib/server/db/sql';
import { getSettings } from '$lib/server/settings';
import type { SessionUser } from '$lib/server/auth';
import { MAX_OFFER_LINES, parseAmount } from '../offer';

const creator = alias(users, 'creator');
const releaser = alias(users, 'releaser');
const accepter = alias(users, 'accepter');

/** Netto-Summe je Angebot, direkt in der Abfrage */
const netSum = sql<number>`(select coalesce(sum(round(${col(offerPositions.quantity)} * ${col(offerPositions.unitPrice)}, 2)), 0) from ${offerPositions} where ${col(offerPositions.offerId)} = ${col(offers.id)} and ${col(offerPositions.kind)} = 'position' and not ${col(offerPositions.alternative)})`.mapWith(
	Number
);
/** Netto nach Nachlass – davon gehen Umsatzsteuer und Brutto in der Liste aus */
const netAfterDiscount = sql<number>`(${netSum} - min(${netSum}, case when ${col(offers.discountAmount)} > 0 then ${col(offers.discountAmount)} else round(${netSum} * ${col(offers.discountPercent)} / 100.0, 2) end))`.mapWith(
	Number
);
const orderOf = sql<number | null>`(select ${col(orders.id)} from ${orders} where ${col(orders.offerId)} = ${col(offers.id)})`;

export interface OfferFilter {
	q?: string;
	/** „offen" (noch nicht angenommen), ein Stand oder „abgerechnet" */
	status?: string;
	/** Nur ein Jahr (nach Angebotsdatum), „2026" */
	year?: string;
}

function offerWhere(filter: OfferFilter, withYear = true): SQL | undefined {
	const where: (SQL | undefined)[] = [];
	if (filter.status === 'offen') where.push(inArray(offers.status, ['entwurf', 'freigegeben', 'aenderung']));
	// „Angenommen" sind die noch nicht abgerechneten – abgerechnet ist ein eigener Stand
	else if (filter.status === 'angenommen') where.push(eq(offers.status, 'angenommen'), isNull(offers.billedAt));
	else if (filter.status === 'abgerechnet') where.push(eq(offers.status, 'angenommen'), isNotNull(offers.billedAt));
	else if (filter.status) where.push(eq(offers.status, filter.status as OfferStatus));
	if (filter.q?.trim()) {
		const q = `%${filter.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(
			or(like(offers.number, q), like(offers.title, q), like(offers.location, q), like(offers.customerName, q), like(offers.projectNumber, q))
		);
	}
	if (withYear && filter.year && /^\d{4}$/.test(filter.year)) where.push(gte(offers.date, `${filter.year}-01-01`), lte(offers.date, `${filter.year}-12-31`));
	return and(...where);
}

/** Wie viele Angebote der Filter trifft – zum Blättern */
export async function countOffers(filter: OfferFilter = {}): Promise<number> {
	const row = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(offers).where(offerWhere(filter)).get();
	return row?.n ?? 0;
}

/** Jahre (nach Angebotsdatum) mit ihrer Anzahl, neueste zuerst */
export async function offerYears(filter: OfferFilter = {}) {
	const year = sql<string>`substr(${offers.date}, 1, 4)`;
	return db
		.select({ year, n: sql<number>`count(*)`.mapWith(Number) })
		.from(offers)
		.where(offerWhere(filter, false))
		.groupBy(year)
		.orderBy(desc(year))
		.all();
}

export async function listOffers(filter: OfferFilter = {}, limit = 100, offset = 0) {
	return db
		.select({
			id: offers.id,
			number: offers.number,
			projectNumber: offers.projectNumber,
			date: offers.date,
			title: offers.title,
			customerName: offers.customerName,
			customerCity: offers.customerCity,
			status: offers.status,
			billedAt: offers.billedAt,
			vatRate: offers.vatRate,
			reverseCharge: offers.reverseCharge,
			net: netAfterDiscount,
			orderId: orderOf
		})
		.from(offers)
		.where(offerWhere(filter))
		.orderBy(desc(offers.date), desc(offers.id))
		.limit(limit)
		.offset(offset)
		.all();
}

/** Für die Übersicht: Angebote je Stand und angenommene, zu denen es noch keinen Auftrag gibt */
export async function offerCounts() {
	const rows = await db
		.select({
			status: offers.status,
			n: sql<number>`count(*)`.mapWith(Number),
			withoutOrder: sql<number>`sum(case when ${orderOf} is null then 1 else 0 end)`.mapWith(Number)
		})
		.from(offers)
		.groupBy(offers.status)
		.all();
	const out = { entwurf: 0, freigegeben: 0, aenderung: 0, angenommen: 0, acceptedWithoutOrder: 0 };
	for (const r of rows) {
		out[r.status] = r.n;
		if (r.status === 'angenommen') out.acceptedWithoutOrder = r.withoutOrder;
	}
	return out;
}

/**
 * Positionen, die schon in Angeboten standen – je Bezeichnung einmal, mit
 * Bemerkung, Einheit und Einheitspreis vom letzten Mal und wie oft sie
 * vorkam. Für die Vorschläge beim Schreiben eines Angebots.
 */
export async function positionMemory(limit = 500) {
	const latest = db
		.select({
			text: offerPositions.text,
			uses: sql<number>`count(*)`.as('uses'),
			last: sql<number>`max(${offerPositions.id})`.as('last')
		})
		.from(offerPositions)
		.where(and(eq(offerPositions.kind, 'position'), sql`trim(${offerPositions.text}) <> ''`))
		.groupBy(offerPositions.text)
		.as('latest');
	const rows = await db
		.select({ text: offerPositions.text, note: offerPositions.note, unit: offerPositions.unit, unitPrice: offerPositions.unitPrice, uses: latest.uses })
		.from(offerPositions)
		.innerJoin(latest, eq(offerPositions.id, latest.last))
		.orderBy(desc(latest.uses), desc(latest.last))
		.limit(limit)
		.all();
	return rows.map((r) => ({ ...r, uses: Number(r.uses) }));
}

export async function numberTaken(number: string, exceptId?: number): Promise<boolean> {
	const row = await db.select({ id: offers.id }).from(offers).where(eq(offers.number, number)).get();
	return !!row && row.id !== exceptId;
}

/** Anschrift aus dem Kundenstamm für das Angebot */
async function customerSnapshot(customerId: number | null) {
	if (customerId == null) return null;
	const c = await db.select().from(customers).where(eq(customers.id, customerId)).get();
	if (!c) return null;
	return {
		customerId: c.id,
		customerName: c.name,
		customerAddition: c.addition,
		customerStreet: c.street,
		customerZip: c.zip,
		customerCity: c.city,
		customerUid: c.uid,
		contactName: c.contact,
		contactPhone: c.phone,
		contactEmail: c.email,
		// Bauunternehmen: gleich ohne Umsatzsteuer
		reverseCharge: c.reverseCharge
	};
}

export async function createOffer(
	user: SessionUser,
	data: {
		number: string;
		projectNumber: string;
		date: string;
		title: string;
		customerId: number | null;
		location?: string;
		/** Ansprechperson, wenn sie woanders herkommt (Anfrage) – sonst die aus dem Kundenstamm */
		contact?: { name: string; phone: string; email: string };
	}
): Promise<number> {
	const settings = await getSettings();
	const snapshot = await customerSnapshot(data.customerId);
	const given = data.contact;
	return db.transaction(async (tx) => {
		const row = await tx
			.insert(offers)
			.values({
				number: data.number.slice(0, 30),
				projectNumber: data.projectNumber.slice(0, 30),
				date: data.date,
				title: data.title.slice(0, 300),
				location: (data.location ?? '').slice(0, 300),
				...(snapshot ?? {}),
				...(given?.name || given?.phone || given?.email
					? { contactName: given.name.slice(0, 100), contactPhone: given.phone.slice(0, 60), contactEmail: given.email.slice(0, 200) }
					: {}),
				intro: settings.offerIntro,
				closing: settings.offerClosing,
				paymentDays: settings.invoicePaymentDays,
				skontoPercent: settings.skontoPercent,
				skontoDays: settings.skontoDays,
				createdBy: user.id,
				updatedAt: new Date()
			})
			.returning({ id: offers.id })
			.get();
		await tx.insert(offerPositions).values({ offerId: row.id, sortOrder: 0, unit: 'Pauschal', quantity: 1 });
		return row.id;
	});
}

/**
 * Angebot duplizieren: ein neues in Arbeit mit Kunde (wie er im Angebot steht),
 * Ausführungsort, Texten, Konditionen und allen Zeilen – Nummer, Datum und BV
 * neu. Fotos, Unterlagen, Freigabe und Annahme gehen nicht mit.
 */
export async function duplicateOffer(user: SessionUser, sourceId: number, data: { number: string; date: string; title: string }): Promise<number | null> {
	const source = await db.select().from(offers).where(eq(offers.id, sourceId)).get();
	if (!source) return null;
	const lines = await db.select().from(offerPositions).where(eq(offerPositions.offerId, sourceId)).orderBy(asc(offerPositions.sortOrder), asc(offerPositions.id)).all();
	return db.transaction(async (tx) => {
		const row = await tx
			.insert(offers)
			.values({
				number: data.number.slice(0, 30),
				date: data.date,
				title: data.title.slice(0, 300),
				location: source.location,
				customerId: source.customerId,
				customerName: source.customerName,
				customerAddition: source.customerAddition,
				customerStreet: source.customerStreet,
				customerZip: source.customerZip,
				customerCity: source.customerCity,
				customerUid: source.customerUid,
				contactName: source.contactName,
				contactPhone: source.contactPhone,
				contactEmail: source.contactEmail,
				intro: source.intro,
				closing: source.closing,
				vatRate: source.vatRate,
				reverseCharge: source.reverseCharge,
				paymentDays: source.paymentDays,
				skontoPercent: source.skontoPercent,
				skontoDays: source.skontoDays,
				discountPercent: source.discountPercent,
				discountAmount: source.discountAmount,
				createdBy: user.id,
				updatedAt: new Date()
			})
			.returning({ id: offers.id })
			.get();
		const copy = lines.map(({ id: _id, offerId: _offer, ...l }) => ({ ...l, offerId: row.id }));
		await tx.insert(offerPositions).values(copy.length ? copy : [{ offerId: row.id, sortOrder: 0, unit: 'Pauschal', quantity: 1 }]);
		return row.id;
	});
}

export async function offerDetail(id: number) {
	if (!Number.isInteger(id)) return null;
	return loadOffer(eq(offers.id, id));
}

/** Für die Seite des Kunden: das Angebot zu seinem Link */
export async function offerByToken(token: string) {
	if (!/^[0-9a-f]{32}$/.test(token)) return null;
	return loadOffer(eq(offers.customerToken, token));
}

async function loadOffer(where: SQL) {
	const offer = await db
		.select({
			id: offers.id,
			number: offers.number,
			projectNumber: offers.projectNumber,
			date: offers.date,
			title: offers.title,
			location: offers.location,
			customerId: offers.customerId,
			customerName: offers.customerName,
			customerAddition: offers.customerAddition,
			customerStreet: offers.customerStreet,
			customerZip: offers.customerZip,
			customerCity: offers.customerCity,
			customerUid: offers.customerUid,
			contactName: offers.contactName,
			contactPhone: offers.contactPhone,
			contactEmail: offers.contactEmail,
			intro: offers.intro,
			closing: offers.closing,
			vatRate: offers.vatRate,
			reverseCharge: offers.reverseCharge,
			paymentDays: offers.paymentDays,
			skontoPercent: offers.skontoPercent,
			skontoDays: offers.skontoDays,
			discountPercent: offers.discountPercent,
			discountAmount: offers.discountAmount,
			status: offers.status,
			releasedAt: offers.releasedAt,
			releasedBy: offers.releasedBy,
			releasedByFirst: releaser.firstName,
			releasedByLast: releaser.lastName,
			releasedByEmail: releaser.email,
			customerToken: offers.customerToken,
			customerEmail: offers.customerEmail,
			customerLinkSentAt: offers.customerLinkSentAt,
			/** E-Mail aus dem Kundenstamm – Vorschlag fürs Verschicken */
			masterEmail: customers.email,
			changeRequest: offers.changeRequest,
			changeRequestName: offers.changeRequestName,
			changeRequestedAt: offers.changeRequestedAt,
			acceptedName: offers.acceptedName,
			acceptedSignature: offers.acceptedSignature,
			acceptedAt: offers.acceptedAt,
			acceptedByFirst: accepter.firstName,
			acceptedByLast: accepter.lastName,
			billedAt: offers.billedAt,
			createdBy: offers.createdBy,
			createdAt: offers.createdAt,
			creatorFirst: creator.firstName,
			creatorLast: creator.lastName,
			creatorEmail: creator.email
		})
		.from(offers)
		.leftJoin(customers, eq(customers.id, offers.customerId))
		.leftJoin(creator, eq(creator.id, offers.createdBy))
		.leftJoin(releaser, eq(releaser.id, offers.releasedBy))
		.leftJoin(accepter, eq(accepter.id, offers.acceptedBy))
		.where(where)
		.get();
	if (!offer) return null;
	const [lines, order] = await Promise.all([
		db
			.select({
				id: offerPositions.id,
				kind: offerPositions.kind,
				text: offerPositions.text,
				note: offerPositions.note,
				quantity: offerPositions.quantity,
				unit: offerPositions.unit,
				unitPrice: offerPositions.unitPrice,
				alternative: offerPositions.alternative
			})
			.from(offerPositions)
			.where(eq(offerPositions.offerId, offer.id))
			.orderBy(asc(offerPositions.sortOrder), asc(offerPositions.id))
			.all(),
		db.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.offerId, offer.id)).get()
	]);
	return { ...offer, lines, order: order ?? null };
}

export type OfferDetail = NonNullable<Awaited<ReturnType<typeof offerDetail>>>;

export interface SaveOffer {
	head: {
		number: string;
		date: string;
		title: string;
		location: string;
		customerId: number | null;
		customerName: string;
		customerAddition: string;
		customerStreet: string;
		customerZip: string;
		customerCity: string;
		customerUid: string;
		contactName: string;
		contactPhone: string;
		contactEmail: string;
		intro: string;
		closing: string;
		vatRate: number;
		reverseCharge: boolean;
		paymentDays: number;
		skontoPercent: number;
		skontoDays: number;
		discountPercent: number;
		discountAmount: number;
	};
	lines: { kind: 'position' | 'titel'; text: string; note?: string; quantity: string; unit: string; unitPrice: string; alternative?: boolean }[];
}

const qty = (v: string) => {
	const n = parseAmount(v);
	return n == null ? null : Math.round(n * 1000) / 1000;
};
const price = (v: string) => {
	const n = parseAmount(v);
	return n == null ? null : Math.round(n * 10000) / 10000;
};

export async function saveOffer(id: number, data: SaveOffer) {
	const h = data.head;
	await db.transaction(async (tx) => {
		await tx
			.update(offers)
			.set({
				number: h.number.slice(0, 30),
				date: h.date,
				title: h.title.slice(0, 300),
				location: h.location.slice(0, 300),
				customerId: h.customerId,
				customerName: h.customerName.slice(0, 160),
				customerAddition: h.customerAddition.slice(0, 160),
				customerStreet: h.customerStreet.slice(0, 160),
				customerZip: h.customerZip.slice(0, 12),
				customerCity: h.customerCity.slice(0, 120),
				customerUid: h.customerUid.replace(/\s+/g, '').toUpperCase().slice(0, 30),
				contactName: h.contactName.slice(0, 100),
				contactPhone: h.contactPhone.slice(0, 60),
				contactEmail: h.contactEmail.slice(0, 200),
				intro: h.intro.slice(0, 3000),
				closing: h.closing.slice(0, 5000),
				vatRate: h.vatRate,
				reverseCharge: h.reverseCharge,
				paymentDays: h.paymentDays,
				skontoPercent: h.skontoPercent,
				skontoDays: h.skontoDays,
				discountPercent: h.discountPercent,
				discountAmount: h.discountAmount,
				updatedAt: new Date()
			})
			.where(eq(offers.id, id));
		// Positionen werden neu geschrieben; ganz leere Zeilen fallen weg
		await tx.delete(offerPositions).where(eq(offerPositions.offerId, id));
		const lines = data.lines
			.filter((l) => l.text.trim() || (l.kind === 'position' && (l.quantity.trim() || l.unitPrice.trim())))
			.slice(0, MAX_OFFER_LINES);
		for (const [i, l] of lines.entries()) {
			const titel = l.kind === 'titel';
			await tx.insert(offerPositions).values({
				offerId: id,
				sortOrder: i,
				kind: titel ? 'titel' : 'position',
				text: l.text.slice(0, 4000),
				note: titel ? '' : (l.note ?? '').trim().slice(0, 2000),
				quantity: titel ? null : qty(l.quantity),
				unit: titel ? '' : l.unit.trim().slice(0, 20),
				unitPrice: titel ? null : price(l.unitPrice),
				alternative: !titel && !!l.alternative
			});
		}
	});
}

/** Was vor dem Freigeben fehlt – sonst null */
export function releaseProblem(o: {
	customerName: string;
	customerUid: string;
	title: string;
	reverseCharge: boolean;
	lines: { kind: string; quantity: number | null; unitPrice: number | null }[];
}) {
	if (!o.customerName.trim()) return 'Bitte zuerst den Kunden eintragen.';
	if (o.reverseCharge && !o.customerUid.trim()) return 'Für den Übergang der Steuerschuld braucht es die UID-Nummer des Kunden.';
	if (!o.title.trim()) return 'Bitte das Bauvorhaben (BV) eintragen.';
	const positions = o.lines.filter((l) => l.kind === 'position');
	if (!positions.length) return 'Das Angebot hat noch keine Position.';
	if (positions.some((l) => l.quantity == null || l.unitPrice == null)) return 'Bei jeder Position fehlen noch Menge oder Einheitspreis.';
	return null;
}

/* ------------------------------------------------------------- Ablauf */

const NO_RELEASE = { releasedBy: null, releasedAt: null };
const NO_ACCEPT = { acceptedName: null, acceptedSignature: null, acceptedAt: null, acceptedBy: null, billedAt: null };

/** Freigeben – dabei entsteht der Link für den Kunden, falls es noch keinen gibt */
export async function releaseOffer(id: number, userId: number) {
	await db
		.update(offers)
		.set({ status: 'freigegeben', releasedBy: userId, releasedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(offers.id, id), eq(offers.status, 'entwurf')));
	await ensureOfferToken(id);
}

/** Zurück in Arbeit, um es zu überarbeiten – der Kunde sieht solange „wird überarbeitet" */
export async function withdrawOffer(id: number) {
	await db
		.update(offers)
		.set({ status: 'entwurf', ...NO_RELEASE, updatedAt: new Date() })
		.where(and(eq(offers.id, id), inArray(offers.status, ['freigegeben', 'aenderung'])));
}

/** Angenommenes Angebot wieder öffnen – nur solange es keinen Auftrag gibt; die Annahme verfällt */
export async function reopenAccepted(id: number): Promise<boolean> {
	const order = await db.select({ id: orders.id }).from(orders).where(eq(orders.offerId, id)).get();
	if (order) return false;
	const done = await db
		.update(offers)
		.set({ status: 'entwurf', ...NO_RELEASE, ...NO_ACCEPT, updatedAt: new Date() })
		.where(and(eq(offers.id, id), eq(offers.status, 'angenommen')))
		.returning({ id: offers.id });
	return done.length > 0;
}

/** Der Kunde nimmt an – nur ein freigegebenes Angebot; kommen zwei gleichzeitig, gewinnt das erste */
export async function customerAccept(id: number, name: string, signature: string): Promise<boolean> {
	const done = await db
		.update(offers)
		.set({ status: 'angenommen', acceptedName: name, acceptedSignature: signature, acceptedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(offers.id, id), eq(offers.status, 'freigegeben')))
		.returning({ id: offers.id });
	return done.length > 0;
}

/**
 * Intern als angenommen markieren – der Kunde hat anders zugesagt (Telefon,
 * E-Mail, unterschrieben zurück). Geht aus „ausstehend" und „Änderung
 * gewünscht"; wer und wann, steht am Angebot. Der Name ist der des Kunden.
 */
export async function acceptInternally(id: number, userId: number, name: string): Promise<boolean> {
	const done = await db
		.update(offers)
		.set({
			status: 'angenommen',
			acceptedName: name.replace(/\s+/g, ' ').trim().slice(0, 120) || null,
			acceptedSignature: null,
			acceptedAt: new Date(),
			acceptedBy: userId,
			updatedAt: new Date()
		})
		.where(and(eq(offers.id, id), inArray(offers.status, ['freigegeben', 'aenderung'])))
		.returning({ id: offers.id });
	return done.length > 0;
}

/** Der Kunde wünscht Änderungen – das Angebot wartet dann auf die Überarbeitung */
export async function customerRequestChange(id: number, name: string, message: string): Promise<boolean> {
	const done = await db
		.update(offers)
		.set({ status: 'aenderung', changeRequest: message, changeRequestName: name, changeRequestedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(offers.id, id), eq(offers.status, 'freigegeben')))
		.returning({ id: offers.id });
	return done.length > 0;
}

/**
 * Angebot samt Positionen löschen. Mit withOrder geht sein Auftrag mit – sonst
 * bleibt der Auftrag (er hat Anschrift und Positionen ohnehin selbst) ohne Angebot.
 */
export async function deleteOffer(id: number, withOrder = false) {
	await db.transaction(async (tx) => {
		if (withOrder) {
			// Die Einträge vom Termin des Arbeitsauftrags gehen mit dem Auftrag
			await tx
				.delete(planEntries)
				.where(and(eq(planEntries.fromWorkOrder, true), inArray(planEntries.orderId, tx.select({ id: orders.id }).from(orders).where(eq(orders.offerId, id)))));
			await tx.delete(orders).where(eq(orders.offerId, id));
		}
		await tx.delete(offers).where(eq(offers.id, id));
	});
}

/** Löschen: „in Arbeit" nur Angebote in Arbeit, „alle" in jedem Stand */
export function mayDeleteOffer(user: SessionUser, offer: { status: string }): boolean {
	return can(user.role, 'angebote.loeschen') || (offer.status === 'entwurf' && can(user.role, 'angebote.loeschen.entwurf'));
}

/** Link für den Kunden: 128 Bit Zufall, bleibt dauerhaft gleich */
export async function ensureOfferToken(id: number): Promise<string> {
	const row = await db.select({ token: offers.customerToken }).from(offers).where(eq(offers.id, id)).get();
	if (row?.token) return row.token;
	const token = randomBytes(16).toString('hex');
	await db.update(offers).set({ customerToken: token }).where(and(eq(offers.id, id), sql`${offers.customerToken} is null`));
	const after = await db.select({ token: offers.customerToken }).from(offers).where(eq(offers.id, id)).get();
	return after?.token ?? token;
}

export async function markOfferLinkSent(id: number, email: string) {
	await db.update(offers).set({ customerEmail: email, customerLinkSentAt: new Date() }).where(eq(offers.id, id));
}

/** Bearbeiten: wer Angebote bearbeiten darf, solange es in Arbeit ist */
export function mayEditOffer(user: SessionUser, offer: { status: string }): boolean {
	return offer.status === 'entwurf' && can(user.role, 'angebote.bearbeiten');
}

/** Den Link gibt es, sobald das Angebot einmal freigegeben ist */
export const offerLinkReady = (status: string) => status === 'freigegeben' || status === 'aenderung' || status === 'angenommen';
