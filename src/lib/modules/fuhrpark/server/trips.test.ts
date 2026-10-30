import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fahrten-'));

// GEOCODE=aus: in den Tests geht keine Anfrage an OpenStreetMap
vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false', GEOCODE: 'aus' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { users, vehiclePositions } = await import('$lib/server/db/schema');
const { formatAddress } = await import('./addresses');
const { createPlace, listPlaces, readPlace } = await import('./places');
const { dayView, logbook, readRange, summarize } = await import('./trips');
const { createVehicle, driverAt, driverHistory, getVehicle, listVehicles, parkedSince, readVehicle, updateVehicle } = await import('./vehicles');

const LAGER = { lat: 48.3608, lon: 16.4925 };
const BAUSTELLE = { lat: 48.3812, lon: 16.5163 };
const MIN = 60_000;
/** 27.10.2026, 23:30 in Wien (Winterzeit, UTC+1) */
const NIGHT = Date.UTC(2026, 9, 27, 22, 30);

const point = (vehicleId: number, at: number, p: { lat: number; lon: number }, speed: number) => ({ vehicleId, at: new Date(at), lat: p.lat, lon: p.lon, speed, accuracy: 6 });

/** Von a nach b, alle 30 Sekunden ein Punkt */
function drive(vehicleId: number, at: number, minutes: number, a: typeof LAGER, b: typeof LAGER) {
	return Array.from({ length: minutes * 2 + 1 }, (_, i) => {
		const f = i / (minutes * 2);
		return point(vehicleId, at + i * 30_000, { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }, 14);
	});
}

let id: number;
let driverId: number;

