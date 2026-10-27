/**
 * Fuhrpark – das Rechnen: Entfernung zwischen Standorten, gefahrene Kilometer
 * und Standzeiten eines Tages, und ob ein Auto gerade fährt, steht oder sich
 * nicht meldet. Alles ohne Datenbank, damit es sich prüfen lässt.
 */
import { viennaTime } from '$lib/weather';

export interface TrackPoint {
	at: number;
	lat: number;
	lon: number;
	speed: number | null;
	accuracy: number | null;
}

export interface Stop {
	from: number;
	to: number;
	lat: number;
	lon: number;
	minutes: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Entfernung in Metern (Großkreis) */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const dLat = rad(b.lat - a.lat);
	const dLon = rad(b.lon - a.lon);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ungenauer als das zählt nicht für die Kilometer */
const MAX_ACCURACY = 100;
/** Schneller als das (m/s, rund 250 km/h) ist ein Ausreißer */
const MAX_SPEED = 70;
/** Innerhalb dieses Umkreises gilt das Auto als stehend … */
const STOP_RADIUS = 100;
/** … und ab so lange ist es eine Standzeit */
const STOP_MINUTES = 5;

/** Genauer als das (m) muss ein Standort sein, damit er in den Verlauf kommt */
export const GOOD_ACCURACY = 50;

/**
 * Den Verlauf glätten. Ohne freien Himmel (Halle, Garage, Tiefgarage) schätzt
 * das Tablet den Standort über WLAN und Funkmasten – jede Schätzung liegt ein
 * paar Dutzend Meter daneben, einzelne viel weiter. Roh verbunden wird daraus
 * ein Stern mit „Fahrten" ins Nichts. Darum:
 * 1. ungenaue Standorte (über 50 m) fallen weg,
 * 2. ein Sprung hin und gleich wieder zurück fällt weg,
 * 3. wer nicht fährt und innerhalb der Ungenauigkeit bleibt, bleibt am selben
 *    Ort – die Zeit läuft weiter (für die Standzeit), die Lage nicht.
 */
export function smoothTrack(points: readonly TrackPoint[]): TrackPoint[] {
	const good = points.filter((p) => p.accuracy == null || p.accuracy <= GOOD_ACCURACY);
	const noSpikes = good.filter((p, i) => {
		const a = good[i - 1];
		const c = good[i + 1];
		if (!a || !c || (p.speed ?? 0) > 3) return true;
		const ab = distance(a, p);
		const bc = distance(p, c);
		return !(ab > 40 && bc > 40 && distance(a, c) < Math.min(ab, bc) / 2);
	});
	const out: TrackPoint[] = [];
	/** Der Ort, an dem das Auto gerade steht: die Mitte der Punkte dort */
	let place: { lat: number; lon: number; n: number; accuracy: number | null; index: number } | null = null;
	for (const p of noSpikes) {
		if (!place) {
			out.push(p);
			place = { lat: p.lat, lon: p.lon, n: 1, accuracy: p.accuracy, index: out.length - 1 };
			continue;
		}
		const d = distance(place, p);
		const seconds = (p.at - out[out.length - 1].at) / 1000;
		if (seconds > 0 && d / seconds > MAX_SPEED) continue;
		// Spielraum: beide Ungenauigkeiten und etwas dazu, höchstens 100 m
		const radius = Math.min(100, Math.max(40, (place.accuracy ?? 15) + (p.accuracy ?? 15) + 20));
		if ((p.speed ?? 0) <= 2 && d <= radius) {
			place.lat = (place.lat * place.n + p.lat) / (place.n + 1);
			place.lon = (place.lon * place.n + p.lon) / (place.n + 1);
			place.n++;
			// Der Ort rückt in die Mitte; ein zweiter Punkt hält die Zeit fest
			const first = out[place.index];
			out[place.index] = { ...first, lat: place.lat, lon: place.lon };
			const hold = { ...first, lat: place.lat, lon: place.lon, at: p.at };
			if (out.length - 1 > place.index) out[out.length - 1] = hold;
			else out.push(hold);
			continue;
		}
		out.push(p);
		place = { lat: p.lat, lon: p.lon, n: 1, accuracy: p.accuracy, index: out.length - 1 };
	}
	return out;
}

/** Gefahrene Kilometer – ungenaue Punkte und Sprünge zählen nicht */
export function kilometers(points: readonly TrackPoint[]): number {
	let meters = 0;
	let prev: TrackPoint | null = null;
	for (const p of points) {
		if (p.accuracy != null && p.accuracy > MAX_ACCURACY) continue;
		if (prev) {
			const d = distance(prev, p);
			const seconds = (p.at - prev.at) / 1000;
			if (seconds > 0 && d / seconds <= MAX_SPEED) meters += d;
		}
		prev = p;
	}
	return Math.round(meters / 100) / 10;
}

/**
 * Standzeiten: Folgen von Punkten im Umkreis von 100 m um den ersten, die
 * mindestens 5 Minuten umfassen. Weil das Tablet im Stehen kaum neue Punkte
 * schickt, reicht dafür auch eine Lücke zwischen zwei nahen Punkten.
 */
export function stops(points: readonly TrackPoint[]): Stop[] {
	const out: Stop[] = [];
	let i = 0;
	while (i < points.length) {
		const anchor = points[i];
		let j = i;
		while (j + 1 < points.length && distance(anchor, points[j + 1]) <= STOP_RADIUS) j++;
		const minutes = (points[j].at - anchor.at) / 60_000;
		if (minutes >= STOP_MINUTES) {
			const group = points.slice(i, j + 1);
			out.push({
				from: anchor.at,
				to: points[j].at,
				lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
				lon: group.reduce((s, p) => s + p.lon, 0) / group.length,
				minutes: Math.round(minutes)
			});
		}
		i = j + 1;
	}
	return out;
}

export type VehicleState = 'faehrt' | 'steht' | 'offline' | 'nie';

/** Ein Auto auf der Karte */
export interface MapVehicle {
	id: number;
	name: string;
	lat: number;
	lon: number;
	state: VehicleState;
	heading: number | null;
	href: string;
}

/**
 * Fährt (letzter Standort jünger als 5 Minuten, schneller als Schritttempo),
 * steht (das Tablet hat sich in der letzten halben Stunde gemeldet), offline
 * (länger nichts) – oder hat noch nie etwas geschickt.
 */
export function vehicleState(v: { lastAt: Date | number | null; lastSeenAt: Date | number | null; lastSpeed: number | null }, now = Date.now()): VehicleState {
	const ms = (d: Date | number | null) => (d == null ? null : typeof d === 'number' ? d : d.getTime());
	const at = ms(v.lastAt);
	const seen = Math.max(ms(v.lastSeenAt) ?? 0, at ?? 0);
	if (!seen) return 'nie';
	if (at != null && now - at < 5 * 60_000 && (v.lastSpeed ?? 0) > 1.5) return 'faehrt';
	if (now - seen < 30 * 60_000) return 'steht';
	return 'offline';
}

/** Beginn eines Tages „JJJJ-MM-TT" in Wien (ms) – Sommer- wie Winterzeit */
export function viennaDayStart(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	for (const offset of [1, 2]) {
		const t = Date.UTC(y, m - 1, d) - offset * 3_600_000;
		const v = viennaTime(new Date(t));
		if (v.date === date && v.hour === 0) return t;
	}
	return Date.UTC(y, m - 1, d) - 3_600_000;
}
