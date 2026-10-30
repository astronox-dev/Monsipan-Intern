/**
 * Fuhrpark: Fahrzeuge anlegen, Tablets koppeln, Standorte annehmen.
 *
 * Koppeln: Im Portal bekommt ein Fahrzeug einen Code (8 Zeichen, 30 Minuten
 * gültig). Die App „Monsipan Fahrzeug" tauscht ihn einmal gegen einen eigenen
 * Schlüssel; gespeichert wird von beiden nur die Prüfsumme. Mit dem Schlüssel
 * schickt das Tablet seine Standorte – gesammelt, auch nachträglich, wenn es
 * eine Weile kein Netz hatte. Entkoppeln macht den Schlüssel ungültig.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { fullName } from '$lib/format';
import { db } from '$lib/server/db';
import { broadcast } from '$lib/server/events';
import { parties, users, VEHICLE_KINDS, vehicleDrivers, vehiclePositions, vehicles, type VehicleKind } from '$lib/server/db/schema';
import { addDays } from '$lib/modules/stunden/week';
import { GOOD_ACCURACY, viennaDayStart, WALK_SPEED, type TrackPoint } from '../track';
import { purgeOldAddresses } from './addresses';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Ohne Zeichen, die man verwechselt (0/O, 1/I/L) */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PAIR_MINUTES = 30;
/** So lange bleiben Standorte gespeichert */
export const KEEP_DAYS = 90;

/** Code so, wie man ihn eintippt: Groß, ohne Bindestrich und Leerzeichen */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function listVehicles() {
	return db
		.select({
			id: vehicles.id,
			name: vehicles.name,
			plate: vehicles.plate,
			kind: vehicles.kind,
			driverId: vehicles.driverId,
			driverFirst: users.firstName,
			driverLast: users.lastName,
			partyId: vehicles.partyId,
			partyName: parties.name,
			note: vehicles.note,
			active: vehicles.active,
			paired: sql<boolean>`${vehicles.deviceTokenHash} is not null`.mapWith(Boolean),
			deviceName: vehicles.deviceName,
			pairedAt: vehicles.pairedAt,
			pairing: sql<boolean>`${vehicles.pairCodeHash} is not null and ${vehicles.pairCodeExpires} > ${Date.now()}`.mapWith(Boolean),
			lastSeenAt: vehicles.lastSeenAt,
			lastAt: vehicles.lastAt,
			lastLat: vehicles.lastLat,
			lastLon: vehicles.lastLon,
			lastSpeed: vehicles.lastSpeed,
			lastHeading: vehicles.lastHeading,
			battery: vehicles.battery,
			charging: vehicles.charging
		})
		.from(vehicles)
		.leftJoin(parties, eq(parties.id, vehicles.partyId))
		.leftJoin(users, eq(users.id, vehicles.driverId))
		.orderBy(asc(vehicles.name))
		.all();
}

export type VehicleRow = Awaited<ReturnType<typeof listVehicles>>[number];

export async function getVehicle(id: number) {
	return (await listVehicles()).find((v) => v.id === id) ?? null;
}

