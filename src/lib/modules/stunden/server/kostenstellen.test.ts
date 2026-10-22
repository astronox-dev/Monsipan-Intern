import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kostenstellen-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { parties, timesheetDays, timesheets, users } = await import('$lib/server/db/schema');
const { costCenterHours, knownCostCenters, readCostCenterFilter } = await import('./kostenstellen');

beforeAll(async () => {
	await ensureDatabase();
	const [nord, sued] = await db.insert(parties).values([{ name: 'Nord' }, { name: 'Süd' }]).returning({ id: parties.id });
	const [eva, sepp] = await db
		.insert(users)
		.values([
			{ username: 'eva', firstName: 'Eva', passwordHash: 'x', role: 'arbeiter', partyId: nord.id },
			{ username: 'sepp', firstName: 'Sepp', passwordHash: 'x', role: 'arbeiter', partyId: sued.id }
		])
		.returning({ id: users.id });
	// Eva: eigene Partie, freigegeben. Sepp: hilft diese Woche bei Nord aus (Nord schreibt), noch in Arbeit
	const [a, b] = await db
		.insert(timesheets)
		.values([
			{ userId: eva.id, weekStart: '2026-10-19', month: '2026-10', status: 'freigegeben' },
			{ userId: sepp.id, weekStart: '2026-10-19', month: '2026-10', status: 'entwurf', writingPartyId: nord.id }
		])
		.returning({ id: timesheets.id });
	await db.insert(timesheetDays).values([
		{ timesheetId: a.id, date: '2026-10-19', costCenter: '24117', normalHours: 8, overtime50: 1 },
		{ timesheetId: a.id, date: '2026-10-20', costCenter: 'Lager', normalHours: 4 },
		// Urlaub zählt nicht als gearbeitet
		{ timesheetId: a.id, date: '2026-10-21', costCenter: '24117', vacationHours: 8 },
		{ timesheetId: b.id, date: '2026-10-19', costCenter: '24 117', normalHours: 7.5 },
		{ timesheetId: b.id, date: '2026-10-20', costCenter: '', normalHours: 6 }
	]);
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Stunden je Kostenstelle', () => {
	it('alle Partien zusammen, die Aushilfe bei der schreibenden Partie', async () => {
		const rows = await costCenterHours('2026-10-01', '2026-10-31');
		expect(rows.map((r) => [r.label, r.total])).toEqual([
			['24117', 16.5],
			['Lager', 4],
			['', 6]
		]);
		expect(rows[0]).toMatchObject({ people: 2, parties: [{ name: 'Nord', hours: 16.5 }] });
	});

	it('nur freigegebene bzw. geprüfte Zettel, nur im Zeitraum', async () => {
		expect((await costCenterHours('2026-10-01', '2026-10-31', 'freigegeben')).map((r) => [r.label, r.total])).toEqual([
			['24117', 9],
			['Lager', 4]
		]);
		expect(await costCenterHours('2026-10-01', '2026-10-31', 'geprueft')).toEqual([]);
		expect((await costCenterHours('2026-10-20', '2026-10-20')).map((r) => r.label)).toEqual(['Lager', '']);
	});

	it('schlägt die bekannten Kostenstellen vor – jede nur einmal, so geschrieben wie in der Auswertung', async () => {
		const known = await knownCostCenters();
		expect(known).toHaveLength(2);
		expect(known).toEqual(['24117', 'Lager']);
	});

	it('liest den Filter aus der Adresse', () => {
		expect(readCostCenterFilter(new URLSearchParams('von=2026-10-31&bis=2026-10-01&stand=geprueft'))).toEqual({ from: '2026-10-01', to: '2026-10-31', scope: 'geprueft' });
		expect(readCostCenterFilter(new URLSearchParams('stand=quatsch')).scope).toBe('alle');
	});
});
