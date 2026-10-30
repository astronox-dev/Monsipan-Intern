/**
 * Fuhrpark – das Rechnen: Entfernung zwischen Standorten, gefahrene Kilometer,
 * Fahrten und Standzeiten, feste Orte, und ob ein Auto gerade fährt, steht
 * oder sich nicht meldet. Alles ohne Datenbank, damit es sich prüfen lässt.
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
/** … und ab so lange ist es eine Standzeit – kürzer (Ampel, Tanken, kurz ausladen) gehört zur Fahrt */
export const STOP_MINUTES = 10;
/** Kürzer ist keine Fahrt, sondern Umparken */
const MIN_TRIP_KM = 0.2;

/** Genauer als das (m) muss ein Standort sein, damit er in den Verlauf kommt */
export const GOOD_ACCURACY = 50;
/** Bis zu dieser Geschwindigkeit (m/s, rund 10 km/h) ist es Gehen oder Rangieren – keine Fahrt */
export const WALK_SPEED = 2.8;
/** So weit darf man mit dem Tablet zu Fuß vom Abstellort weg (Baustelle), ohne dass es eine Fahrt wird */
const WALK_RADIUS = 300;

/**
 * Den Verlauf glätten. Ohne freien Himmel (Halle, Garage, Tiefgarage) schätzt
 * das Tablet den Standort über WLAN und Funkmasten – jede Schätzung liegt ein
 * paar Dutzend Meter daneben, einzelne viel weiter. Roh verbunden wird daraus
 * ein Stern mit „Fahrten" ins Nichts. Darum:
 * 1. ungenaue Standorte (über 50 m) fallen weg,
 * 2. ein Sprung hin und gleich wieder zurück fällt weg,
 * 3. wer nicht fährt, bleibt am selben Ort – die Zeit läuft weiter (für die
 *    Standzeit), die Lage nicht. Nicht fahren heißt: langsamer als rund
 *    10 km/h und höchstens 300 m vom Abstellort. Damit wird auch, wer mit dem
 *    Tablet über die Baustelle geht, keine Fahrt, sondern eine Standzeit.
 */
