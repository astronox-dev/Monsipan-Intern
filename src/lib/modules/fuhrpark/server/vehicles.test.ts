import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fuhrpark-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { vehiclePositions } = await import('$lib/server/db/schema');
const { cleanPositions, createVehicle, dayPoints, getVehicle, pairDevice, purgeOldPositions, recordPositions, startPairing, unpair, vehicleByToken } = await import('./vehicles');

let id: number;

beforeAll(async () => {
	await ensureDatabase();
	id = await createVehicle({ name: 'Pritsche Nord', plate: 'MI-123AB', kind: 'lkw', driverId: null, partyId: null, note: '', active: true });
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Fuhrpark – Koppeln', () => {
	it('tauscht den Code einmal gegen einen Schlüssel', async () => {
		const { code } = await startPairing(id);
		expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		expect(await pairDevice('FALSCH12', 'Tablet')).toBeNull();
		// Klein, ohne Bindestrich – geht auch
		const paired = await pairDevice(code.replace('-', '').toLowerCase(), 'Galaxy Tab A9');
		expect(paired?.vehicle).toEqual({ id, name: 'Pritsche Nord' });
		expect(await vehicleByToken(paired!.token)).toMatchObject({ id, active: true });
		expect((await getVehicle(id))!).toMatchObject({ paired: true, deviceName: 'Galaxy Tab A9', pairing: false });
		// Der Code ist verbraucht
		expect(await pairDevice(code, 'Noch eins')).toBeNull();
	});

	it('entkoppeln macht den Schlüssel ungültig', async () => {
		const { code } = await startPairing(id);
		const { token } = (await pairDevice(code, 'Tablet'))!;
		await unpair(id);
		expect(await vehicleByToken(token)).toBeNull();
	});
});

describe('Fuhrpark – Standorte', () => {
	it('nimmt nur gültige Standorte an', () => {
		const now = Date.UTC(2026, 9, 27, 12);
		const out = cleanPositions(
			[
				{ t: now - 60_000, lat: 48.36, lon: 16.49, spd: 12.5, hdg: 90, acc: 8 },
				{ t: now - 120_000, lat: 48.35, lon: 16.48, acc: 12 },
				{ t: now + 3_600_000, lat: 48.36, lon: 16.49 }, // Zukunft
				{ t: now - 8 * 86_400_000, lat: 48.36, lon: 16.49 }, // zu alt
				{ t: now, lat: 0, lon: 0 }, // kein Fix
				{ t: now, lat: 48.36, lon: 16.49, acc: 5000 }, // zu ungenau
				{ t: 'jetzt', lat: 48.36, lon: 16.49 },
				null
			],
			now
		);
		expect(out.map((p) => p.t)).toEqual([now - 120_000, now - 60_000]);
		expect(out[1]).toMatchObject({ spd: 12.5, hdg: 90, acc: 8 });
		expect(cleanPositions('kaputt')).toEqual([]);
	});

	it('speichert sie, merkt sich den letzten – auch ein Lebenszeichen ohne Standort', async () => {
		const day = Date.UTC(2026, 9, 27, 7); // 08:00 in Wien
		await recordPositions({ id, lastAt: null }, [{ t: day, lat: 48.36, lon: 16.49, spd: 0, acc: 8 }, { t: day + 60_000, lat: 48.37, lon: 16.5, spd: 14, hdg: 45, acc: 6 }], {
			battery: 87,
			charging: true
		});
		let v = (await getVehicle(id))!;
		expect(v).toMatchObject({ lastLat: 48.37, lastLon: 16.5, lastSpeed: 14, lastHeading: 45, battery: 87, charging: true });
		expect(v.lastAt?.getTime()).toBe(day + 60_000);

		// Nachgereicht (älter): ändert den letzten Standort nicht
		await recordPositions({ id, lastAt: v.lastAt }, [{ t: day - 3_600_000, lat: 48.1, lon: 16.1 }], { battery: null, charging: false });
		v = (await getVehicle(id))!;
		expect(v).toMatchObject({ lastLat: 48.37, charging: false, battery: 87 });

		expect((await dayPoints(id, '2026-10-27')).map((p) => p.lat)).toEqual([48.1, 48.36, 48.37]);
		expect(await dayPoints(id, '2026-10-28')).toEqual([]);
	});

	it('löscht Standorte nach 90 Tagen', async () => {
		await db.insert(vehiclePositions).values({ vehicleId: id, at: new Date(Date.UTC(2026, 6, 1)), lat: 48, lon: 16 });
		expect(await purgeOldPositions(new Date(Date.UTC(2026, 9, 27)))).toBe(1);
		expect(await dayPoints(id, '2026-07-01')).toEqual([]);
		expect((await dayPoints(id, '2026-10-27')).length).toBe(3);
	});
});