/** Zur Auswahl als Fahrer: alle aktiven Personen */
export async function driverOptions() {
	const rows = await db
		.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username })
		.from(users)
		.where(and(eq(users.active, true), isNull(users.deletedAt)))
		.all();
	return rows.map((u) => ({ id: u.id, name: fullName(u) })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export interface VehicleInput {
	name: string;
	plate: string;
	kind: VehicleKind;
	driverId: number | null;
	partyId: number | null;
	note: string;
	active: boolean;
}

export function readVehicle(form: FormData): VehicleInput | { message: string } {
	const s = (k: string) => String(form.get(k) ?? '').trim();
	const name = s('name').slice(0, 80);
	if (!name) return { message: 'Bitte einen Namen für das Fahrzeug eintragen.' };
	const party = Number(form.get('partie'));
	const driver = Number(form.get('fahrer'));
	const kind = s('art') as VehicleKind;
	return {
		name,
		plate: s('kennzeichen').toUpperCase().slice(0, 20),
		kind: VEHICLE_KINDS.includes(kind) ? kind : 'transporter',
		driverId: Number.isInteger(driver) && driver > 0 ? driver : null,
		partyId: Number.isInteger(party) && party > 0 ? party : null,
		note: s('notiz').slice(0, 500),
		active: form.get('ausblenden') !== 'on'
	};
}

/** Fahrerwechsel festhalten – mit Namen, damit das Fahrtenbuch stimmt, auch wenn das Konto später weg ist */
async function logDriver(vehicleId: number, driverId: number | null, since = new Date()) {
	const person = driverId ? await db.select().from(users).where(eq(users.id, driverId)).get() : null;
	await db.insert(vehicleDrivers).values({ vehicleId, driverId, driverName: person ? fullName(person) : '', since });
}

export async function createVehicle(input: VehicleInput): Promise<number> {
	const row = await db
		.insert(vehicles)
		.values({ ...input, updatedAt: new Date() })
		.returning({ id: vehicles.id })
		.get();
	if (input.driverId) await logDriver(row.id, input.driverId);
	return row.id;
}

export async function updateVehicle(id: number, input: VehicleInput) {
	const before = await db.select({ driverId: vehicles.driverId }).from(vehicles).where(eq(vehicles.id, id)).get();
	await db
		.update(vehicles)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(vehicles.id, id));
	if (before && before.driverId !== input.driverId) await logDriver(id, input.driverId);
}

/** Wer wann gefahren ist – je Fahrzeug, die Wechsel in zeitlicher Folge */
export async function driverHistory(): Promise<Map<number, { since: number; name: string }[]>> {
	const rows = await db.select().from(vehicleDrivers).orderBy(asc(vehicleDrivers.since), asc(vehicleDrivers.id)).all();
	const out = new Map<number, { since: number; name: string }[]>();
	for (const r of rows) {
		const list = out.get(r.vehicleId) ?? [];
		list.push({ since: r.since.getTime(), name: r.driverName });
		out.set(r.vehicleId, list);
	}
	return out;
}

/** Der Fahrer zu einem Zeitpunkt – vor dem ersten Eintrag niemand */
export function driverAt(history: { since: number; name: string }[] | undefined, at: number): string {
	return history?.findLast((h) => h.since <= at)?.name ?? '';
}

/** Löschen nimmt alle Standorte des Fahrzeugs mit */
export async function deleteVehicle(id: number) {
	await db.delete(vehicles).where(eq(vehicles.id, id));
}

/** Neuer Kopplungscode – ein früher gekoppeltes Tablet bleibt bis zum Koppeln des neuen gültig */
export async function startPairing(id: number): Promise<{ code: string; expires: Date }> {
	const bytes = randomBytes(8);
	const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
	const expires = new Date(Date.now() + PAIR_MINUTES * 60_000);
	await db.update(vehicles).set({ pairCodeHash: sha256(code), pairCodeExpires: expires, updatedAt: new Date() }).where(eq(vehicles.id, id));
	return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expires };
}

/** Das Tablet löst den Code ein und bekommt seinen Schlüssel – null, wenn der Code nicht (mehr) gilt */
export async function pairDevice(code: string, deviceName: string): Promise<{ token: string; vehicle: { id: number; name: string } } | null> {
	const clean = normalizeCode(code);
	if (clean.length !== 8) return null;
	const vehicle = await db
		.select({ id: vehicles.id, name: vehicles.name, expires: vehicles.pairCodeExpires, active: vehicles.active })
		.from(vehicles)
		.where(eq(vehicles.pairCodeHash, sha256(clean)))
		.get();
	if (!vehicle || !vehicle.active || !vehicle.expires || vehicle.expires.getTime() < Date.now()) return null;
	const token = randomBytes(32).toString('base64url');
	await db
		.update(vehicles)
		.set({
			deviceTokenHash: sha256(token),
			deviceName: deviceName.slice(0, 80),
			pairedAt: new Date(),
			pairCodeHash: null,
			pairCodeExpires: null,
			updatedAt: new Date()
		})
		.where(eq(vehicles.id, vehicle.id));
	return { token, vehicle: { id: vehicle.id, name: vehicle.name } };
}

