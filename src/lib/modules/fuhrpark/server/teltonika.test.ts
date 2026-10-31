import fs from 'node:fs';
import { connect, type AddressInfo, type Server, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teltonika-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false', GEOCODE: 'aus' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { vehiclePositions, vehicles } = await import('$lib/server/db/schema');
const { eq } = await import('drizzle-orm');
const { crc16 } = await import('./teltonika-protocol');
const { startTeltonika } = await import('./teltonika');
const { createVehicle, getVehicle, imeiTaken, preferTracker, rangePoints, readVehicle, recordPositions, usesSource, validImei, vehicleByImei } = await import('./vehicles');

const IMEI = '356307042441013';
const OTHER_IMEI = '490154203237518';

let server: Server;
let port: number;
let id: number;

beforeAll(async () => {
	await ensureDatabase();
	id = await createVehicle({ name: 'Mit Tracker', plate: 'W-2', kind: 'lkw', tracking: 'teltonika', trackerImei: IMEI, driverId: null, partyId: null, note: '', active: true });
	server = await startTeltonika(0, '127.0.0.1');
	port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	await new Promise((r) => server.close(r));
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

/** Ein Paket mit Standorten, wie der Tracker es schickt: Zündung an, Kilometerstand, Spannung */
function packet(points: { at: number; lat: number; lon: number; kmh: number; satellites?: number }[]): Buffer {
	const records = points.map((p) => {
		const gps = Buffer.alloc(24);
		gps.writeBigUInt64BE(BigInt(p.at), 0);
		gps.writeInt32BE(Math.round(p.lon * 1e7), 9);
		gps.writeInt32BE(Math.round(p.lat * 1e7), 13);
		gps.writeUInt16BE(90, 19);
		gps[21] = p.satellites ?? 9;
		gps.writeUInt16BE(p.kmh, 22);
		// Ereignis, 3 Werte: 1 Byte Zündung; 2 Byte Spannung; 4 Byte Kilometerstand; 0 mit 8 Byte
		const io = Buffer.from([0, 3, 1, 239, 1, 1, 66, 0x36, 0x1a, 1, 16, 0x07, 0x5b, 0xcd, 0x15, 0]);
		return Buffer.concat([gps, io]);
	});
	const body = Buffer.concat([Buffer.from([0x08, records.length]), ...records, Buffer.from([records.length])]);
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 4);
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE(crc16(body));
	return Buffer.concat([head, body, tail]);
}

const login = (imei: string) => Buffer.concat([Buffer.from([0, imei.length]), Buffer.from(imei)]);

/** Ein simulierter Tracker: schreibt und wartet auf die nächsten n Bytes Antwort */
class Device {
	socket: Socket;
	received = Buffer.alloc(0);
	closed = false;
	constructor() {
		this.socket = connect(port, '127.0.0.1');
		this.socket.on('data', (d) => (this.received = Buffer.concat([this.received, d])));
		this.socket.on('close', () => (this.closed = true));
		this.socket.on('error', () => (this.closed = true));
	}
	async answer(n: number): Promise<Buffer> {
		await vi.waitFor(() => expect(this.received.length).toBeGreaterThanOrEqual(n), { timeout: 3000, interval: 10 });
		const out = this.received.subarray(0, n);
		this.received = this.received.subarray(n);
		return out;
	}
	waitClosed = () => vi.waitFor(() => expect(this.closed).toBe(true), { timeout: 3000, interval: 10 });
	end = () => this.socket.destroy();
}

const stored = (vehicleId: number) => db.select().from(vehiclePositions).where(eq(vehiclePositions.vehicleId, vehicleId)).all();
const NOW = Date.now() - 3_600_000;

describe('Teltonika – Empfang', () => {
	it('nimmt einen eingetragenen Tracker an, speichert und quittiert erst danach', async () => {
		const d = new Device();
		d.socket.write(login(IMEI));
		expect((await d.answer(1))[0]).toBe(1);
		d.socket.write(
			packet([
				{ at: NOW, lat: 48.3608, lon: 16.4925, kmh: 72 },
				{ at: NOW + 10_000, lat: 48.362, lon: 16.4925, kmh: 72 }
			])
		);
		expect((await d.answer(4)).readUInt32BE()).toBe(2);
		d.end();

		const rows = await stored(id);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ source: 'teltonika', lat: 48.3608, speed: 20, heading: 90 });
		const v = (await getVehicle(id))!;
		expect(v).toMatchObject({ lastLat: 48.362, ignition: true, voltage: 13.9, odometerKm: 123_456.8 });
		expect(v.trackerSeenAt).toBeInstanceOf(Date);
		expect(v.lastSeenAt).toBeInstanceOf(Date);
	});

	it('kommt auch mit Paketen zurecht, die zerstückelt oder aneinander ankommen', async () => {
		const d = new Device();
		const first = packet([{ at: NOW + 20_000, lat: 48.363, lon: 16.4925, kmh: 50 }]);
		const second = packet([{ at: NOW + 30_000, lat: 48.364, lon: 16.4925, kmh: 50 }]);
		const all = Buffer.concat([login(IMEI), first, second]);
		// In drei Stücken, die Grenzen liegen mitten in den Paketen
		d.socket.write(all.subarray(0, 9));
		await new Promise((r) => setTimeout(r, 20));
		d.socket.write(all.subarray(9, 40));
		await new Promise((r) => setTimeout(r, 20));
		d.socket.write(all.subarray(40));
		expect((await d.answer(1))[0]).toBe(1);
		expect((await d.answer(4)).readUInt32BE()).toBe(1);
		expect((await d.answer(4)).readUInt32BE()).toBe(1);
		d.end();
		expect(await stored(id)).toHaveLength(4);
	});

	it('ohne GPS-Empfang: quittiert, aber kein Standort – der Zustand zählt trotzdem', async () => {
		const d = new Device();
		d.socket.write(login(IMEI));
		await d.answer(1);
		d.socket.write(packet([{ at: NOW + 40_000, lat: 0, lon: 0, kmh: 0, satellites: 0 }]));
		expect((await d.answer(4)).readUInt32BE()).toBe(1);
		d.end();
		expect(await stored(id)).toHaveLength(4);
	});

	it('lehnt unbekannte Tracker ab', async () => {
		const d = new Device();
		d.socket.write(login(OTHER_IMEI));
		expect((await d.answer(1))[0]).toBe(0);
		await d.waitClosed();
	});

	it('wirft raus, was kein Tracker ist', async () => {
		const web = new Device();
		web.socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
		await web.waitClosed();
		expect(web.received.length).toBe(0);
	});

	it('beschädigtes Paket: keine Quittung, nichts gespeichert, der Tracker schickt es neu', async () => {
		const before = (await stored(id)).length;
		const d = new Device();
		d.socket.write(login(IMEI));
		await d.answer(1);
		const bad = packet([{ at: NOW + 50_000, lat: 48.37, lon: 16.5, kmh: 40 }]);
		bad[20] ^= 0xff;
		d.socket.write(bad);
		await d.waitClosed();
		expect(d.received.length).toBe(0);
		expect(await stored(id)).toHaveLength(before);
	});
});

