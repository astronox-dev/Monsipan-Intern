import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vertretung-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));
// Benachrichtigungen mitschreiben statt nebenher in die Datenbank (sonst „database is locked")
const notified = vi.hoisted(() => [] as { title: string; userIds?: number[] }[]);
vi.mock('$lib/server/notifications', async (original) => ({
	...(await original<typeof import('$lib/server/notifications')>()),
	notify: (n: { title: string; userIds?: number[] }) => notified.push(n)
}));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { parties, users } = await import('$lib/server/db/schema');
const { createSession, validateSession } = await import('$lib/server/auth');
const { effectiveRole } = await import('$lib/server/lead');
const { recipientsFor } = await import('$lib/server/notifications');
const { setActingLead } = await import('./plan');
const { addDays, today } = await import('$lib/modules/stunden/week');

type Who = Parameters<typeof setActingLead>[0];
let admin: Who, max: number, sepp: number, party: number;

beforeAll(async () => {
	await ensureDatabase();
	party = (await db.insert(parties).values({ name: 'Nord' }).returning({ id: parties.id }).get()).id;
	[{ id: max }, { id: sepp }] = await db
		.insert(users)
		.values([
			{ username: 'max', firstName: 'Max', passwordHash: 'x', role: 'arbeiter', partyId: party },
			{ username: 'sepp', firstName: 'Sepp', passwordHash: 'x', role: 'partiefuehrer', partyId: party }
		])
		.returning({ id: users.id });
	admin = { id: sepp, role: 'admin' } as Who;
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Vorübergehend Partieführer', () => {
	it('gilt bis einschließlich dem Tag – nur für Arbeiter', () => {
		expect(effectiveRole('arbeiter', '2026-10-30', '2026-10-30')).toBe('partiefuehrer');
		expect(effectiveRole('arbeiter', '2026-10-30', '2026-10-31')).toBe('arbeiter');
		expect(effectiveRole('arbeiter', null, '2026-10-30')).toBe('arbeiter');
		expect(effectiveRole('bauleiter', '2026-10-30', '2026-10-30')).toBe('bauleiter');
	});

	it('nur Arbeiter, nur ab heute, höchstens ein Jahr', async () => {
		expect(await setActingLead(admin, sepp, addDays(today(), 2))).toEqual({ message: 'Vorübergehend Partieführer werden kann nur ein Arbeiter.' });
		expect(await setActingLead(admin, max, addDays(today(), -1))).toEqual({ message: 'Bitte ein Datum ab heute wählen.' });
		expect(await setActingLead(admin, max, addDays(today(), 400))).toHaveProperty('message');
	});

	it('bekommt die Rechte eines Partieführers – und dessen Benachrichtigungen', async () => {
		const { token } = await createSession(max, false, null);
		expect((await validateSession(token))!.user).toMatchObject({ role: 'arbeiter', leadUntil: null });
		// Nur Partieführer bekommen „hilft aus" – Sepp, Max noch nicht
		expect(await recipientsFor('stunden.aushilfe', party)).toEqual([sepp]);

		const until = addDays(today(), 3);
		expect(await setActingLead(admin, max, until)).toBe(true);
		expect(notified.at(-1)).toMatchObject({ userIds: [max] });
		expect(notified.at(-1)!.title).toMatch(/^Bis .* vorübergehend Partieführer$/);
		expect((await validateSession(token))!.user).toMatchObject({ role: 'partiefuehrer', leadUntil: until });
		expect((await recipientsFor('stunden.aushilfe', party)).sort()).toEqual([max, sepp].sort());

		// Beenden: wieder Arbeiter
		expect(await setActingLead(admin, max, null)).toBe(true);
		expect((await validateSession(token))!.user).toMatchObject({ role: 'arbeiter', leadUntil: null });
	});
});
