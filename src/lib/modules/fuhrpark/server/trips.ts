/**
 * Fahrten und Standzeiten aus den Standorten: für den Verlauf eines Autos, das
 * Fahrtenbuch und die Statistik. Gerechnet wird nicht je Kalendertag, sondern
 * über den Zeitraum und einen Tag Rand zu beiden Seiten – was über Mitternacht
 * geht, bleibt so eine Fahrt.
 */
import { overlapping, placeAt, segments, smoothTrack, viennaDayStart, WALK_SPEED, type FleetPlace, type LatLon, type Segment, type TrackPoint, type Trip } from '../track';
import { addDays, isValidIsoDate } from '$lib/modules/stunden/week';
import { viennaTime } from '$lib/weather';
import { addressesFor, addressesPending, addressKey } from './addresses';
import { driverAt, driverHistory, rangePoints, type VehicleRow } from './vehicles';

const DAY_MS = 86_400_000;

/** Längster Zeitraum auf einmal – Fahrtenbuch und Statistik */
export const MAX_RANGE_DAYS = 31;

export interface VehicleTrack {
	points: TrackPoint[];
	segments: Segment[];
}

/** Geglätteter Verlauf um den Zeitraum herum, in Fahrten und Standzeiten geteilt */
export async function vehicleTrack(vehicle: Pick<VehicleRow, 'id' | 'lastSeenAt'>, from: number, to: number): Promise<VehicleTrack> {
	const raw = await rangePoints(vehicle.id, from - DAY_MS, to + DAY_MS);
	const points = smoothTrack(raw);
	// Das Tablet meldet sich, schickt im Stehen aber keine neuen Punkte: Die Standzeit läuft bis jetzt
	const last = points[points.length - 1];
	const seen = vehicle.lastSeenAt?.getTime() ?? 0;
	if (last && seen > last.at && (raw[raw.length - 1].speed ?? 0) <= WALK_SPEED) points.push({ ...last, at: seen });
	return { points, segments: segments(points) };
}

/** Beginn des ersten und Ende des letzten Tages (Wiener Zeit) */
export const dayRange = (fromDate: string, toDate: string) => ({ from: viennaDayStart(fromDate), to: viennaDayStart(addDays(toDate, 1)) });

/** Name des festen Orts, sonst die Anschrift – leer, solange sie nicht bekannt ist */
export function labelOf(p: LatLon, places: readonly FleetPlace[], addresses: Map<string, string>): { place: string | null; label: string } {
	const place = placeAt(p, places);
	return { place: place?.name ?? null, label: place?.name ?? addresses.get(addressKey(p)) ?? '' };
}

/** Standorte, zu denen eine Anschrift gebraucht wird – nur, wo kein fester Ort ist */
const needsAddress = (points: LatLon[], places: readonly FleetPlace[]) => points.filter((p) => !placeAt(p, places));

/** Ein Tag eines Autos: alles, was hineinfällt – Fahrten und Standzeiten über Mitternacht ganz */
export async function dayView(vehicle: Pick<VehicleRow, 'id' | 'lastSeenAt'>, date: string, places: readonly FleetPlace[]) {
	const { from, to } = dayRange(date, date);
	const track = await vehicleTrack(vehicle, from, to);
	const parts = overlapping(track.segments, from, to);
	const ends = parts.flatMap((s) => (s.kind === 'stopp' ? [s] : [s.start, s.end]));
	const addresses = await addressesFor(needsAddress(ends, places), 2500);
	const label = (p: LatLon) => labelOf(p, places, addresses);
	let number = 0;
	const items = parts.map((s) =>
		s.kind === 'stopp' ? { ...s, number: ++number, where: label(s) } : { ...s, startWhere: label(s.start), endWhere: label(s.end) }
	);
	const first = parts[0]?.from ?? from;
	const last = parts[parts.length - 1]?.to ?? to;
	return { items, track: track.points.filter((p) => p.at >= first && p.at <= last), pending: addressesPending() };
}

export interface LogbookEntry {
	key: string;
	vehicleId: number;
	vehicleName: string;
	plate: string;
	driver: string;
	from: number;
	to: number;
	km: number;
	start: string;
	end: string;
}

/**
 * Fahrtenbuch: die Fahrten, die im Zeitraum beginnen – die neuesten zuerst.
 * Eine Fahrt über Mitternacht steht einmal da, am Tag ihres Beginns.
 */
