/**
 * Wetter für die Übersicht – Vorhersage für Eibesbrunn (2203) von MET Norway
 * (api.met.no). Der Dienst ist frei, auch für Firmen; er verlangt eine Kennung
 * mit Kontakt (User-Agent), die Nennung der Quelle (CC BY 4.0) und dass nicht
 * öfter gefragt wird als nötig: Eine Antwort gilt bis „Expires" (etwa eine
 * halbe Stunde), danach wird mit „If-Modified-Since" nachgefragt.
 *
 * Die Übersicht wartet nicht darauf: Ist die Vorhersage abgelaufen, wird sie im
 * Hintergrund erneuert und solange die letzte gezeigt. Fällt der Dienst aus,
 * bleibt die letzte stehen; nur ohne brauchbare wird kurz gewartet.
 */
import { env } from '$env/dynamic/private';
import { summarize, type ForecastStep, type Weather } from '$lib/weather';

export const WEATHER_PLACE = { name: 'Eibesbrunn', lat: 48.3608, lon: 16.4925, altitude: 169 };

const SOURCE = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${WEATHER_PLACE.lat}&lon=${WEATHER_PLACE.lon}&altitude=${WEATHER_PLACE.altitude}`;
const MINUTE = 60_000;
/** So lange wartet die Übersicht höchstens auf den Dienst */
const WAIT = 4000;
/** Bis zu diesem Alter wird die letzte Vorhersage gezeigt, ohne zu warten */
const STALE = 3 * 60 * MINUTE;

interface Cached {
	steps: ForecastStep[];
	updated: string;
	/** Bis wann die Antwort gilt (ms) */
	expires: number;
	lastModified: string | null;
	/** Wann der Dienst zuletzt geantwortet hat (ms) */
	checkedAt: number;
}

let cached: Cached | null = null;
let pending: Promise<void> | null = null;
/** Nach einem Fehler erst wieder nach ein paar Minuten fragen */
let retryAt = 0;

async function refresh(): Promise<void> {
	const headers: Record<string, string> = {
		'User-Agent': `Monsipan-Intern/1.0 (+${env.ORIGIN || 'https://intern.monsipan.at'})`,
		Accept: 'application/json'
	};
	if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
	try {
		const res = await fetch(SOURCE, { headers, signal: AbortSignal.timeout(15_000) });
		const now = Date.now();
		const expires = Date.parse(res.headers.get('expires') ?? '');
		const until = Number.isFinite(expires) ? Math.max(expires, now + 5 * MINUTE) : now + 30 * MINUTE;
		if (res.status === 304 && cached) {
			cached = { ...cached, expires: until, checkedAt: now };
			return;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json();
		const steps = body?.properties?.timeseries;
		if (!Array.isArray(steps) || !steps.length) throw new Error('keine Vorhersage in der Antwort');
		cached = { steps, updated: body.properties.meta?.updated_at ?? new Date(now).toISOString(), expires: until, lastModified: res.headers.get('last-modified'), checkedAt: now };
	} catch (e) {
		retryAt = Date.now() + 5 * MINUTE;
		console.warn('Wetter: Vorhersage nicht abrufbar –', e instanceof Error ? e.message : e);
	}
}

/** Heute und die nächsten 7 Tage – null, solange es keine Vorhersage gibt */
export async function getWeather(now = new Date()): Promise<Weather | null> {
	const t = now.getTime();
	if ((!cached || t >= cached.expires) && t >= retryAt) {
		pending ??= refresh().finally(() => (pending = null));
		if (!cached || t - cached.checkedAt > STALE) await Promise.race([pending, new Promise((r) => setTimeout(r, WAIT))]);
	}
	return cached ? summarize(cached.steps, WEATHER_PLACE.name, cached.updated, now) : null;
}

/** Nur für Tests: Zwischenspeicher leeren */
export function resetWeatherCache() {
	cached = null;
	pending = null;
	retryAt = 0;
}