/** Tablet entkoppeln – es bekommt beim nächsten Senden „nicht berechtigt" und hört auf */
export async function unpair(id: number) {
	await db
		.update(vehicles)
		.set({ deviceTokenHash: null, deviceName: '', pairedAt: null, pairCodeHash: null, pairCodeExpires: null, updatedAt: new Date() })
		.where(eq(vehicles.id, id));
}

export async function vehicleByToken(token: string) {
	if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
	return (
		(await db
			.select({ id: vehicles.id, name: vehicles.name, active: vehicles.active, lastAt: vehicles.lastAt })
			.from(vehicles)
			.where(eq(vehicles.deviceTokenHash, sha256(token)))
			.get()) ?? null
	);
}

export interface PositionInput {
	t: number;
	lat: number;
	lon: number;
	spd?: number | null;
	hdg?: number | null;
	acc?: number | null;
}

/** Höchstens so viele Standorte je Sendung */
export const MAX_BATCH = 500;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Standorte prüfen: gültige Lage, Zeit nicht weiter als 7 Tage zurück und
 * nicht in der Zukunft, Genauigkeit bis 1 km. Der Rest fällt still weg.
 */
export function cleanPositions(raw: unknown, now = Date.now()): PositionInput[] {
	if (!Array.isArray(raw)) return [];
	const out: PositionInput[] = [];
	for (const p of raw.slice(0, MAX_BATCH)) {
		if (!p || typeof p !== 'object') continue;
		const r = p as Record<string, unknown>;
		const t = num(r.t);
		const lat = num(r.lat);
		const lon = num(r.lon);
		const acc = num(r.acc);
		if (t == null || lat == null || lon == null) continue;
		if (t < now - 7 * 86_400_000 || t > now + 5 * 60_000) continue;
		if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
		if (acc != null && acc > 1000) continue;
		const spd = num(r.spd);
		const hdg = num(r.hdg);
		out.push({ t: Math.round(t), lat, lon, spd: spd != null && spd >= 0 ? spd : null, hdg: hdg != null && hdg >= 0 && hdg <= 360 ? hdg : null, acc });
	}
	return out.sort((a, b) => a.t - b.t);
}

/** Eine Sendung des Tablets: Standorte speichern, das Fahrzeug als gemeldet markieren */
export async function recordPositions(vehicle: { id: number; lastAt: Date | null }, positions: PositionInput[], status: { battery: number | null; charging: boolean | null }) {
	const now = new Date();
	await db.transaction(async (tx) => {
		if (positions.length) {
			await tx.insert(vehiclePositions).values(
				positions.map((p) => ({ vehicleId: vehicle.id, at: new Date(p.t), lat: p.lat, lon: p.lon, speed: p.spd ?? null, heading: p.hdg ?? null, accuracy: p.acc ?? null }))
			);
		}
		// Für die Live-Karte nur ein genauer Standort – sonst springt das Auto im Stehen herum
		const newest = positions.findLast((p) => p.acc == null || p.acc <= GOOD_ACCURACY);
		const fresher = newest && (!vehicle.lastAt || newest.t >= vehicle.lastAt.getTime());
		await tx
			.update(vehicles)
			.set({
				lastSeenAt: now,
				...(status.battery != null ? { battery: Math.max(0, Math.min(100, Math.round(status.battery))) } : {}),
				...(status.charging != null ? { charging: status.charging } : {}),
				...(fresher
					? {
							lastAt: new Date(newest.t),
							lastLat: newest.lat,
							lastLon: newest.lon,
							lastSpeed: newest.spd ?? null,
							lastHeading: newest.hdg ?? null,
							lastAccuracy: newest.acc ?? null
						}
					: {})
			})
			.where(eq(vehicles.id, vehicle.id));
	});
	// Offene Karten laden neu – mitgeschickt wird nur die Nummer, die Lage holt jeder mit seinem Recht
	if (positions.length) broadcast('fahrzeuge', { id: vehicle.id });
}

