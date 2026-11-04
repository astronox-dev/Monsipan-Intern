import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rechnungsnummer-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { invoices, orders, users } = await import('$lib/server/db/schema');
const { createInvoice, invoiceNumberTaken, lastInvoiceNumber, readInvoice, readInvoiceNumber } = await import('./invoices');

let user: { id: number; role: 'admin' };
let orderId = 0;

beforeAll(async () => {
	await ensureDatabase();
	const u = (await db.select({ id: users.id }).from(users).limit(1).get())!;
	user = { id: u.id, role: 'admin' };
	orderId = (await db.insert(orders).values({ number: '26877', title: 'Bodenmarkierungen' }).returning({ id: orders.id }).get()).id;
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

/** Das Formular einer Rechnung mit einer Position */
function form(number: string) {
	const f = new FormData();
	for (const [k, v] of Object.entries({
		nummer: number,
		datum: '2026-11-04',
		zahlungsziel: '30',
		ust: '20',
		k_name: 'Strabag AG',
		'z.0.art': 'position',
		'z.0.text': 'Leitlinie',
		'z.0.menge': '10',
		'z.0.einheit': 'lfm',
		'z.0.preis': '2'
	}))
		f.set(k, v);
	return f;
}

describe('Rechnungsnummer', () => {
	it('wird von Hand eingetragen – Leerzeichen fallen weg, „/" ist der Kostenstelle vorbehalten', () => {
		expect(readInvoiceNumber(' 26 001 ')).toBe('26001');
		expect(readInvoiceNumber('RE-2026.015')).toBe('RE-2026.015');
		expect(readInvoiceNumber('')).toHaveProperty('message');
		expect(readInvoiceNumber('26001/9526053')).toHaveProperty('message');
		expect(readInvoiceNumber('x'.repeat(31))).toHaveProperty('message');
		expect(readInvoice(form(''))).toHaveProperty('message', 'Bitte die Rechnungsnummer eintragen.');
	});

	it('steht so auf der Rechnung, nicht die Nummer des Auftrags', async () => {
		const data = readInvoice(form('26 001'));
		if ('message' in data) throw new Error(data.message);
		const id = await createInvoice(user as never, orderId, data, {}, []);
		expect(typeof id).toBe('number');
		const row = await db.select({ number: invoices.number }).from(invoices).get();
		expect(row?.number).toBe('26001');
		expect(await lastInvoiceNumber()).toBe('26001');
	});

	it('gibt es nur einmal', async () => {
		const data = readInvoice(form('26001'));
		if ('message' in data) throw new Error(data.message);
		expect(await createInvoice(user as never, orderId, data, {}, [])).toEqual({ message: 'Die Rechnungsnummer 26001 ist schon vergeben.' });
		const own = (await db.select({ id: invoices.id }).from(invoices).get())!.id;
		expect(await invoiceNumberTaken('26001')).toBe(true);
		// Die eigene Rechnung darf ihre Nummer behalten
		expect(await invoiceNumberTaken('26001', own)).toBe(false);
		expect(await invoiceNumberTaken('26002')).toBe(false);
	});
});