export async function logbook(vehicles: VehicleRow[], fromDate: string, toDate: string, places: readonly FleetPlace[]) {
	const { from, to } = dayRange(fromDate, toDate);
	const [history, tracks] = await Promise.all([driverHistory(), Promise.all(vehicles.map((v) => vehicleTrack(v, from, to)))]);
	const found = vehicles.flatMap((v, i) =>
		tracks[i].segments.filter((s): s is Trip => s.kind === 'fahrt' && s.from >= from && s.from < to).map((trip) => ({ vehicle: v, trip }))
	);
	found.sort((a, b) => b.trip.from - a.trip.from);
	const addresses = await addressesFor(needsAddress(found.flatMap((f) => [f.trip.start, f.trip.end]), places), 2500);
	const entries: LogbookEntry[] = found.map(({ vehicle, trip }) => ({
		key: `${vehicle.id}-${trip.from}`,
		vehicleId: vehicle.id,
		vehicleName: vehicle.name,
		plate: vehicle.plate,
		driver: driverAt(history.get(vehicle.id), trip.from),
		from: trip.from,
		to: trip.to,
		km: trip.km,
		start: labelOf(trip.start, places, addresses).label,
		end: labelOf(trip.end, places, addresses).label
	}));
	return { entries, km: Math.round(entries.reduce((s, e) => s + e.km, 0) * 10) / 10, pending: addressesPending() };
}

export interface VehicleStats {
	id: number;
	name: string;
	kind: VehicleRow['kind'];
	km: number;
	/** Fahrzeit in Minuten */
	driving: number;
	trips: number;
	/** Höchste gemeldete Geschwindigkeit in km/h */
	topSpeed: number | null;
}

export interface FleetStats {
	km: number;
	driving: number;
	trips: number;
	vehicles: VehicleStats[];
	days: { date: string; km: number }[];
	/** Besuche an festen Orten: wie oft und wie lange */
	places: { name: string; visits: number; minutes: number }[];
}

/** Zusammenzählen – ohne Datenbank, damit es sich prüfen lässt */
export function summarize(rows: { vehicle: Pick<VehicleRow, 'id' | 'name' | 'kind'>; segments: Segment[] }[], from: number, to: number, places: readonly FleetPlace[]): FleetStats {
	const days = new Map<string, number>();
	for (let t = from + 12 * 3_600_000; t < to; t += DAY_MS) days.set(viennaTime(new Date(t)).date, 0);
	const atPlaces = new Map<string, { visits: number; minutes: number }>();
	const vehicles = rows.map(({ vehicle, segments: parts }): VehicleStats => {
		const stats: VehicleStats = { id: vehicle.id, name: vehicle.name, kind: vehicle.kind, km: 0, driving: 0, trips: 0, topSpeed: null };
		for (const s of parts) {
			if (s.kind === 'fahrt') {
				// Zählt am Tag, an dem die Fahrt beginnt – wie im Fahrtenbuch
				if (s.from < from || s.from >= to) continue;
				stats.km += s.km;
				stats.driving += (s.to - s.from) / 60_000;
				stats.trips++;
				if (s.maxSpeed != null) stats.topSpeed = Math.max(stats.topSpeed ?? 0, Math.round(s.maxSpeed * 3.6));
				const day = viennaTime(new Date(s.from)).date;
				days.set(day, (days.get(day) ?? 0) + s.km);
			} else {
				const place = placeAt(s, places);
				const minutes = (Math.min(s.to, to) - Math.max(s.from, from)) / 60_000;
				if (!place || minutes <= 0) continue;
				const visit = atPlaces.get(place.name) ?? { visits: 0, minutes: 0 };
				visit.visits++;
				visit.minutes += minutes;
				atPlaces.set(place.name, visit);
			}
		}
		return { ...stats, km: Math.round(stats.km * 10) / 10, driving: Math.round(stats.driving) };
	});
	return {
		km: Math.round(vehicles.reduce((s, v) => s + v.km, 0) * 10) / 10,
		driving: vehicles.reduce((s, v) => s + v.driving, 0),
		trips: vehicles.reduce((s, v) => s + v.trips, 0),
		vehicles: vehicles.sort((a, b) => b.km - a.km),
		days: [...days].map(([date, km]) => ({ date, km: Math.round(km * 10) / 10 })),
		places: [...atPlaces].map(([name, v]) => ({ name, visits: v.visits, minutes: Math.round(v.minutes) })).sort((a, b) => b.minutes - a.minutes)
	};
}

export async function fleetStats(vehicles: VehicleRow[], fromDate: string, toDate: string, places: readonly FleetPlace[]): Promise<FleetStats> {
	const { from, to } = dayRange(fromDate, toDate);
	const tracks = await Promise.all(vehicles.map((v) => vehicleTrack(v, from, to)));
	return summarize(
		vehicles.map((vehicle, i) => ({ vehicle, segments: tracks[i].segments })),
		from,
		to,
		places
	);
}

/** Zeitraum aus der Adresse: gültige Tage, nicht in der Zukunft, nicht älter als gespeichert, höchstens 31 Tage */
export function readRange(url: URL, days: number, keepDays: number) {
	const today = viennaTime(new Date()).date;
	const oldest = addDays(today, -keepDays);
	const day = (name: string, fallback: string) => {
		const v = url.searchParams.get(name) ?? '';
		return isValidIsoDate(v) && v <= today && v >= oldest ? v : fallback;
	};
	const to = day('bis', today);
	let from = day('von', addDays(to, 1 - days));
	if (from > to) from = to;
	if (from < addDays(to, 1 - MAX_RANGE_DAYS)) from = addDays(to, 1 - MAX_RANGE_DAYS);
	return { from: from < oldest ? oldest : from, to, today, oldest };
}