/**
 * Standorte eines Zeitraums, dazu der letzte davor und der erste danach: Wer
 * das Wochenende am Lager steht, schickt keine Punkte – so hat die Standzeit
 * trotzdem Anfang und Ende.
 */
export async function rangePoints(vehicleId: number, from: number, to: number): Promise<TrackPoint[]> {
	const columns = { at: vehiclePositions.at, lat: vehiclePositions.lat, lon: vehiclePositions.lon, speed: vehiclePositions.speed, accuracy: vehiclePositions.accuracy };
	const good = sql`(${vehiclePositions.accuracy} is null or ${vehiclePositions.accuracy} <= ${GOOD_ACCURACY})`;
	const [before, rows, after] = await Promise.all([
		db
			.select(columns)
			.from(vehiclePositions)
			.where(and(eq(vehiclePositions.vehicleId, vehicleId), lt(vehiclePositions.at, new Date(from)), good))
			.orderBy(desc(vehiclePositions.at))
			.limit(1)
			.get(),
		db
			.select(columns)
			.from(vehiclePositions)
			.where(and(eq(vehiclePositions.vehicleId, vehicleId), gte(vehiclePositions.at, new Date(from)), lt(vehiclePositions.at, new Date(to))))
			.orderBy(asc(vehiclePositions.at))
			.all(),
		db
			.select(columns)
			.from(vehiclePositions)
			.where(and(eq(vehiclePositions.vehicleId, vehicleId), gte(vehiclePositions.at, new Date(to)), good))
			.orderBy(asc(vehiclePositions.at))
			.limit(1)
			.get()
	]);
	return [...(before ? [before] : []), ...rows, ...(after ? [after] : [])].map((r) => ({ ...r, at: r.at.getTime() }));
}

/** Seit wann ein Auto steht: die letzte Bewegung – im Stehen ist das nur eine Handvoll Punkte zurück */
export async function parkedSince(vehicleId: number): Promise<number | null> {
	const row = await db
		.select({ at: vehiclePositions.at })
		.from(vehiclePositions)
		.where(and(eq(vehiclePositions.vehicleId, vehicleId), gt(vehiclePositions.speed, WALK_SPEED)))
		.orderBy(desc(vehiclePositions.at))
		.limit(1)
		.get();
	return row?.at.getTime() ?? null;
}

/** Die Standorte eines Tages (Wiener Zeit), in zeitlicher Folge */
export async function dayPoints(vehicleId: number, date: string): Promise<TrackPoint[]> {
	const from = viennaDayStart(date);
	const to = viennaDayStart(addDays(date, 1));
	const rows = await db
		.select({ at: vehiclePositions.at, lat: vehiclePositions.lat, lon: vehiclePositions.lon, speed: vehiclePositions.speed, accuracy: vehiclePositions.accuracy })
		.from(vehiclePositions)
		.where(and(eq(vehiclePositions.vehicleId, vehicleId), gte(vehiclePositions.at, new Date(from)), lt(vehiclePositions.at, new Date(to))))
		.orderBy(asc(vehiclePositions.at))
		.all();
	return rows.map((r) => ({ ...r, at: r.at.getTime() }));
}

/** Nächtliche Wartung: Standorte älter als 90 Tage löschen, abgelaufene Codes vergessen */
export async function purgeOldPositions(now = new Date()): Promise<number> {
	const res = await db.delete(vehiclePositions).where(lt(vehiclePositions.at, new Date(now.getTime() - KEEP_DAYS * 86_400_000)));
	await db
		.update(vehicles)
		.set({ pairCodeHash: null, pairCodeExpires: null })
		.where(and(isNotNull(vehicles.pairCodeExpires), lte(vehicles.pairCodeExpires, now)));
	await purgeOldAddresses(now);
	return res.rowsAffected;
}
