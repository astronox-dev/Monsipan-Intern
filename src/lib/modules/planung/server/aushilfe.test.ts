import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aushilfe-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { and, eq } = await import('drizzle-orm');
const { notifications, orders, parties, planEntries, timesheetDays, users, workOrders } = await import('$lib/server/db/schema');
const { crewWeek, guestDaysAt, guestsOfParty, notifyCrewChange, planWeek, resetCrew, setCrew } = await import('./plan');
const { listOrders, mayOpenOrder } = await import('$lib/modules/auftraege/server/orders');
const { guestEditDays, mayEdit, mayViewSheet, openSheet, saveSheetDays, sheetDetail, weekOverview } = await import('$lib/modules/stunden/server/timesheets');

type Who = Parameters<typeof planWeek>[0];
const as = (u: { id: number; role: string; partyId: number | null }) => ({ username: `u${u.id}`, email: null, firstName: 'X', lastName: 'Y', owner: false, mustChangePassword: false, ...u }) as unknown as Who;

const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';

let nord: number, sued: number;
let eva: Who, sepp: Who, hans: Who, admin: Who;

beforeAll(async () => {
	await ensureDatabase();
	[{ id: nord }, { id: sued }] = await db.insert(parties).values([{ name: 'Nord' }, { name: 'Süd' }]).returning({ id: parties.id });
	const [e, s, h] = await db
		.insert(users)
		.values([
			{ username: 'eva', firstName: 'Eva', passwordHash: 'x', role: 'arbeiter', partyId: nord },
			{ username: 'sepp', firstName: 'Sepp', passwordHash: 'x', role: 'partiefuehrer', partyId: sued },
			{ username: 'hans', firstName: 'Hans', passwordHash: 'x', role: 'partiefuehrer', partyId: nord }
		])
		.returning({ id: users.id });
	eva = as({ id: e.id, role: 'arbeiter', partyId: nord });
	sepp = as({ id: s.id, role: 'partiefuehrer', partyId: sued });
	hans = as({ id: h.id, role: 'partiefuehrer', partyId: nord });
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

describe('Einteilung bei einer anderen Partie', () => {
	it('am Dienstag bei Süd: Planung, Aufträge und Stundenzettel – und Bescheid', async () => {
		const before = await crewWeek(eva.id, MON);
		expect(await setCrew(admin, { userId: eva.id, partyId: sued, date: TUE })).toBeNull();
		await notifyCrewChange(admin, eva.id, before, MON);
		expect((await crewWeek(eva.id, MON)).days.map((d) => d.partyId)).toEqual([nord, sued, nord, nord, nord, nord, nord]);
		expect(await guestDaysAt(eva.id, MON, sued)).toEqual([TUE]);
		expect(await guestDaysAt(eva.id, MON, nord)).toEqual([]);
		expect([...(await guestsOfParty(sued, MON))]).toEqual([[eva.id, [TUE]]]);

		// Bescheid an Eva
		await new Promise((r) => setTimeout(r, 200));
		const told = await db.select().from(notifications).where(and(eq(notifications.userId, eva.id), eq(notifications.event, 'planung.einteilung'))).all();
		expect(told).toHaveLength(1);
		expect(told[0].body).toContain('Süd');

		// Zwei Aufträge von Süd mit Arbeitsauftrag: einer am Dienstag, einer am Mittwoch eingeplant
		const [diens, mitt] = await db
			.insert(orders)
			.values([
				{ number: '26300', title: 'Dienstag', partyId: sued },
				{ number: '26301', title: 'Mittwoch', partyId: sued }
			])
			.returning({ id: orders.id, partyId: orders.partyId });
		await db.insert(workOrders).values([
			{ orderId: diens.id, content: {} },
			{ orderId: mitt.id, content: {} }
		]);
		await db.insert(planEntries).values([
			{ date: TUE, partyId: sued, orderId: diens.id },
			{ date: WED, partyId: sued, orderId: mitt.id }
		]);

		// Planung: Süd nur am Dienstag
		const plan = await planWeek(eva, MON);
		expect(plan.parties.map((p) => p.name)).toEqual(['Nord', 'Süd']);
		expect(plan.guestDays).toEqual({ [sued]: [TUE] });
		expect(plan.entries.filter((e) => e.partyId === sued).map((e) => e.date)).toEqual([TUE]);

		// Aufträge: nur der vom Dienstag
		expect(await mayOpenOrder(eva, diens)).toBe(true);
		expect(await mayOpenOrder(eva, mitt)).toBe(false);
		expect((await listOrders(eva, {})).map((o) => o.id)).toEqual([diens.id]);

		// Stundenzettel: der Partieführer von Süd sieht Eva und trägt den Dienstag ein
		const row = (await weekOverview(sepp, MON)).find((r) => r.user.id === eva.id);
		expect(row?.guestDays).toEqual([TUE]);
		const id = await openSheet(eva.id, MON, MON.slice(0, 7), sepp.id);
		const sheet = (await sheetDetail(id))!;
		expect(await mayViewSheet(sepp, sheet)).toBe(true);
		expect(mayEdit(sepp, sheet)).toBe(false);
		expect(await guestEditDays(sepp, sheet)).toEqual([TUE]);
		// Die eigene Partie schreibt den ganzen Zettel wie bisher
		expect(mayEdit(hans, sheet)).toBe(true);
		expect(await guestEditDays(hans, sheet)).toEqual([]);

		const day = (date: string, site: string) => ({ date, site, costCenter: '', times: [], normalHours: '8', overtime50: '', overtime100: '', vacationHours: '', holidayHours: '', rainHours: '', sickHours: '' });
		await saveSheetDays(id, [day(TUE, 'Süd-Baustelle')]);
		const saved = await db.select({ date: timesheetDays.date, site: timesheetDays.site }).from(timesheetDays).where(eq(timesheetDays.timesheetId, id)).all();
		expect(saved.find((d) => d.date === TUE)?.site).toBe('Süd-Baustelle');
		expect(saved.find((d) => d.date === WED)?.site).toBe('');

		// Zurück zur eigenen Partie: nichts mehr von Süd – und wieder Bescheid
		const moved = await crewWeek(eva.id, MON);
		await resetCrew({ userId: eva.id, date: TUE });
		await notifyCrewChange(admin, eva.id, moved, MON);
		expect(await mayOpenOrder(eva, diens)).toBe(false);
		expect((await planWeek(eva, MON)).parties.map((p) => p.name)).toEqual(['Nord']);
		expect(await mayViewSheet(sepp, sheet)).toBe(false);
		await new Promise((r) => setTimeout(r, 200));
		const again = await db.select().from(notifications).where(and(eq(notifications.userId, eva.id), eq(notifications.event, 'planung.einteilung'))).all();
		expect(again).toHaveLength(2);
	});

	it('die ganze Woche bei Süd: alle Tage – außer einer zeigt woanders hin', async () => {
		expect(await setCrew(admin, { userId: eva.id, partyId: sued, weekStart: MON })).toBeNull();
		expect(await guestDaysAt(eva.id, MON, sued)).toHaveLength(7);
		// Mittwoch zurück zu Nord
		expect(await setCrew(admin, { userId: eva.id, partyId: nord, date: WED })).toBeNull();
		expect(await guestDaysAt(eva.id, MON, sued)).not.toContain(WED);
		const mitt = (await db.select({ id: orders.id, partyId: orders.partyId }).from(orders).where(eq(orders.number, '26301')).get())!;
		expect(await mayOpenOrder(eva, mitt)).toBe(false);
		const diens = (await db.select({ id: orders.id, partyId: orders.partyId }).from(orders).where(eq(orders.number, '26300')).get())!;
		expect(await mayOpenOrder(eva, diens)).toBe(true);
		await resetCrew({ userId: eva.id, date: WED });
		expect(await mayOpenOrder(eva, mitt)).toBe(true);
	});
});

describe('VAZ', () => {
	it('ein neuer Zettel eines Partieführers hat 10 % VAZ, der eines Arbeiters keine', async () => {
		const week = '2026-11-02';
		expect((await sheetDetail(await openSheet(hans.id, week, week.slice(0, 7), admin.id)))!.vazPercent).toBe(10);
		expect((await sheetDetail(await openSheet(eva.id, week, week.slice(0, 7), admin.id)))!.vazPercent).toBeNull();
	});
});
