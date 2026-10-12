import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '$lib/server/auth';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { customers, invoicePositions, invoices, orderPositions, orders, parties, users } = await import('$lib/server/db/schema');
const { decodeText, parseCsv, readTable, writeTable } = await import('$lib/server/table');
const { exportTable, planImport, runImport, toBool, toDate, toNumber } = await import('./transfer');
const { suggestMapping } = await import('../transfer');
const { verifyInvoice, checkArchive } = await import('./signatur/verification');

const user: SessionUser = { id: 0, username: 'test', email: null, firstName: 'Test', lastName: 'Import', role: 'admin', partyId: null, owner: false, mustChangePassword: false };

/** Tabelle wie aus einer Datei: erste Zeile Überschriften */
const table = (rows: (string | number | null)[][]) => rows;
const mapFor = (kind: Parameters<typeof suggestMapping>[0], rows: unknown[][]) => suggestMapping(kind, rows[0]);
async function failure(p: PromiseLike<unknown>): Promise<string> {
	try {
		await p;
		return '';
	} catch (e) {
		const err = e as Error & { cause?: Error };
		return `${err.message} ${err.cause?.message ?? ''}`;
	}
}

beforeAll(async () => {
	await ensureDatabase();
	user.id = (await db.select({ id: users.id }).from(users).limit(1).get())!.id;
	await db.insert(parties).values([{ name: 'Partie Erich' }, { name: 'Partie Frosch' }]);
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Werte aus anderen Programmen', () => {
	it('liest Datumsangaben', () => {
		expect(toDate('12.10.2026')).toBe('2026-10-12');
		expect(toDate('1.2.26')).toBe('2026-02-01');
		expect(toDate('2026-10-12')).toBe('2026-10-12');
		expect(toDate('12.10.2026 14:30')).toBe('2026-10-12');
		expect(toDate(46307)).toBe('2026-10-12'); // Excel-Seriennummer
		expect(toDate(new Date(Date.UTC(2026, 9, 12)))).toBe('2026-10-12');
		expect(toDate('')).toBeNull();
		expect(toDate('31.02.2026')).toBeUndefined();
		expect(toDate('morgen')).toBeUndefined();
	});

	it('liest Zahlen und ja/nein', () => {
		expect(toNumber('1.234,56')).toBe(1234.56);
		expect(toNumber('1234.56')).toBe(1234.56);
		expect(toNumber('€ 12,50')).toBe(12.5);
		expect(toNumber('20 %')).toBe(20);
		expect(toNumber(7)).toBe(7);
		expect(toNumber('')).toBeNull();
		expect(toNumber('viel')).toBeUndefined();
		expect(toBool('x')).toBe(true);
		expect(toBool('Bezahlt')).toBe(true);
		expect(toBool('nein')).toBe(false);
		expect(toBool('vielleicht')).toBeNull();
	});
});

describe('Dateien', () => {
	it('erkennt Trennzeichen, Anführungszeichen und Windows-1252', () => {
		expect(parseCsv('a;b;"c ""d"";e"\r\n1;2;3\n')).toEqual([
			['a', 'b', 'c "d";e'],
			['1', '2', '3']
		]);
		expect(parseCsv('a,b\n"x\ny",2')).toEqual([
			['a', 'b'],
			['x\ny', '2']
		]);
		expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']);
		// „Straße" in Windows-1252
		expect(decodeText(Buffer.from([0x53, 0x74, 0x72, 0x61, 0xdf, 0x65]))).toBe('Straße');
		expect(decodeText(Buffer.from('﻿Ärger', 'utf8'))).toBe('Ärger');
	});

	it('schreibt Excel und liest es wieder', async () => {
		const xlsx = await writeTable('xlsx', 'Test', ['Name', 'Datum', 'Betrag'], [['Müller', new Date(Date.UTC(2026, 9, 12)), 12.5]]);
		const back = await readTable(xlsx);
		expect(back.sheets).toEqual(['Test']);
		expect(back.rows[0]).toEqual(['Name', 'Datum', 'Betrag']);
		expect(back.rows[1][0]).toBe('Müller');
		expect(toDate(back.rows[1][1])).toBe('2026-10-12');
		expect(back.rows[1][2]).toBe(12.5);
		const csv = await writeTable('csv', 'Test', ['Name', 'Betrag'], [['=SUMME(1)', 1234.5]]);
		expect(csv.toString('utf8')).toBe('﻿Name;Betrag\r\n\'=SUMME(1);1234,5\r\n');
	});

	it('schlägt die Zuordnung auch für fremde Spaltennamen vor', () => {
		const m = suggestMapping('rechnungen', ['Re-Nr.', 'Belegdatum', 'Kunde', 'Netto', 'Leistungstext', 'Menge', 'EP', 'Sonstiges']);
		expect(m).toMatchObject({ number: 0, date: 1, customerName: 2, netTotal: 3, posText: 4, posQuantity: 5, posPrice: 6, closing: -1 });
	});
});

