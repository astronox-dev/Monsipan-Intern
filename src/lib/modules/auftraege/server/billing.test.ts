import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'abrechnung-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { invoicePositions, invoices, offers, orders, users } = await import('$lib/server/db/schema');
const { acceptInternally, countOffers, listOffers, offerYears } = await import('./offers');
const { deleteInvoice, invoiceYears, listInvoices, setInvoiceOpen, setInvoicePaid } = await import('./invoices');
const { setOrderStatus } = await import('./orders');

let userId = 0;
let n = 0;

/** Angenommenes Angebot mit Auftrag im gewünschten Stand */
async function offerWithOrder(status: 'erstellt' | 'in_arbeit' | 'abgeschlossen', date = '2026-03-01') {
	const number = String(26100 + ++n);
	const offer = await db.insert(offers).values({ number, date, status: 'angenommen', customerName: 'Strabag AG' }).returning({ id: offers.id }).get();
	const order = await db.insert(orders).values({ number, offerId: offer.id, status }).returning({ id: orders.id }).get();
	return { offerId: offer.id, orderId: order.id, number };
}

async function invoiceFor(orderId: number, number: string, extra: Partial<typeof invoices.$inferInsert> = {}) {
	const row = await db
		.insert(invoices)
		.values({ number, orderId, date: '2026-04-01', dueDate: '2026-05-01', customerName: 'Strabag AG', ...extra })
		.returning({ id: invoices.id })
		.get();
	await db.insert(invoicePositions).values({ invoiceId: row.id, text: 'Leitlinie', quantity: 10, unit: 'lfm', unitPrice: 2 });
	return row.id;
}

const billedAt = async (offerId: number) => (await db.select({ b: offers.billedAt }).from(offers).where(eq(offers.id, offerId)).get())?.b ?? null;

beforeAll(async () => {
	await ensureDatabase();
	userId = (await db.select({ id: users.id }).from(users).limit(1).get())!.id;
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Angebot abgerechnet', () => {
	it('wenn der Auftrag abgeschlossen und alles bezahlt ist', async () => {
		const { offerId, orderId, number } = await offerWithOrder('abgeschlossen');
		const first = await invoiceFor(orderId, number);
		const second = await invoiceFor(orderId, `${number}-2`);
		await setInvoicePaid(first, '2026-04-10', userId);
		expect(await billedAt(offerId)).toBeNull();
		await setInvoicePaid(second, '2026-04-12', userId);
		expect(await billedAt(offerId)).toBeInstanceOf(Date);
		expect((await listOffers({ status: 'abgerechnet' })).map((o) => o.id)).toContain(offerId);
		expect((await listOffers({ status: 'angenommen' })).map((o) => o.id)).not.toContain(offerId);

		// Wieder offen: nicht mehr abgerechnet
		await setInvoiceOpen(second);
		expect(await billedAt(offerId)).toBeNull();
	});

	it('erst, wenn der Auftrag abgeschlossen ist', async () => {
		const { offerId, orderId, number } = await offerWithOrder('in_arbeit');
		const id = await invoiceFor(orderId, number, { kind: 'teilrechnung' });
		await setInvoicePaid(id, '2026-04-10', userId);
		expect(await billedAt(offerId)).toBeNull();
		await setOrderStatus(orderId, 'abgeschlossen', userId);
		expect(await billedAt(offerId)).toBeInstanceOf(Date);
		await setOrderStatus(orderId, 'in_arbeit', userId);
		expect(await billedAt(offerId)).toBeNull();
	});

	it('zählt stornierte nicht und braucht mindestens eine Rechnung', async () => {
		const { offerId, orderId, number } = await offerWithOrder('in_arbeit');
		await setOrderStatus(orderId, 'abgeschlossen', userId);
		expect(await billedAt(offerId)).toBeNull();
		const paid = await invoiceFor(orderId, number);
		// Erst als Entwurf mit Position, dann storniert – danach sperren die Trigger
		const cancelled = await invoiceFor(orderId, `${number}-2`);
		await db.update(invoices).set({ stage: 'storniert', issuedAt: new Date() }).where(eq(invoices.id, cancelled));
		await setInvoicePaid(paid, '2026-04-10', userId);
		expect(await billedAt(offerId)).toBeInstanceOf(Date);
	});

	it('nimmt beim Löschen eines offenen Entwurfs wieder auf', async () => {
		const { offerId, orderId, number } = await offerWithOrder('abgeschlossen');
		const paid = await invoiceFor(orderId, number);
		const draft = await invoiceFor(orderId, `${number}-2`);
		await setInvoicePaid(paid, '2026-04-10', userId);
		expect(await billedAt(offerId)).toBeNull();
		expect(await deleteInvoice(draft)).toBe(true);
		expect(await billedAt(offerId)).toBeInstanceOf(Date);
	});

	it('eine Zahlung nimmt ein übernommenes „abgerechnet" nicht zurück', async () => {
		const { offerId, orderId, number } = await offerWithOrder('abgeschlossen');
		await db.update(offers).set({ billedAt: new Date() }).where(eq(offers.id, offerId));
		const first = await invoiceFor(orderId, number);
		await invoiceFor(orderId, `${number}-2`);
		await setInvoicePaid(first, '2026-04-10', userId);
		expect(await billedAt(offerId)).toBeInstanceOf(Date);
	});
});

