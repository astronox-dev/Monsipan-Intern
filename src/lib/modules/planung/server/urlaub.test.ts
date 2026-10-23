import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'urlaub-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

// Benachrichtigungen nur mitschreiben
const notified = vi.hoisted(() => [] as { event: string; title: string; body?: string }[]);
vi.mock('$lib/server/notifications', () => ({ notify: (n: (typeof notified)[number]) => notified.push(n) }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { parties, users } = await import('$lib/server/db/schema');
const { updateSettings } = await import('$lib/server/settings');
const { approvedTotals, createLeave, decideLeave, listLeave } = await import('./urlaub');
const { createSick, listSick } = await import('./krank');
const { accountPeople, leaveAccountsFor, saveEmployment, saveLeaveAccount } = await import('./konto');

type Who = Parameters<typeof listLeave>[0];
const as = (u: { id: number; role: string; partyId: number | null }) => ({ username: `u${u.id}`, email: null, firstName: 'X', lastName: 'Y', owner: false, mustChangePassword: false, ...u }) as unknown as Who;

let eva: Who, admin: Who;

beforeAll(async () => {
	await ensureDatabase();
	const [e] = await db.insert(users).values({ username: 'eva', firstName: 'Eva', passwordHash: 'x', role: 'arbeiter' }).returning({ id: users.id });
	eva = as({ id: e.id, role: 'arbeiter', partyId: null });
	admin = as({ id: (await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).get())!.id, role: 'admin', partyId: null });
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

const leaveRow = async (id: number) => (await listLeave(admin, 2026)).find((r) => r.id === id)!;

describe('Urlaubsstunden', () => {
	it('beim Genehmigen festgehalten – spätere Einstellungen gelten nur für neue', async () => {
		await updateSettings({ leaveHours: [8, 8, 8, 8, 7, 0, 0] });
		// Mo 2. – Fr 6.11.2026
		const id = await createLeave(eva, { userId: eva.id, from: '2026-11-02', to: '2026-11-06', note: '' });
		if (typeof id !== 'number') throw new Error(id.message);
		expect(notified.at(-1)).toMatchObject({ event: 'urlaub.beantragt', body: '02.11. – 06.11.2026 · 5 Arbeitstage · 39 Std.' });
		expect(await decideLeave(admin, id, 'genehmigt', '')).toBe(true);
		expect(notified.at(-1)).toMatchObject({ event: 'urlaub.entschieden', body: '02.11. – 06.11.2026 · 39 Std.' });

		await updateSettings({ leaveHours: [10, 10, 10, 10, 0, 0, 0] });
		expect((await leaveRow(id)).usage).toMatchObject({ days: 5, hours: 39, sickDays: 0 });

		// Noch offen: rechnet mit den aktuellen Stunden, der Freitag zählt jetzt nicht
		const open = await createLeave(eva, { userId: eva.id, from: '2026-11-09', to: '2026-11-13', note: '' });
		if (typeof open !== 'number') throw new Error(open.message);
		expect((await leaveRow(open)).usage).toMatchObject({ days: 4, hours: 40 });
	});

	it('Krankenstand im Urlaub unterbricht ihn erst ab mehr als drei Tagen', async () => {
		const id = (await listLeave(admin, 2026)).find((r) => r.from === '2026-11-02')!.id;
		// Krank Mi 4. – Do 5.11.: zwei Tage, der Urlaub läuft weiter
		expect(typeof (await createSick(admin, { userId: eva.id, from: '2026-11-04', to: '2026-11-05', note: '' }, []))).toBe('number');
		expect(notified.at(-1)?.body).toBe('04.11. – 05.11.2026 · Krankmeldung folgt · im Urlaub – bis 3 Tage, der Urlaub läuft weiter');
		expect((await leaveRow(id)).usage).toMatchObject({ days: 5, hours: 39, sickDays: 0, interruptions: [] });
		expect((await listSick(admin, 2026)).find((s) => s.userId === eva.id)).toMatchObject({ leave: [{ from: '2026-11-02', to: '2026-11-06' }], interrupts: false });

		// Verlängert bis Sa 7.11.: zusammen vier Tage – Mi, Do, Fr zählen nicht
		expect(typeof (await createSick(admin, { userId: eva.id, from: '2026-11-06', to: '2026-11-07', note: '' }, []))).toBe('number');
		expect(notified.at(-1)?.body).toBe('06.11. – 07.11.2026 · Krankmeldung folgt · unterbricht den Urlaub');
		const row = await leaveRow(id);
		expect(row.usage).toMatchObject({ days: 2, hours: 16, sickDays: 3, sickHours: 23, interruptions: [{ from: '2026-11-04', to: '2026-11-06' }] });
		expect(approvedTotals(await listLeave(admin, 2026)).get(eva.id)).toEqual({ days: 2, hours: 16 });
		expect((await listSick(admin, 2026)).filter((s) => s.userId === eva.id).map((s) => s.interrupts)).toEqual([true, true]);
	});

	it('ohne Urlaubsstunden im Zeitraum kein Antrag', async () => {
		// Sa 14. – So 15.11.
		expect(await createLeave(eva, { userId: eva.id, from: '2026-11-14', to: '2026-11-15', note: '' })).toEqual({
			message: 'In diesem Zeitraum liegt kein Arbeitstag mit Urlaubsstunden.'
		});
	});
});

describe('Urlaubskonto', () => {
	const account = async (today: string) => (await leaveAccountsFor([eva.id], today)).get(eva.id)!;

	it('Übertrag + je Beschäftigungswoche erworben − genehmigt (ohne Krankenstandstage)', async () => {
		await updateSettings({ leaveHours: [8, 8, 8, 8, 7, 0, 0], leaveWeeks: 5 });
		expect((await account('2026-11-30')).setUp).toBe(false);

		// Pflegen darf nur, wer Urlaubskonten bearbeiten darf
		expect(await saveEmployment(eva, { id: null, userId: eva.id, from: '2026-03-02', to: null })).toEqual({ message: 'Dafür fehlt dir die Berechtigung.' });
		expect(await saveEmployment(admin, { id: null, userId: eva.id, from: '2026-03-02', to: null })).toBe(true);
		expect(await saveLeaveAccount(admin, { userId: eva.id, carryover: 20, start: '2026-03-01', weeks: null })).toBe(true);

		// 2.3. – 30.11.: 274 Tage ÷ 7 × 3,75 = 146,79; genehmigt Mo 2. – Fr 6.11. ohne Mi–Fr (krank) = 16
		const a = await account('2026-11-30');
		expect(a.rate).toBe(3.75);
		expect(a.account).toEqual({ carryover: 20, earned: 146.79, used: 16, rest: 150.79 });
		expect(a.state).toEqual({ state: 'angemeldet', date: '2026-03-02' });
	});

	it('über den Winter abgemeldet: danach kommt nichts mehr dazu', async () => {
		const period = (await account('2026-11-30')).periods[0];
		// Überschneidungen gehen nicht
		expect(await saveEmployment(admin, { id: null, userId: eva.id, from: '2026-01-01', to: '2026-03-05' })).toHaveProperty('message');
		expect(await saveEmployment(admin, { id: period.id, userId: eva.id, from: '2026-03-02', to: '2026-11-20' })).toBe(true);
		// 2.3. – 20.11.: 264 Tage
		const a = await account('2027-01-15');
		expect(a.account).toEqual({ carryover: 20, earned: 141.43, used: 16, rest: 145.43 });
		expect(a.state).toEqual({ state: 'abgemeldet', date: '2026-11-21' });
	});

	it('ab dem Stichtag: was davor lag, steckt im Übertrag', async () => {
		expect(await saveLeaveAccount(admin, { userId: eva.id, carryover: 20, start: '2026-11-03', weeks: null })).toBe(true);
		// Erworben 3. – 20.11. (18 Tage), vom Urlaub nur noch Di 3.11. (Mi–Fr krank) = 8 Std.
		expect((await account('2027-01-15')).account).toEqual({ carryover: 20, earned: 9.64, used: 8, rest: 21.64 });
		// Eigene Urlaubswochen
		expect(await saveLeaveAccount(admin, { userId: eva.id, carryover: 0, start: null, weeks: 6 })).toBe(true);
		expect((await account('2027-01-15')).rate).toBe(4.5);
	});

	it('ausgenommen wie bei den Stundenzetteln: fehlt in den Urlaubskonten', async () => {
		expect((await accountPeople(admin)).map((p) => p.id)).toContain(eva.id);
		await db.update(users).set({ leaveAccountExempt: true }).where(eq(users.id, eva.id));
		expect((await accountPeople(admin)).map((p) => p.id)).not.toContain(eva.id);
		expect(await accountPeople(eva)).toEqual([]);
		await db.update(users).set({ leaveAccountExempt: false }).where(eq(users.id, eva.id));
	});

	it('nach Partien wie in der Wochenplanung, Partieführer zuerst, ohne Partie am Ende', async () => {
		const [nord, sued] = await db
			.insert(parties)
			.values([
				{ name: 'Nord', planOrder: 2 },
				{ name: 'Süd', planOrder: 1 }
			])
			.returning({ id: parties.id });
		const made = await db
			.insert(users)
			.values([
				{ username: 'anna', firstName: 'Anna', passwordHash: 'x', role: 'arbeiter', partyId: nord.id },
				{ username: 'zeno', firstName: 'Zeno', passwordHash: 'x', role: 'partiefuehrer', partyId: nord.id },
				{ username: 'bert', firstName: 'Bert', passwordHash: 'x', role: 'arbeiter', partyId: sued.id }
			])
			.returning({ id: users.id });
		const order = (await accountPeople(admin, true)).map((p) => p.id);
		const [anna, zeno, bert] = made.map((m) => m.id);
		// Süd (Platz 1) vor Nord (Platz 2), in Nord der Partieführer zuerst, Eva und Admin ohne Partie am Ende
		expect(order.slice(0, 3)).toEqual([bert, zeno, anna]);
		expect(order.slice(3)).toEqual(expect.arrayContaining([eva.id, admin.id]));
	});
});
