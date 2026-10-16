import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'suche-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('./db');
const { customers, inquiries, invoices, offers, orders, parties, products, users } = await import('./db/schema');
const { globalSearch } = await import('./search');

type Who = Parameters<typeof globalSearch>[0];
const person = (role: string, partyId: number | null = null) => ({ id: 1, username: 'x', email: null, firstName: '', lastName: '', role, partyId, owner: false, mustChangePassword: false }) as unknown as Who;

beforeAll(async () => {
	await ensureDatabase();
	const [nord, sued] = await db.insert(parties).values([{ name: 'Nord' }, { name: 'Süd' }]).returning({ id: parties.id });
	await db.insert(orders).values([
		{ number: '26001', title: 'Kreisverkehr Brunn', partyId: nord.id },
		{ number: '26002', title: 'Kreisverkehr Mödling', partyId: sued.id }
	]);
	await db.insert(offers).values({ number: '26001', date: '2026-10-01', title: 'Kreisverkehr Brunn' });
	await db.insert(invoices).values({ number: '26001', date: '2026-10-10', dueDate: '2026-11-09', title: 'Kreisverkehr Brunn', stage: 'entwurf' });
	await db.insert(customers).values({ name: 'Kreisverkehr GmbH' });
	await db.insert(inquiries).values({ receivedOn: '2026-10-01', subject: 'Kreisverkehr markieren', closedAt: new Date() });
	await db.insert(products).values({ name: 'Kreisverkehr-Farbe weiß', unit: 'kg', searchText: 'kreisverkehr-farbe weiß' });
	await db.update(users).set({ firstName: 'Kurt', lastName: 'Kreisverkehrer' });
	nordId = nord.id;
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

let nordId = 0;
const keys = async (who: Who, q = 'Kreisverkehr') => (await globalSearch(who, q)).map((g) => g.key);

describe('Suche über das ganze Portal', () => {
	it('Admin findet alles – auch erledigte Anfragen', async () => {
		const groups = await globalSearch(person('admin'), 'kreisverkehr');
		expect(groups.map((g) => g.key)).toEqual(['auftraege', 'angebote', 'rechnungen', 'anfragen', 'kunden', 'artikel', 'benutzer']);
		const orders = groups.find((g) => g.key === 'auftraege')!.hits;
		expect(orders.map((h) => h.title)).toEqual(expect.arrayContaining(['26 001 · Kreisverkehr Brunn', '26 002 · Kreisverkehr Mödling']));
		expect(orders[0].href).toMatch(/^\/auftraege\/\d+$/);
		expect(groups.find((g) => g.key === 'rechnungen')!.hits[0]).toMatchObject({ badge: { label: 'Entwurf' } });
	});

	it('Nummern wie angezeigt („26 001")', async () => {
		const groups = await globalSearch(person('admin'), '26 001');
		expect(groups.find((g) => g.key === 'angebote')!.hits).toHaveLength(1);
		expect(groups.find((g) => g.key === 'auftraege')!.hits.map((h) => h.title)).toEqual(['26 001 · Kreisverkehr Brunn']);
	});

	it('die Partie sieht nur ihre Aufträge – keine Angebote, Rechnungen, Kunden oder Benutzer', async () => {
		const nord = nordId;
		const groups = await globalSearch(person('partiefuehrer', nord), 'Kreisverkehr');
		expect(groups.map((g) => g.key)).toEqual(['auftraege', 'artikel']);
		expect(groups[0].hits.map((h) => h.title)).toEqual(['26 001 · Kreisverkehr Brunn']);
		// Ohne Partie gibt es keine Aufträge
		expect(await keys(person('arbeiter'))).toEqual(['artikel']);
	});

	it('Buchhaltung ohne Benutzerverwaltung, kurze Suche liefert nichts', async () => {
		expect(await keys(person('buchhaltung'))).toEqual(['auftraege', 'angebote', 'rechnungen', 'anfragen', 'kunden', 'artikel']);
		expect(await globalSearch(person('admin'), 'k')).toEqual([]);
	});
});

describe('Benutzer', () => {
	it('nach Vor- und Nachname zusammen', async () => {
		const groups = await globalSearch(person('admin'), 'Kurt Kreis');
		expect(groups.find((g) => g.key === 'benutzer')!.hits[0].title).toBe('Kurt Kreisverkehrer');
	});
});
