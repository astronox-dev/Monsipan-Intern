/**
 * Wetter für die Übersicht – Vorhersage von MET Norway (api.met.no) für
 * Eibesbrunn (2203) und auf Wunsch für den Standort des Geräts. Der Dienst ist
 * frei, auch für Firmen; er verlangt eine Kennung mit Kontakt (User-Agent), die
 * Nennung der Quelle (CC BY 4.0) und dass nicht öfter gefragt wird als nötig:
 * Eine Antwort gilt bis „Expires" (etwa eine halbe Stunde), danach wird mit
 * „If-Modified-Since" nachgefragt.
 *
 * Die Übersicht wartet nicht darauf: Ist die Vorhersage abgelaufen, wird sie im
 * Hintergrund erneuert und solange die letzte gezeigt. Fällt der Dienst aus,
 * bleibt die letzte stehen; nur ohne brauchbare wird kurz gewartet.
 *
 * Den Namen zum Standort liefert OpenStreetMap (Nominatim) – ebenfalls mit
 * Kennung, je Ort nur einmal. Beide Dienste bekommen nur die auf etwa einen
 * Kilometer gerundete Lage, nichts über die Person; gespeichert wird nichts.
 */
import { env } from '$env/dynamic/private';
import { summarize, type ForecastStep, type Weather } from '$lib/weather';

export interface WeatherPlace {
	name: string;
	lat: number;
	lon: number;
	/** Seehöhe in m – ohne nimmt MET Norway die eigene */
	altitude?: number;
}

export const WEATHER_PLACE: WeatherPlace = { name: 'Eibesbrunn', lat: 48.3608, lon: 16.4925, altitude: 169 };

const MINUTE = 60_000;
/** So lange wartet die Übersicht höchstens auf den Dienst */
const WAIT = 4000;
/** Bis zu diesem Alter wird die letzte Vorhersage gezeigt, ohne zu warten */
const STALE = 3 * 60 * MINUTE;
/** So viele Orte merkt sich der Server – die ältesten fallen heraus */
const MAX_PLACES = 100;

interface Cached {
	steps: ForecastStep[];
	updated: string;
	/** Bis wann die Antwort gilt (ms) */
	expires: number;
	lastModified: string | null;
	/** Wann der Dienst zuletzt geantwortet hat (ms) */
	checkedAt: number;
}

interface Slot {
	cached: Cached | null;
	pending: Promise<void> | null;
	/** Nach einem Fehler erst wieder nach ein paar Minuten fragen */
	retryAt: number;
}

const slots = new Map<string, Slot>();
const names = new Map<string, string>();

const userAgent = () => `Monsipan-Intern/1.0 (+${env.ORIGIN || 'https://intern.monsipan.at'})`;
const keyOf = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;

/** Auf zwei Stellen (etwa 1 km) – genauer braucht es das Wetter nicht, und Nachbarn teilen sich die Vorhersage */
export const roundCoord = (v: number) => Math.round(v * 100) / 100;

function slotOf(place: WeatherPlace): Slot {
	const key = keyOf(place);
	let slot = slots.get(key);
	if (!slot) {
		if (slots.size >= MAX_PLACES) {
			const oldest = [...slots].filter(([k]) => k !== keyOf(WEATHER_PLACE)).sort(([, a], [, b]) => (a.cached?.checkedAt ?? 0) - (b.cached?.checkedAt ?? 0))[0];
			if (oldest) slots.delete(oldest[0]);
		}
		slots.set(key, (slot = { cached: null, pending: null, retryAt: 0 }));
	}
	return slot;
}

async function refresh(place: WeatherPlace, slot: Slot): Promise<void> {
	const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${place.lat}&lon=${place.lon}${place.altitude != null ? `&altitude=${place.altitude}` : ''}`;
	const headers: Record<string, string> = { 'User-Agent': userAgent(), Accept: 'application/json' };
	if (slot.cached?.lastModified) headers['If-Modified-Since'] = slot.cached.lastModified;
	try {
		const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
		const now = Date.now();
		const expires = Date.parse(res.headers.get('expires') ?? '');
		const until = Number.isFinite(expires) ? Math.max(expires, now + 5 * MINUTE) : now + 30 * MINUTE;
		if (res.status === 304 && slot.cached) {
			slot.cached = { ...slot.cached, expires: until, checkedAt: now };
			return;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json();
		const steps = body?.properties?.timeseries;
		if (!Array.isArray(steps) || !steps.length) throw new Error('keine Vorhersage in der Antwort');
		slot.cached = { steps, updated: body.properties.meta?.updated_at ?? new Date(now).toISOString(), expires: until, lastModified: res.headers.get('last-modified'), checkedAt: now };
	} catch (e) {
		slot.retryAt = Date.now() + 5 * MINUTE;
		console.warn('Wetter: Vorhersage nicht abrufbar –', e instanceof Error ? e.message : e);
	}
}

/** Heute und die nächsten 7 Tage – null, solange es keine Vorhersage gibt */
export async function getWeather(place = WEATHER_PLACE, now = new Date()): Promise<Weather | null> {
	const slot = slotOf(place);
	const t = now.getTime();
	if ((!slot.cached || t >= slot.cached.expires) && t >= slot.retryAt) {
		slot.pending ??= refresh(place, slot).finally(() => (slot.pending = null));
		if (!slot.cached || t - slot.cached.checkedAt > STALE) await Promise.race([slot.pending, new Promise((r) => setTimeout(r, WAIT))]);
	}
	return slot.cached ? summarize(slot.cached.steps, place.name, slot.cached.updated, now) : null;
}

/** Name des Orts zur Lage – Ort, Gemeinde oder Stadt; leer, wenn er sich nicht finden lässt */
export async function placeName(lat: number, lon: number): Promise<string> {
	const key = keyOf({ lat, lon });
	const known = names.get(key);
	if (known != null) return known;
	try {
		const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&accept-language=de`, {
			headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
			signal: AbortSignal.timeout(WAIT)
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const a = (await res.json())?.address ?? {};
		const name = String(a.village ?? a.town ?? a.city ?? a.municipality ?? a.suburb ?? a.hamlet ?? '').slice(0, 80);
		if (names.size >= MAX_PLACES) names.delete(names.keys().next().value!);
		names.set(key, name);
		return name;
	} catch (e) {
		console.warn('Wetter: Ortsname nicht abrufbar –', e instanceof Error ? e.message : e);
		return '';
	}
}

/** Nur für Tests: Zwischenspeicher leeren */
export function resetWeatherCache() {
	slots.clear();
	names.clear();
}
