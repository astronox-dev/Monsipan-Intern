import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'planung-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { orders, parties } = await import('$lib/server/db/schema');
const { claimOrder, unassignedOrders } = await import('./plan');

beforeAll(async () => {
	await ensureDatabase();
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* unter Windows ist die Datenbank noch gesperrt – bleibt im Temp-Ordner */
	}
});

describe('Aufträge ohne Partie', () => {
	it('stehen in der Liste und gehen beim Einplanen an die Partie', async () => {
		const [a, b] = await db.insert(parties).values([{ name: 'Partie A' }, { name: 'Partie B' }]).returning({ id: parties.id });
		const [free, done, taken] = await db
			.insert(orders)
			.values([
				{ number: '9001', title: 'Ohne Partie' },
				{ number: '9002', title: 'Abgeschlossen', status: 'abgeschlossen' },
				{ number: '9003', title: 'Schon bei A', partyId: a.id }
			])
			.returning({ id: orders.id });
		expect((await unassignedOrders()).map((o) => o.id)).toEqual([free.id]);
		void done;

		expect(await claimOrder(free.id, b.id)).toBe(true);
		expect((await db.select({ partyId: orders.partyId }).from(orders).where(eq(orders.id, free.id)).get())?.partyId).toBe(b.id);
		expect(await unassignedOrders()).toEqual([]);

		// Schon zugeteilt: bleibt, wo er ist – die andere Partie hilft nur aus
		expect(await claimOrder(taken.id, b.id)).toBe(false);
		expect((await db.select({ partyId: orders.partyId }).from(orders).where(eq(orders.id, taken.id)).get())?.partyId).toBe(a.id);
	});
});
