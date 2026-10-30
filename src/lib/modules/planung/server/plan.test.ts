import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'planung-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { orders, parties, users } = await import('$lib/server/db/schema');
const { planEntries } = await import('$lib/server/db/schema');
const { addEntry, claimOrder, moveEntry, partyOnDay, planWeek, resetCrew, setCrew, setPartyOrder, unassignedOrders, unplanOrder } = await import('./plan');

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

	it('zurückziehen: ohne Partie, Einträge ab heute weg, vergangene bleiben', async () => {
		const [p] = await db.insert(parties).values([{ name: 'Partie Z' }]).returning({ id: parties.id });
		const [o] = await db.insert(orders).values([{ number: '9010', title: 'Zurück', partyId: p.id }]).returning({ id: orders.id });
		const admin = (await db.select().from(users).get())!;
		const me = { ...admin, effectiveRole: admin.role } as never;
		const entry = async (date: string) => (await addEntry(me, { date, partyId: p.id, orderId: o.id, text: '' })) as number;
		const past = await entry('2026-10-20');
		const now = await entry('2026-10-29');
		await entry('2026-10-30');
		const result = await unplanOrder(now, '2026-10-29');
		expect(result).toEqual({ orderId: o.id, number: '9010' });
		expect((await unassignedOrders()).map((u) => u.id)).toContain(o.id);
		const left = await db.select({ id: planEntries.id }).from(planEntries).where(eq(planEntries.orderId, o.id)).all();
		expect(left.map((l) => l.id)).toEqual([past]);
		// Ein Eintrag ohne Auftrag lässt sich nicht zurücklegen
		const plain = (await addEntry(me, { date: '2026-10-29', partyId: p.id, orderId: null, text: 'Lager' })) as number;
		expect(await unplanOrder(plain, '2026-10-29')).toHaveProperty('message');
	});
});

describe('Besetzung, Verschieben und Spalten', () => {
	const MON = '2026-10-19';
	const TUE = '2026-10-20';
	const admin = { id: 1, role: 'admin', partyId: null } as unknown as Parameters<typeof planWeek>[0];

	it('Leute für die Woche oder einen Tag woanders – die feste Partie bleibt', async () => {
		const [nord, sued] = await db.insert(parties).values([{ name: 'Nord' }, { name: 'Süd' }]).returning({ id: parties.id });
		const [max, eva] = await db
			.insert(users)
			.values([
				{ username: 'max', firstName: 'Max', passwordHash: 'x', role: 'arbeiter', partyId: nord.id },
				{ username: 'eva', firstName: 'Eva', passwordHash: 'x', role: 'arbeiter', partyId: nord.id }
			])
			.returning({ id: users.id });
		const membersOf = async (week: string, partyId: number) => (await planWeek(admin, week)).parties.find((p) => p.id === partyId)!.members;

		// Max die ganze Woche zu Süd, Eva nur am Dienstag
		expect(await setCrew(admin, { userId: max.id, partyId: sued.id, weekStart: MON })).toBeNull();
		expect(await setCrew(admin, { userId: eva.id, partyId: sued.id, date: TUE })).toBeNull();
		expect((await membersOf(MON, nord.id)).map((m) => m.name)).toEqual(['Eva']);
		expect(await membersOf(MON, sued.id)).toEqual([{ id: max.id, name: 'Max', fromName: 'Nord', canLead: true, leadUntil: null }]);
		const week = await planWeek(admin, MON);
		expect(week.dayMoves).toEqual([
			expect.objectContaining({ userId: eva.id, date: TUE, partyId: sued.id, fromPartyId: nord.id, name: 'Eva', partyName: 'Süd', fromPartyName: 'Nord' })
		]);
		// Das Konto bleibt unverändert, die nächste Woche auch
		expect((await db.select({ partyId: users.partyId }).from(users).where(eq(users.id, max.id)).get())?.partyId).toBe(nord.id);
		expect((await membersOf('2026-10-26', nord.id)).map((m) => m.name)).toEqual(['Eva', 'Max']);
		// Heute laut Plan: am Dienstag ist Eva bei Süd
		expect(await partyOnDay(eva.id, nord.id, TUE)).toBe(sued.id);
		expect(await partyOnDay(max.id, nord.id, TUE)).toBe(sued.id);
		expect(await partyOnDay(max.id, nord.id, '2026-10-26')).toBe(nord.id);

		// Zurück auf die eigene Partie heißt: die Abweichung ist weg
		expect(await setCrew(admin, { userId: eva.id, partyId: nord.id, date: TUE })).toBeNull();
		expect((await planWeek(admin, MON)).dayMoves).toEqual([]);
		await resetCrew({ userId: max.id, weekStart: MON });
		expect((await membersOf(MON, nord.id)).map((m) => m.name)).toEqual(['Eva', 'Max']);
		expect(await setCrew(admin, { userId: max.id, partyId: 99999, weekStart: MON })).toMatch(/Partie/);
	});

	it('Einträge per Ziehen auf ein anderes Feld, vor einen anderen oder ans Ende', async () => {
		const [a, b] = await db.insert(parties).values([{ name: 'Feld A' }, { name: 'Feld B' }]).returning({ id: parties.id });
		const add = async (partyId: number, text: string) => (await addEntry(admin, { date: MON, partyId, orderId: null, text })) as number;
		const x = await add(a.id, 'X');
		const y = await add(b.id, 'Y');
		const z = await add(b.id, 'Z');
		const cell = async (partyId: number, date: string) =>
			(await planWeek(admin, MON)).entries.filter((e) => e.partyId === partyId && e.date === date).map((e) => e.text);

		expect(await moveEntry(x, { date: MON, partyId: b.id, beforeId: z })).toEqual({ orderId: null });
		expect(await cell(b.id, MON)).toEqual(['Y', 'X', 'Z']);
		expect(await cell(a.id, MON)).toEqual([]);
		await moveEntry(y, { date: TUE, partyId: b.id, beforeId: null });
		expect(await cell(b.id, MON)).toEqual(['X', 'Z']);
		expect(await cell(b.id, TUE)).toEqual(['Y']);
		// Innerhalb des Feldes ans Ende
		await moveEntry(x, { date: MON, partyId: b.id, beforeId: null });
		expect(await cell(b.id, MON)).toEqual(['Z', 'X']);
		expect(await moveEntry(999999, { date: MON, partyId: b.id, beforeId: null })).toMatchObject({ message: expect.any(String) });
	});

	it('Spalten in eigener Reihenfolge, der Rest alphabetisch dahinter', async () => {
		const names = async () => (await planWeek(admin, MON)).parties.map((p) => p.name);
		const all = await db.select({ id: parties.id, name: parties.name }).from(parties).all();
		const id = (name: string) => all.find((p) => p.name === name)!.id;
		await setPartyOrder([id('Süd'), id('Feld B')]);
		const order = await names();
		expect(order.slice(0, 2)).toEqual(['Süd', 'Feld B']);
		expect(order.slice(2)).toEqual([...order.slice(2)].sort((x, y) => x.localeCompare(y)));
	});
});
