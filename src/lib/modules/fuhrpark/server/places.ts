/**
 * Feste Orte: Lager, Firma, Baustellen. Sie stehen mit Namen auf der Karte;
 * steht ein Auto in ihrem Umkreis, zeigen Liste, Verlauf und Fahrtenbuch den
 * Namen statt der Anschrift.
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { fleetPlaces } from '$lib/server/db/schema';

export function listPlaces() {
	return db.select().from(fleetPlaces).orderBy(asc(fleetPlaces.name)).all();
}

export type PlaceRow = Awaited<ReturnType<typeof listPlaces>>[number];

export interface PlaceInput {
	name: string;
	address: string;
	lat: number;
	lon: number;
	radius: number;
}

export function readPlace(form: FormData): PlaceInput | { message: string } {
	const s = (k: string) => String(form.get(k) ?? '').trim();
	const name = s('name').slice(0, 80);
	if (!name) return { message: 'Bitte einen Namen eintragen.' };
	const lat = Number(s('lat'));
	const lon = Number(s('lon'));
	if (!s('lat') || !s('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
		return { message: 'Bitte die Adresse suchen oder den Ort auf der Karte wählen.' };
	}
	const radius = Math.round(Number(s('umkreis')));
	return { name, address: s('adresse').slice(0, 200), lat, lon, radius: Number.isFinite(radius) ? Math.min(2000, Math.max(30, radius)) : 150 };
}

export async function createPlace(input: PlaceInput): Promise<number> {
	const row = await db
		.insert(fleetPlaces)
		.values({ ...input, updatedAt: new Date() })
		.returning({ id: fleetPlaces.id })
		.get();
	return row.id;
}

export async function updatePlace(id: number, input: PlaceInput) {
	await db
		.update(fleetPlaces)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(fleetPlaces.id, id));
}

export async function deletePlace(id: number) {
	await db.delete(fleetPlaces).where(eq(fleetPlaces.id, id));
}
