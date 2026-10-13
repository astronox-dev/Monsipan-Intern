import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'webseite-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

// Benachrichtigungen nur mitschreiben
const notified = vi.hoisted(() => [] as { event: string; title: string; body?: string; url?: string }[]);
vi.mock('$lib/server/notifications', () => ({ notify: (n: (typeof notified)[number]) => notified.push(n) }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { customers, inquiries } = await import('$lib/server/db/schema');
const { eq } = await import('drizzle-orm');
const { disconnectWebsite, isWebsiteKey, newWebsiteKey, websiteLink } = await import('./website');
const { POST } = await import('../../../../routes/api/anfragen/webseite/+server');

const FORM = { name: 'Max Muster', company: 'Strabag AG', email: 'max@strabag.com', phone: '0664 123 45 67', topic: 'Bodenmarkierung', message: 'Bitte um Angebot für den Parkplatz.' };

function send(body: unknown, key: string | null, type = 'application/json') {
	const headers: Record<string, string> = { 'content-type': type };
	if (key) headers.authorization = `Bearer ${key}`;
	const request = new Request('https://portal.example/api/anfragen/webseite', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
	return (POST as unknown as (e: { request: Request }) => Promise<Response>)({ request });
}

beforeAll(async () => {
	await ensureDatabase();
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Kontaktformular der Webseite', () => {
	it('ohne Verbindung und mit falschem Schlüssel: abgelehnt', async () => {
		expect(await websiteLink()).toBeNull();
		expect((await send(FORM, 'irgendwas')).status).toBe(401);
		const key = await newWebsiteKey();
		expect(key.length).toBeGreaterThanOrEqual(40);
		expect(await isWebsiteKey(key)).toBe(true);
		expect(await isWebsiteKey(key.slice(0, -1))).toBe(false);
		expect(await isWebsiteKey('')).toBe(false);
		expect((await send(FORM, null)).status).toBe(401);
		expect((await send(FORM, `${key}x`)).status).toBe(401);
	});

	it('legt die Anfrage an – mit passendem Kunden und Benachrichtigung', async () => {
		const customer = await db.insert(customers).values({ name: 'Strabag AG', email: 'einkauf@strabag.com' }).returning({ id: customers.id }).get();
		const key = (await websiteLink())!.key;
		notified.length = 0;

		const res = await send(FORM, key);
		expect(res.status).toBe(200);
		const { ok, id } = await res.json();
		expect(ok).toBe(true);

		const row = await db.select().from(inquiries).where(eq(inquiries.id, id)).get();
		expect(row).toMatchObject({
			subject: 'Bodenmarkierung',
			senderName: 'Max Muster',
			senderCompany: 'Strabag AG',
			senderEmail: 'max@strabag.com',
			senderPhone: '0664 123 45 67',
			source: 'webseite',
			customerId: customer.id,
			createdBy: null
		});
		expect(row!.body).toContain('Bitte um Angebot für den Parkplatz.');
		expect(notified).toEqual([expect.objectContaining({ event: 'anfrage.neu', title: 'Neue Anfrage über die Webseite: Bodenmarkierung', url: `/anfragen/${id}` })]);
		expect((await websiteLink())!.lastAt).toBeGreaterThan(Date.now() - 60_000);
	});

	it('ungültige Daten und kein JSON: abgelehnt, nichts angelegt', async () => {
		const key = (await websiteLink())!.key;
		const before = (await db.select().from(inquiries).all()).length;
		expect((await send({ ...FORM, email: 'kaputt' }, key)).status).toBe(422);
		expect((await send('name=Max', key, 'text/plain')).status).toBe(400);
		expect((await db.select().from(inquiries).all()).length).toBe(before);
	});

	it('neuer Schlüssel ersetzt den alten, Trennen sperrt ganz', async () => {
		const old = (await websiteLink())!.key;
		const fresh = await newWebsiteKey();
		expect(fresh).not.toBe(old);
		expect((await send(FORM, old)).status).toBe(401);
		// Wann zuletzt etwas kam, bleibt beim neuen Schlüssel stehen
		expect((await websiteLink())!.lastAt).not.toBeNull();
		await disconnectWebsite();
		expect((await send(FORM, fresh)).status).toBe(401);
	});
});
