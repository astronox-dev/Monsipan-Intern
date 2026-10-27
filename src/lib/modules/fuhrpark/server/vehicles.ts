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
import { and, asc, eq, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { parties, vehiclePositions, vehicles } from '$lib/server/db/schema';
import { addDays } from '$lib/modules/stunden/week';
import { viennaDayStart, type TrackPoint } from '../track';

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
		.orderBy(asc(vehicles.name))
		.all();
}

export type VehicleRow = Awaited<ReturnType<typeof listVehicles>>[number];

export async function getVehicle(id: number) {
	return (await listVehicles()).find((v) => v.id === id) ?? null;
}

export interface VehicleInput {
	name: string;
	plate: string;
	partyId: number | null;
	note: string;
	active: boolean;
}

export function readVehicle(form: FormData): VehicleInput | { message: string } {
	const s = (k: string) => String(form.get(k) ?? '').trim();
	const name = s('name').slice(0, 80);
	if (!name) return { message: 'Bitte einen Namen für das Fahrzeug eintragen.' };
	const party = Number(form.get('partie'));
	return {
		name,
		plate: s('kennzeichen').toUpperCase().slice(0, 20),
		partyId: Number.isInteger(party) && party > 0 ? party : null,
		note: s('notiz').slice(0, 500),
		active: form.get('ausblenden') !== 'on'
	};
}

export async function createVehicle(input: VehicleInput): Promise<number> {
	const row = await db
		.insert(vehicles)
		.values({ ...input, updatedAt: new Date() })
		.returning({ id: vehicles.id })
		.get();
	return row.id;
}

export async function updateVehicle(id: number, input: VehicleInput) {
	await db
		.update(vehicles)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(vehicles.id, id));
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
		const newest = positions.at(-1);
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
	return res.rowsAffected;
}