beforeAll(async () => {
	await ensureDatabase();
	const u = await db.insert(users).values({ username: 'fahrer', firstName: 'Erika', lastName: 'Lenker', passwordHash: 'x', role: 'partiefuehrer' }).returning({ id: users.id }).get();
	driverId = u.id;
	id = await createVehicle({ name: 'Bus 1', plate: 'W-1', kind: 'transporter', driverId: null, partyId: null, note: '', active: true });
	await createPlace({ name: 'Lager Eibesbrunn', address: '', ...LAGER, radius: 150 });
	// Nachtschicht: 23:30 weg vom Lager, über Mitternacht zur Baustelle, zwei Stunden dort, zurück
	await db.insert(vehiclePositions).values([
		point(id, NIGHT - 120 * MIN, LAGER, 0),
		...drive(id, NIGHT, 45, LAGER, BAUSTELLE),
		point(id, NIGHT + 165 * MIN, BAUSTELLE, 0),
		...drive(id, NIGHT + 165 * MIN + 30_000, 20, BAUSTELLE, LAGER),
		point(id, NIGHT + 300 * MIN, LAGER, 0)
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

const row = async () => (await listVehicles()).find((v) => v.id === id)!;

describe('Fahrten über Mitternacht', () => {
	it('der Tag zeigt die ganze Fahrt, auch wenn sie erst nach Mitternacht ankommt', async () => {
		const view = await dayView(await row(), '2026-10-27', await listPlaces());
		const trips = view.items.filter((s) => s.kind === 'fahrt');
		expect(trips).toHaveLength(1);
		expect(trips[0].to - trips[0].from).toBeGreaterThan(40 * MIN);
		expect(trips[0].startWhere).toMatchObject({ place: 'Lager Eibesbrunn' });
		// Die Standzeit am Lager davor trägt den Namen des Orts
		expect(view.items[0]).toMatchObject({ kind: 'stopp', number: 1, where: { place: 'Lager Eibesbrunn' } });
	});

	it('der Tag danach beginnt mit derselben Fahrt', async () => {
		const view = await dayView(await row(), '2026-10-28', await listPlaces());
		expect(view.items.map((s) => s.kind)).toEqual(['fahrt', 'stopp', 'fahrt', 'stopp']);
		expect(view.items[1]).toMatchObject({ number: 1 });
		expect(view.items[3]).toMatchObject({ number: 2, where: { place: 'Lager Eibesbrunn' } });
	});

	it('im Fahrtenbuch steht sie einmal – am Tag ihres Beginns', async () => {
		const first = await logbook([await row()], '2026-10-27', '2026-10-27', await listPlaces());
		expect(first.entries).toHaveLength(1);
		expect(first.entries[0].start).toBe('Lager Eibesbrunn');
		const both = await logbook([await row()], '2026-10-27', '2026-10-28', await listPlaces());
		expect(both.entries).toHaveLength(2);
		// Die Neueste zuerst
		expect(both.entries[0].from).toBeGreaterThan(both.entries[1].from);
		expect(both.km).toBeGreaterThan(5);
	});
});

describe('Fahrer', () => {
	it('frühere Fahrten behalten den Fahrer von damals', async () => {
		const before = await row();
		const input = { name: before.name, plate: before.plate, kind: before.kind, partyId: null, note: '', active: true };
		await updateVehicle(id, { ...input, driverId });
		expect(await getVehicle(id)).toMatchObject({ driverFirst: 'Erika', driverLast: 'Lenker' });
		// Zweimal dasselbe ist kein Wechsel
		await updateVehicle(id, { ...input, driverId });
		const history = (await driverHistory()).get(id)!;
		expect(history).toHaveLength(1);
		expect(driverAt(history, history[0].since - 1)).toBe('');
		expect(driverAt(history, history[0].since + 1)).toBe('Erika Lenker');
		// Die Nachtfahrt liegt vor dem Eintragen
		expect((await logbook([await row()], '2026-10-27', '2026-10-27', await listPlaces())).entries[0].driver).toBe('');
	});

	it('liest Art und Fahrer aus dem Formular – Unbekanntes wird Transporter', () => {
		const form = new FormData();
		form.set('name', 'Bus');
		form.set('art', 'lkw');
		form.set('fahrer', '7');
		expect(readVehicle(form)).toMatchObject({ kind: 'lkw', driverId: 7 });
		form.set('art', 'panzer');
		form.delete('fahrer');
		expect(readVehicle(form)).toMatchObject({ kind: 'transporter', driverId: null });
	});
});

describe('Feste Orte', () => {
	it('verlangt Name und Lage, begrenzt den Umkreis', () => {
		const form = new FormData();
		expect(readPlace(form)).toHaveProperty('message');
		form.set('name', 'Lager');
		expect(readPlace(form)).toHaveProperty('message');
		form.set('lat', '48.36');
		form.set('lon', '16.49');
		form.set('umkreis', '99999');
		expect(readPlace(form)).toMatchObject({ name: 'Lager', radius: 2000 });
	});

	it('seit wann ein Auto steht: die letzte Bewegung', async () => {
		const since = await parkedSince(id);
		expect(since).toBe(NIGHT + 165 * MIN + 30_000 + 20 * MIN);
	});

	it('Anschrift aus der Antwort von OpenStreetMap', () => {
		expect(formatAddress({ road: 'Porschestraße', house_number: '17', postcode: '1230', city: 'Wien' })).toBe('Porschestraße 17, 1230 Wien');
		expect(formatAddress({ postcode: '2203', village: 'Eibesbrunn' })).toBe('2203 Eibesbrunn');
		expect(formatAddress({})).toBe('');
	});
});

describe('Statistik', () => {
	it('zählt Fahrten am Tag ihres Beginns, Orte nur im Zeitraum', () => {
		const from = Date.UTC(2026, 9, 26, 23);
		const to = from + 2 * 86_400_000;
		const trip = (at: number, km: number) => ({ kind: 'fahrt' as const, from: at, to: at + 30 * MIN, start: LAGER, end: BAUSTELLE, km, maxSpeed: 25 });
		const stats = summarize(
			[
				{
					vehicle: { id: 1, name: 'Bus', kind: 'transporter' },
					segments: [
						// Vor dem Zeitraum: zählt nicht
						trip(from - 120 * MIN, 50),
						// Über Mitternacht: zählt ganz am ersten Tag
						trip(from + 86_400_000 - 10 * MIN, 12.34),
						{ kind: 'stopp', from: from + 86_400_000 + 20 * MIN, to: from + 86_400_000 + 80 * MIN, ...LAGER, minutes: 60 }
					]
				},
				{ vehicle: { id: 2, name: 'LKW', kind: 'lkw' }, segments: [] }
			],
			from,
			to,
			[{ id: 1, name: 'Lager', ...LAGER, radius: 150 }]
		);
		expect(stats).toMatchObject({ km: 12.3, driving: 30, trips: 1 });
		expect(stats.vehicles.map((v) => v.name)).toEqual(['Bus', 'LKW']);
		expect(stats.vehicles[0].topSpeed).toBe(90);
		expect(stats.days).toEqual([
			{ date: '2026-10-27', km: 12.3 },
			{ date: '2026-10-28', km: 0 }
		]);
		expect(stats.places).toEqual([{ name: 'Lager', visits: 1, minutes: 60 }]);
	});
});

describe('Zeitraum', () => {
	const url = (q: string) => new URL(`https://portal.example/x?${q}`);
	it('nimmt Vorgabe, begrenzt auf 31 Tage und die Speicherdauer', () => {
		const a = readRange(url(''), 7, 90);
		expect(a.to).toBe(a.today);
		const b = readRange(url('von=2020-01-01&bis=nix'), 7, 90);
		expect(b.from).toBe(a.from);
		const c = readRange(url(`von=${a.oldest}`), 7, 90);
		expect(c.from > a.oldest).toBe(true);
	});
});
