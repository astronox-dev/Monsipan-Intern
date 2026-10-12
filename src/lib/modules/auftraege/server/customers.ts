/**
 * Kundenstamm für Angebote: Anschrift, UID, Kontakt. Ein Kunde, der schon in
 * Angeboten steht, wird nicht gelöscht, sondern ausgeblendet – die Angebote
 * behalten ihre Anschrift ohnehin.
 */
import { and, asc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { customers, offers } from '$lib/server/db/schema';
import { col } from '$lib/server/db/sql';

export interface CustomerInput {
	name: string;
	addition: string;
	street: string;
	zip: string;
	city: string;
	uid: string;
	email: string;
	phone: string;
	contact: string;
	note: string;
}

const LIMITS: Record<keyof CustomerInput, number> = {
	name: 160,
	addition: 160,
	street: 160,
	zip: 12,
	city: 120,
	uid: 30,
	email: 200,
	phone: 60,
	contact: 120,
	note: 1000
};

/** Formular auslesen und kürzen */
export function readCustomer(form: FormData): CustomerInput {
	const out = {} as CustomerInput;
	for (const [key, max] of Object.entries(LIMITS) as [keyof CustomerInput, number][]) {
		out[key] = String(form.get(key) ?? '')
			.trim()
			.slice(0, max);
	}
	out.uid = out.uid.replace(/\s+/g, '').toUpperCase();
	return out;
}

export function customerProblem(c: CustomerInput): string | null {
	if (c.name.length < 2) return 'Bitte den Namen des Kunden eintragen.';
	if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'Die E-Mail-Adresse stimmt nicht.';
	return null;
}

const customerFields = {
	id: customers.id,
	name: customers.name,
	addition: customers.addition,
	street: customers.street,
	zip: customers.zip,
	city: customers.city,
	uid: customers.uid,
	email: customers.email,
	phone: customers.phone,
	contact: customers.contact,
	note: customers.note,
	active: customers.active
};

export interface CustomerFilter {
	q?: string;
	/** Auch ausgeblendete */
	all?: boolean;
}

function customerWhere(opts: CustomerFilter): SQL | undefined {
	const where: (SQL | undefined)[] = [];
	if (!opts.all) where.push(eq(customers.active, true));
	if (opts.q?.trim()) {
		const q = `%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(or(like(customers.name, q), like(customers.city, q), like(customers.contact, q), like(customers.uid, q)));
	}
	return and(...where);
}

/** Kunden nach Namen – ohne Grenze alle (für die Auswahl im Angebot), sonst eine Seite */
export async function listCustomers(opts: CustomerFilter = {}, page?: { limit: number; offset: number }) {
	const query = db
		.select({
			...customerFields,
			offers: sql<number>`(select count(*) from ${offers} where ${col(offers.customerId)} = ${col(customers.id)})`.mapWith(Number)
		})
		.from(customers)
		.where(customerWhere(opts))
		.orderBy(asc(sql`lower(${customers.name})`), asc(customers.id));
	return page ? query.limit(page.limit).offset(page.offset).all() : query.all();
}

/** Wie viele Kunden der Filter trifft – zum Blättern */
export async function countCustomers(opts: CustomerFilter = {}): Promise<number> {
	const row = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(customers).where(customerWhere(opts)).get();
	return row?.n ?? 0;
}

export type CustomerRow = Awaited<ReturnType<typeof listCustomers>>[number];

export function getCustomer(id: number) {
	return db.select(customerFields).from(customers).where(eq(customers.id, id)).get();
}

export async function createCustomer(c: CustomerInput): Promise<number> {
	const row = await db
		.insert(customers)
		.values({ ...c, updatedAt: new Date() })
		.returning({ id: customers.id })
		.get();
	return row.id;
}

export async function updateCustomer(id: number, c: CustomerInput) {
	await db
		.update(customers)
		.set({ ...c, updatedAt: new Date() })
		.where(eq(customers.id, id));
}

export async function setCustomerActive(id: number, active: boolean) {
	await db.update(customers).set({ active, updatedAt: new Date() }).where(eq(customers.id, id));
}

/** Löschen nur, solange kein Angebot auf den Kunden zeigt – sonst ausblenden */
export async function deleteCustomer(id: number): Promise<boolean> {
	const used = await db.select({ n: sql<number>`count(*)` }).from(offers).where(eq(offers.customerId, id)).get();
	if (Number(used?.n ?? 0) > 0) return false;
	await db.delete(customers).where(eq(customers.id, id));
	return true;
}