describe('Kunden', () => {
	it('legt neue an und überspringt bzw. aktualisiert vorhandene', async () => {
		await db.insert(customers).values({ name: 'Strabag AG', zip: '1220', city: 'Wien' });
		const rows = table([
			['Firma', 'PLZ', 'Ort', 'Telefon', 'Aktiv'],
			['Strabag AG', '1220', 'Wien', '01 222', 'ja'],
			['Porr Bau GmbH', '1100', 'Wien', '', 'nein'],
			['Porr Bau GmbH', '1100', 'Wien', '', ''],
			['', '', '', '', '']
		]);
		const plan = await planImport('kunden', rows.slice(1), mapFor('kunden', rows), { update: false });
		expect(plan.counts).toMatchObject({ neu: 1, ueberspringen: 2, fehler: 0 });
		const { result } = await runImport('kunden', rows.slice(1), mapFor('kunden', rows), { update: true }, user, 'kunden.csv');
		expect(result).toMatchObject({ created: 1, updated: 1 });
		expect((await db.select().from(customers).where(eq(customers.name, 'Strabag AG')).get())?.phone).toBe('01 222');
		expect((await db.select().from(customers).where(eq(customers.name, 'Porr Bau GmbH')).get())?.active).toBe(false);
	});
});

describe('Aufträge mit Positionen', () => {
	it('fasst Zeilen zusammen, ordnet Partien zu und meldet Unbekanntes', async () => {
		const rows = table([
			['Auftragsnr', 'Bauvorhaben', 'Kunde', 'Partie', 'Status', 'Leistung', 'Menge', 'ME'],
			['A-100', 'B1 Wiener Straße', 'Strabag AG', 'Erich', 'in Arbeit', 'Bodenmarkierung', null, null],
			[null, null, null, null, null, 'Leitlinie gelb', 1250, 'lfm'],
			[null, null, null, null, null, 'Pfeile', 8, 'Stk'],
			['A-101', 'A2 Knoten', 'Porr', 'Unbekannt', 'fertig', 'Sperrfläche', 'zwölf', 'm²']
		]);
		const plan = await planImport('auftraege', rows.slice(1), mapFor('auftraege', rows), { update: false });
		expect(plan.counts).toMatchObject({ neu: 1, fehler: 1 });
		expect(plan.issues.map((i) => i.message).join(' ')).toMatch(/Partie „Unbekannt" gibt es nicht/);
		expect(plan.issues.map((i) => i.message).join(' ')).toMatch(/Menge „zwölf"/);
		await runImport('auftraege', rows.slice(1), mapFor('auftraege', rows), { update: false }, user, 'auftraege.xlsx');
		const order = await db.select().from(orders).where(eq(orders.number, 'A-100')).get();
		const party = await db.select().from(parties).where(eq(parties.name, 'Partie Erich')).get();
		expect(order).toMatchObject({ title: 'B1 Wiener Straße', status: 'in_arbeit', partyId: party!.id });
		const lines = await db.select().from(orderPositions).where(eq(orderPositions.orderId, order!.id)).all();
		expect(lines.map((l) => [l.kind, l.text, l.quantity])).toEqual([
			['titel', 'Bodenmarkierung', null],
			['position', 'Leitlinie gelb', 1250],
			['position', 'Pfeile', 8]
		]);
		expect(await db.select().from(orders).where(eq(orders.number, 'A-101')).get()).toBeUndefined();
	});
});

describe('Rechnungen als Altbestand', () => {
	const rows = table([
		['Rechnungsnummer', 'Rechnungsdatum', 'Fällig', 'Auftragsnummer', 'Kunde', 'USt', 'Bezahlt', 'Netto', 'Pos.-Nr.', 'Positionstext', 'Menge', 'Einheit', 'Einheitspreis'],
		['R-1', '01.03.2024', '31.03.2024', 'A-100', 'Strabag AG', '20', 'ja', '3866,25', '1.1', 'Leitlinie gelb', '1250', 'lfm', '2,85'],
		['R-1', '', '', '', '', '', '', '', '1.2', 'Pfeile', '8', 'Stk', '38'],
		['R-2', '15.04.2024', '', '', 'Porr Bau GmbH', '', '', '1000', '', '', '', '', ''],
		['R-3', 'gestern', '', '', 'Irgendwer', '', '', '', '', 'Etwas', '1', 'Stk', '10']
	]);
	const mapping = () => mapFor('rechnungen', rows);

	it('importiert gesperrt, verknüpft und ohne Mahnung', async () => {
		const plan = await planImport('rechnungen', rows.slice(1), mapping(), { update: false });
		expect(plan.counts).toMatchObject({ neu: 2, fehler: 1 });
		const { result } = await runImport('rechnungen', rows.slice(1), mapping(), { update: false }, user, 'rechnungen.csv');
		expect(result).toMatchObject({ created: 2, failed: 1 });

		const r1 = await db.select().from(invoices).where(eq(invoices.number, 'R-1')).get();
		const order = await db.select().from(orders).where(eq(orders.number, 'A-100')).get();
		expect(r1).toMatchObject({ stage: 'importiert', status: 'bezahlt', paidOn: '2024-03-01', orderId: order!.id, vatRate: 20 });
		const lines = await db.select().from(invoicePositions).where(eq(invoicePositions.invoiceId, r1!.id)).all();
		expect(lines.map((l) => [l.number, l.quantity, l.unitPrice])).toEqual([
			['1.1', 1250, 2.85],
			['1.2', 8, 38]
		]);

		// Ohne Positionen: eine Position über den Nettobetrag; offen und längst fällig – aber keine Meldung mehr
		const r2 = await db.select().from(invoices).where(eq(invoices.number, 'R-2')).get();
		expect(r2).toMatchObject({ stage: 'importiert', status: 'offen', dueDate: '2024-05-15' });
		expect(r2!.overdueNotifiedAt).toBeInstanceOf(Date);
		expect((await db.select().from(invoicePositions).where(eq(invoicePositions.invoiceId, r2!.id)).all()).map((l) => l.unitPrice)).toEqual([1000]);

		// Gesperrt wie ausgestellte, Zahlung bleibt änderbar
		expect(await failure(db.update(invoices).set({ customerName: 'anders' }).where(eq(invoices.id, r1!.id)))).toMatch(/gesperrt/);
		await db.update(invoices).set({ status: 'bezahlt', paidOn: '2024-06-01' }).where(eq(invoices.id, r2!.id));

		// Ohne Archiv: Prüfung „nicht möglich", die Archivprüfung lässt sie aus
		expect((await verifyInvoice(r1!.id, { record: false }))?.result).toBe('unbekannt');
		expect((await checkArchive()).problems).toEqual([]);

		// Noch einmal: alles schon da
		expect((await planImport('rechnungen', rows.slice(1, 4), mapping(), { update: false })).counts).toMatchObject({ neu: 0, ueberspringen: 2 });
	});

	it('exportiert so, dass der Import alles wiedererkennt', async () => {
		const exported = await exportTable('rechnungen');
		const back = suggestMapping('rechnungen', exported.header);
		expect(Object.values(back).every((i) => i >= 0)).toBe(true);
		const plan = await planImport('rechnungen', exported.rows, back, { update: false });
		expect(plan.counts).toMatchObject({ neu: 0, fehler: 0, ueberspringen: 2 });
		const customersOut = await exportTable('kunden');
		expect(Object.values(suggestMapping('kunden', customersOut.header)).every((i) => i >= 0)).toBe(true);
	});
});