describe('Ortung je Fahrzeug', () => {
	it('nur App: der Tracker wird quittiert, zählt aber nicht', async () => {
		const appOnly = await createVehicle({ name: 'Nur App', plate: '', kind: 'pkw', tracking: 'app', trackerImei: OTHER_IMEI, driverId: null, partyId: null, note: '', active: true });
		const d = new Device();
		d.socket.write(login(OTHER_IMEI));
		await d.answer(1);
		d.socket.write(packet([{ at: NOW, lat: 48.1, lon: 16.1, kmh: 30 }]));
		expect((await d.answer(4)).readUInt32BE()).toBe(1);
		d.end();
		expect(await stored(appOnly)).toEqual([]);
		expect((await getVehicle(appOnly))?.trackerSeenAt).toBeNull();
	});

	it('nur Tracker: das Tablet zählt nicht', async () => {
		const vehicle = (await vehicleByImei(IMEI))!;
		const before = await getVehicle(id);
		const counted = await recordPositions(vehicle, [{ t: NOW + 60_000, lat: 47, lon: 15 }], { battery: 50, charging: true });
		expect(counted).toBe(false);
		const after = await getVehicle(id);
		expect(after).toMatchObject({ lastLat: before?.lastLat, battery: before?.battery });
	});

	it('beides: der Tracker führt, das Tablet springt ein, wenn er schweigt', async () => {
		const both = await createVehicle({ name: 'Beides', plate: '', kind: 'pkw', tracking: 'beide', trackerImei: null, driverId: null, partyId: null, note: '', active: true });
		const now = Date.now();
		const row = async () => (await db.select().from(vehicles).where(eq(vehicles.id, both)).get())!;

		await recordPositions(await row(), [{ t: now - 1000, lat: 48.1, lon: 16.1, spd: 10 }], { battery: null, charging: null }, 'teltonika');
		expect((await row()).lastLat).toBe(48.1);
		// Tracker meldet sich gerade: Das Tablet speichert, bewegt die Karte aber nicht
		await recordPositions(await row(), [{ t: now, lat: 48.2, lon: 16.2 }], { battery: 80, charging: true });
		expect(await row()).toMatchObject({ lastLat: 48.1, battery: 80 });

		// Tracker seit 20 Minuten still: Jetzt übernimmt das Tablet
		await db.update(vehicles).set({ trackerSeenAt: new Date(now - 20 * 60_000) }).where(eq(vehicles.id, both));
		await recordPositions(await row(), [{ t: now + 1000, lat: 48.3, lon: 16.3 }], { battery: null, charging: null });
		expect((await row()).lastLat).toBe(48.3);

		// Im Verlauf bleibt vom Tablet nur, was der Tracker nicht hat
		const points = await rangePoints(both, now - 60_000, now + 60_000);
		expect(points.map((p) => p.lat)).toEqual([48.1]);
	});

	it('Verlauf: Lücken des Trackers füllt das Tablet, Überschneidungen nicht', () => {
		const MIN = 60_000;
		const p = (min: number, source: 'app' | 'teltonika') => ({ at: min * MIN, source });
		const mixed = [p(0, 'app'), p(1, 'teltonika'), p(1.5, 'app'), p(10, 'app'), p(20, 'teltonika'), p(30, 'app')];
		expect(preferTracker(mixed).map((x) => x.at / MIN)).toEqual([1, 10, 20, 30]);
		// Nur eine Quelle: alles bleibt
		const only = [p(0, 'app'), p(1, 'app')];
		expect(preferTracker(only)).toEqual(only);
	});

	it('kennt die Quellen je Einstellung', () => {
		expect(usesSource('app', 'app')).toBe(true);
		expect(usesSource('app', 'teltonika')).toBe(false);
		expect(usesSource('teltonika', 'app')).toBe(false);
		expect(usesSource('beide', 'app')).toBe(true);
		expect(usesSource('beide', 'teltonika')).toBe(true);
	});
});