describe('Intern annehmen', () => {
	it('nur ausstehende oder mit Änderungswunsch', async () => {
		const pending = await db.insert(offers).values({ number: '26900', date: '2026-05-01', status: 'freigegeben' }).returning({ id: offers.id }).get();
		const draft = await db.insert(offers).values({ number: '26901', date: '2026-05-01', status: 'entwurf' }).returning({ id: offers.id }).get();
		expect(await acceptInternally(pending.id, userId, '  Hr. Maier,   telefonisch ')).toBe(true);
		expect(await db.select().from(offers).where(eq(offers.id, pending.id)).get()).toMatchObject({
			status: 'angenommen',
			acceptedName: 'Hr. Maier, telefonisch',
			acceptedSignature: null,
			acceptedBy: userId
		});
		expect(await acceptInternally(draft.id, userId, '')).toBe(false);
		expect(await acceptInternally(pending.id, userId, '')).toBe(false);
	});
});

describe('Nach Jahren', () => {
	it('zählt und filtert Angebote und Rechnungen je Jahr', async () => {
		const { orderId } = await offerWithOrder('abgeschlossen', '2024-11-20');
		await invoiceFor(orderId, 'J-2024', { date: '2024-12-01', dueDate: '2024-12-31' });
		const offerYearsList = await offerYears();
		expect(offerYearsList[0].year >= offerYearsList.at(-1)!.year).toBe(true);
		expect(offerYearsList.find((y) => y.year === '2024')?.n).toBe(1);
		expect(await countOffers({ year: '2024' })).toBe(1);
		expect((await listOffers({ year: '2024' })).every((o) => o.date.startsWith('2024'))).toBe(true);

		expect((await invoiceYears()).find((y) => y.year === '2024')?.n).toBe(1);
		expect((await listInvoices({ year: '2024' })).map((i) => i.number)).toEqual(['J-2024']);
		// Neueste Jahre zuerst
		const all = await listInvoices({}, 1000);
		expect(all.at(-1)?.number).toBe('J-2024');
	});

	it('findet Rechnungen über die Kostenstelle', async () => {
		const { orderId } = await offerWithOrder('abgeschlossen');
		await invoiceFor(orderId, 'K-1', { costCenter: '9526053' });
		expect((await listInvoices({ q: '9526053' })).map((i) => [i.number, i.costCenter])).toEqual([['K-1', '9526053']]);
	});
});