export function smoothTrack(points: readonly TrackPoint[]): TrackPoint[] {
	const good = points.filter((p) => p.accuracy == null || p.accuracy <= GOOD_ACCURACY);
	const noSpikes = good.filter((p, i) => {
		const a = good[i - 1];
		const c = good[i + 1];
		if (!a || !c || (p.speed ?? 0) > WALK_SPEED) return true;
		const ab = distance(a, p);
		const bc = distance(p, c);
		return !(ab > 40 && bc > 40 && distance(a, c) < Math.min(ab, bc) / 2);
	});
	const out: TrackPoint[] = [];
	/** Der Ort, an dem das Auto gerade steht: wo es ankam (`start`) und die Mitte der Punkte dort */
	let place: { start: { lat: number; lon: number }; lat: number; lon: number; n: number; index: number } | null = null;
	const newPlace = (p: TrackPoint) => ({ start: { lat: p.lat, lon: p.lon }, lat: p.lat, lon: p.lon, n: 1, index: out.length - 1 });
	for (const p of noSpikes) {
		if (!place) {
			out.push(p);
			place = newPlace(p);
			continue;
		}
		const prev = out[out.length - 1];
		const seconds = (p.at - prev.at) / 1000;
		const step = distance(prev, p);
		if (seconds > 0 && step / seconds > MAX_SPEED) continue;
		// Ohne gemeldete Geschwindigkeit die aus dem Weg seit dem letzten Punkt
		const speed = p.speed ?? (seconds > 0 ? step / seconds : 0);
		if (speed <= WALK_SPEED && distance(place.start, p) <= WALK_RADIUS) {
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
		place = newPlace(p);
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
 * mindestens 10 Minuten umfassen. Weil das Tablet im Stehen kaum neue Punkte
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

export interface LatLon {
	lat: number;
	lon: number;
}

export interface Trip {
	kind: 'fahrt';
	from: number;
	to: number;
	start: LatLon;
	end: LatLon;
	km: number;
	/** Höchste gemeldete Geschwindigkeit in m/s */
	maxSpeed: number | null;
}

export type Segment = Trip | (Stop & { kind: 'stopp' });

/**
 * Den Verlauf in Fahrten und Standzeiten teilen – ohne Schnitt um Mitternacht:
 * Was über den Tageswechsel geht, bleibt eine Fahrt bzw. eine Standzeit. Zwei
 * Standzeiten ohne echte Fahrt dazwischen (nur umgeparkt) werden eine.
 */
export function segments(points: readonly TrackPoint[]): Segment[] {
	if (!points.length) return [];
	const out: Segment[] = [];
	const trip = (from: number, to: number) => {
		const part = points.filter((p) => p.at >= from && p.at <= to);
		if (part.length < 2) return;
		const km = kilometers(part);
		if (km < MIN_TRIP_KM) return;
		const speeds = part.map((p) => p.speed).filter((s): s is number => s != null && s <= MAX_SPEED);
		const last = part[part.length - 1];
		out.push({
			kind: 'fahrt',
			from,
			to,
			start: { lat: part[0].lat, lon: part[0].lon },
			end: { lat: last.lat, lon: last.lon },
			km,
			maxSpeed: speeds.length ? Math.max(...speeds) : null
		});
	};
	const stay = (s: Stop) => {
		const prev = out[out.length - 1];
		if (prev?.kind === 'stopp' && distance(prev, s) <= STOP_RADIUS * 2) {
			const a = prev.minutes || 1;
			const b = s.minutes || 1;
			out[out.length - 1] = {
				kind: 'stopp',
				from: prev.from,
				to: s.to,
				lat: (prev.lat * a + s.lat * b) / (a + b),
				lon: (prev.lon * a + s.lon * b) / (a + b),
				minutes: Math.round((s.to - prev.from) / 60_000)
			};
		} else out.push({ kind: 'stopp', ...s });
	};
	let cursor = points[0].at;
	for (const s of stops(points)) {
		trip(cursor, s.from);
		stay(s);
		cursor = s.to;
	}
	trip(cursor, points[points.length - 1].at);
	// Fahrten beginnen und enden am Ort der Standzeit daneben – so haben beide dieselbe Anschrift
	return out.map((s, i) => {
		if (s.kind !== 'fahrt') return s;
		const before = out[i - 1];
		const after = out[i + 1];
		return {
			...s,
			start: before?.kind === 'stopp' ? { lat: before.lat, lon: before.lon } : s.start,
			end: after?.kind === 'stopp' ? { lat: after.lat, lon: after.lon } : s.end
		};
	});
}

/** Für die Karte reicht eine Auswahl gleichmäßig über die Strecke – Anfang und Ende bleiben */
export function thinned<T>(points: readonly T[], max: number): T[] {
	if (points.length <= max) return [...points];
	const step = (points.length - 1) / (max - 1);
	return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

/** Was in den Zeitraum fällt – auch nur zum Teil (über Mitternacht) */
export function overlapping<T extends { from: number; to: number }>(items: readonly T[], from: number, to: number): T[] {
	return items.filter((s) => s.to >= from && s.from < to);
}

/** Ein fester Ort: Lager, Firma, Baustelle */
export interface FleetPlace extends LatLon {
	id: number;
	name: string;
	radius: number;
}

/** Der nächste feste Ort, in dessen Umkreis der Standort liegt */
export function placeAt<P extends FleetPlace>(p: LatLon, places: readonly P[]): P | null {
	let best: P | null = null;
	let bestDistance = Infinity;
	for (const place of places) {
		const d = distance(p, place);
		if (d <= place.radius && d < bestDistance) {
			best = place;
			bestDistance = d;
		}
	}
	return best;
}

export type VehicleState = 'faehrt' | 'steht' | 'offline' | 'nie';

/** Ein Auto auf der Karte */
export interface MapVehicle {
	id: number;
	name: string;
	kind: 'pkw' | 'transporter' | 'lkw';
	lat: number;
	lon: number;
	state: VehicleState;
	heading: number | null;
	href: string;
}

/**
 * Fährt (letzter Standort jünger als 5 Minuten, schneller als rund 10 km/h),
 * steht (das Tablet hat sich in der letzten halben Stunde gemeldet), offline
 * (länger nichts) – oder hat noch nie etwas geschickt.
 */
export function vehicleState(v: { lastAt: Date | number | null; lastSeenAt: Date | number | null; lastSpeed: number | null }, now = Date.now()): VehicleState {
	const ms = (d: Date | number | null) => (d == null ? null : typeof d === 'number' ? d : d.getTime());
	const at = ms(v.lastAt);
	const seen = Math.max(ms(v.lastSeenAt) ?? 0, at ?? 0);
	if (!seen) return 'nie';
	if (at != null && now - at < 5 * 60_000 && (v.lastSpeed ?? 0) > WALK_SPEED) return 'faehrt';
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