describe('Fahrzeug bearbeiten', () => {
	const form = (fields: Record<string, string>) => {
		const f = new FormData();
		f.set('name', 'Bus');
		for (const [k, v] of Object.entries(fields)) f.set(k, v);
		return f;
	};

	it('prüft die IMEI – Tippfehler fallen über die Prüfziffer auf', () => {
		expect(validImei(IMEI)).toBe(true);
		expect(validImei('356307042441014')).toBe(false);
		expect(validImei('35630704244101')).toBe(false);
		expect(readVehicle(form({ ortung: 'teltonika', imei: '356 307 042 441 013' }))).toMatchObject({ tracking: 'teltonika', trackerImei: IMEI });
		expect(readVehicle(form({ ortung: 'beide', imei: '' }))).toHaveProperty('message');
		expect(readVehicle(form({ ortung: 'teltonika', imei: '123' }))).toHaveProperty('message');
	});

	it('ohne Angabe bleibt es bei der App, die IMEI darf trotzdem stehen bleiben', () => {
		expect(readVehicle(form({}))).toMatchObject({ tracking: 'app', trackerImei: null });
		expect(readVehicle(form({ ortung: 'quatsch', imei: IMEI }))).toMatchObject({ tracking: 'app', trackerImei: IMEI });
	});

	it('eine IMEI gehört zu einem Fahrzeug', async () => {
		expect(await imeiTaken(IMEI, null)).toBe(true);
		expect(await imeiTaken(IMEI, id)).toBe(false);
		expect(await imeiTaken('358240051111110', null)).toBe(false);
	});
});
