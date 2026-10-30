/**
 * Anschriften zu Standzeiten und Fahrten – von OpenStreetMap (Nominatim).
 *
 * Nominatim ist frei, verlangt aber eine Kennung mit Kontakt (User-Agent),
 * höchstens eine Anfrage pro Sekunde und dass Antworten zwischengespeichert
 * werden. Darum: je auf etwa 10 m gerundeter Lage nur einmal fragen, die
 * Antwort in der Datenbank behalten, und Anfragen nacheinander mit Abstand.
 * Gefragt wird nur für Standzeiten und Fahrt-Enden – nicht für jeden Punkt.
 * Was noch fehlt, kommt in die Warteschlange; die Seite zeigt es beim
 * nächsten Laden.
 */
import { inArray, lt } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { geoAddresses } from '$lib/server/db/schema';
import type { LatLon } from '../track';

/** Leere Antworten (nichts gefunden, Fehler) nach einer Woche neu fragen */
const RETRY_EMPTY_MS = 7 * 86_400_000;
/** Abstand zwischen zwei Anfragen – Nominatim erlaubt eine pro Sekunde */
const GAP_MS = 1100;
/** Mehr steht nicht in der Warteschlange – der Rest kommt beim nächsten Laden dran */
const MAX_QUEUE = 300;

const userAgent = () => `Monsipan-Intern/1.0 (+${env.ORIGIN || 'https://intern.monsipan.at'})`;

/** Schlüssel: Lage auf 4 Stellen (rund 10 m) */
export const addressKey = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

const queue = new Map<string, LatLon>();
let running: Promise<void> | null = null;
let lastCall = 0;

/** „Porschestraße 17, 1230 Wien" aus der Antwort von Nominatim */
export function formatAddress(a: Record<string, string | undefined>): string {
	const street = a.road ?? a.pedestrian ?? a.footway ?? a.path ?? a.industrial ?? a.farmyard ?? '';
	const line1 = [street, a.house_number].filter(Boolean).join(' ');
	const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? '';
	const line2 = [a.postcode, town].filter(Boolean).join(' ');
	return [line1 || a.suburb || '', line2].filter(Boolean).join(', ').slice(0, 160);
}

async function lookup(p: LatLon): Promise<string> {
	const wait = lastCall + GAP_MS - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastCall = Date.now();
	const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}&zoom=18&addressdetails=1&accept-language=de`;
	const res = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return formatAddress((await res.json())?.address ?? {});
}

async function work() {
	while (queue.size) {
		const [key, p] = queue.entries().next().value!;
		queue.delete(key);
		let label = '';
		try {
			label = await lookup(p);
		} catch (e) {
			console.warn('[fahrzeuge] Anschrift nicht abrufbar –', e instanceof Error ? e.message : e);
		}
		await db
			.insert(geoAddresses)
			.values({ key, label, fetchedAt: new Date() })
			.onConflictDoUpdate({ target: geoAddresses.key, set: { label, fetchedAt: new Date() } });
	}
}

function enqueue(points: Map<string, LatLon>) {
	if (env.GEOCODE === 'aus') return;
	for (const [key, p] of points) if (queue.size < MAX_QUEUE) queue.set(key, p);
	if (queue.size && !running) running = work().finally(() => (running = null));
}

/**
 * Anschriften zu den Standorten – was bekannt ist, sofort; was fehlt, wird
 * gefragt. Höchstens `waitMs` wird darauf gewartet, der Rest kommt später.
 */
export async function addressesFor(points: readonly LatLon[], waitMs = 0): Promise<Map<string, string>> {
	const wanted = new Map(points.map((p) => [addressKey(p), p]));
	const read = async () => {
		const keys = [...wanted.keys()];
		const out = new Map<string, string>();
		// SQLite verträgt nicht beliebig viele Platzhalter – in Häppchen
		for (let i = 0; i < keys.length; i += 500) {
			const rows = await db.select().from(geoAddresses).where(inArray(geoAddresses.key, keys.slice(i, i + 500))).all();
			for (const r of rows) if (r.label || Date.now() - r.fetchedAt.getTime() < RETRY_EMPTY_MS) out.set(r.key, r.label);
		}
		return out;
	};
	let known = await read();
	const missing = new Map([...wanted].filter(([k]) => !known.has(k)));
	if (!missing.size) return known;
	enqueue(missing);
	if (waitMs > 0 && running) {
		await Promise.race([running, new Promise((r) => setTimeout(r, waitMs))]);
		known = await read();
	}
	return known;
}

/** Ob noch Anschriften unterwegs sind – dann lädt die Seite gleich noch einmal */
export const addressesPending = () => queue.size > 0 || running != null;

/**
 * Anschrift zu einer eingegebenen Adresse suchen – für feste Orte. Liefert
 * bis zu fünf Treffer in Österreich (und den Nachbarländern).
 */
export async function searchAddress(q: string): Promise<{ label: string; lat: number; lon: number }[]> {
	const text = q.trim().slice(0, 200);
	if (text.length < 3) return [];
	const wait = lastCall + GAP_MS - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastCall = Date.now();
	const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=at,de,cz,sk,hu,si&accept-language=de&q=${encodeURIComponent(text)}`;
	const res = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const rows = (await res.json()) as { lat: string; lon: string; display_name?: string; address?: Record<string, string> }[];
	return rows
		.map((r) => ({ label: formatAddress(r.address ?? {}) || String(r.display_name ?? '').slice(0, 160), lat: Number(r.lat), lon: Number(r.lon) }))
		.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

/** Nächtliche Wartung: alte Anschriften vergessen – die Standorte dazu sind nach 90 Tagen ohnehin weg */
export async function purgeOldAddresses(now = new Date()) {
	await db.delete(geoAddresses).where(lt(geoAddresses.fetchedAt, new Date(now.getTime() - 180 * 86_400_000)));
}
