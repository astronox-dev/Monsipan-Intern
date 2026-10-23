/**
 * Wetter für die Übersicht – das Rechnen. Die Vorhersage von MET Norway kommt
 * erst stündlich, nach gut zwei Tagen in Sechs-Stunden-Blöcken; daraus werden
 * Tage (in Wiener Zeit), und die Wettersymbole bekommen deutsche Namen.
 * Das Abrufen steht in $lib/server/weather.ts.
 */

/** Ein Zeitpunkt der Vorhersage, so wie ihn api.met.no liefert (nur, was wir brauchen) */
export interface ForecastStep {
	time: string;
	data: {
		instant: { details: { air_temperature?: number; apparent_air_temperature?: number; wind_speed?: number } };
		next_1_hours?: { summary: { symbol_code: string }; details?: { precipitation_amount?: number } };
		next_6_hours?: {
			summary: { symbol_code: string };
			details?: { precipitation_amount?: number; air_temperature_max?: number; air_temperature_min?: number };
		};
		next_12_hours?: { summary: { symbol_code: string } };
	};
}

export interface WeatherDay {
	date: string;
	symbol: string;
	min: number;
	max: number;
	/** Niederschlag in mm */
	rain: number;
	/** Stärkster Wind in km/h */
	wind: number;
}

export interface Weather {
	place: string;
	/** Wann die Vorhersage gerechnet wurde (ISO) */
	updated: string;
	/** Die laufende Stunde */
	now: { hour: number; temp: number; feels: number | null; symbol: string; wind: number } | null;
	/** Ab welcher Stunde es heute regnet – null, wenn es trocken bleibt */
	rainFrom: number | null;
	/** Heute und die nächsten Tage */
	days: WeatherDay[];
}

const parts = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Vienna',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	hourCycle: 'h23'
});

/** Datum und Stunde in Wien – unabhängig von der Zeitzone des Servers */
export function viennaTime(d: Date): { date: string; hour: number } {
	const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
	return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const HOUR = 3_600_000;
/** Ab so viel Niederschlag in einer Stunde zählt es als Regen */
const WET = 0.1;
const kmh = (ms: number) => Math.round(ms * 3.6);

/**
 * Fasst die Vorhersage zu Tagen zusammen: tiefste und höchste Temperatur,
 * Niederschlag (jede Stunde nur einmal – stündlich, solange es das gibt, danach
 * in Blöcken), stärkster Wind. Als Symbol des Tages die 12-Stunden-Vorhersage
 * ab dem Morgen; heute, wenn der Morgen vorbei ist, die der nächsten Stunden.
 */
export function summarize(steps: ForecastStep[], place: string, updated: string, now = new Date(), count = 8): Weather {
	const today = viennaTime(now).date;
	const days = new Map<string, { day: WeatherDay; morning: boolean }>();
	let covered = 0;
	let current: Weather['now'] = null;
	let rainFrom: number | null = null;

	for (const s of steps) {
		const t = Date.parse(s.time);
		// Was schon vorbei ist (eine ältere Vorhersage aus dem Zwischenspeicher)
		if (t + HOUR <= now.getTime()) continue;
		const { date, hour } = viennaTime(new Date(t));
		const { air_temperature: temp, apparent_air_temperature: feels, wind_speed: wind } = s.data.instant.details;
		const one = s.data.next_1_hours;
		const six = s.data.next_6_hours;
		const half = s.data.next_12_hours;

		if (!current && temp != null) current = { hour, temp, feels: feels ?? null, symbol: (one ?? six ?? half)?.summary.symbol_code ?? '', wind: kmh(wind ?? 0) };

		let entry = days.get(date);
		if (!entry) days.set(date, (entry = { day: { date, symbol: '', min: Infinity, max: -Infinity, rain: 0, wind: 0 }, morning: false }));
		const d = entry.day;
		if (temp != null) {
			d.min = Math.min(d.min, temp);
			d.max = Math.max(d.max, temp);
		}
		if (wind != null) d.wind = Math.max(d.wind, kmh(wind));

		if (t >= covered) {
			if (one) {
				const mm = one.details?.precipitation_amount ?? 0;
				d.rain += mm;
				if (date === today && rainFrom == null && mm >= WET) rainFrom = hour;
				covered = t + HOUR;
			} else if (six) {
				d.rain += six.details?.precipitation_amount ?? 0;
				const { air_temperature_min: lo, air_temperature_max: hi } = six.details ?? {};
				if (lo != null) d.min = Math.min(d.min, lo);
				if (hi != null) d.max = Math.max(d.max, hi);
				covered = t + 6 * HOUR;
			}
		}

		if (!entry.morning && half && hour >= 6 && hour <= 9) {
			d.symbol = half.summary.symbol_code;
			entry.morning = true;
		} else if (!d.symbol) d.symbol = (six ?? half ?? one)?.summary.symbol_code ?? '';
	}

	return {
		place,
		updated,
		now: current,
		rainFrom,
		days: [...days.values()]
			.map((e) => e.day)
			.filter((d) => d.date >= today && d.symbol && Number.isFinite(d.max))
			.sort((a, b) => a.date.localeCompare(b.date))
			.slice(0, count)
			.map((d) => ({ ...d, rain: Math.round(d.rain * 10) / 10 }))
	};
}

/** Art des Wetters – danach richtet sich das Symbol */
export type WeatherKind = 'clear' | 'fair' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'showers' | 'sleet' | 'snow' | 'thunder';

const PRECIPITATION: Record<string, [string, string]> = {
	rain: ['Regen', 'Regenschauer'],
	sleet: ['Schneeregen', 'Schneeregenschauer'],
	snow: ['Schneefall', 'Schneeschauer']
};

/**
 * Deutscher Name und Art zu einem Symbol von MET Norway, etwa
 * „lightrainshowers_day" → „Leichte Regenschauer". (Die API schreibt manche
 * Namen mit „lights…" – das gilt hier wie „light…".)
 */
export function symbolInfo(code: string): { label: string; kind: WeatherKind; night: boolean } {
	const [base, time] = code.split('_');
	const night = time === 'night';
	if (base === 'clearsky') return { label: night ? 'Klar' : 'Sonnig', kind: 'clear', night };
	if (base === 'fair') return { label: 'Heiter', kind: 'fair', night };
	if (base === 'partlycloudy') return { label: 'Teils bewölkt', kind: 'partly', night };
	if (base === 'fog') return { label: 'Nebel', kind: 'fog', night };
	const m = /^(lights?|heavy)?(rain|sleet|snow)(showers)?(andthunder)?$/.exec(base);
	if (!m) return { label: 'Bewölkt', kind: 'cloudy', night };
	const [, strength, what, showers, thunder] = m;
	const light = strength?.startsWith('light');
	const adjective = strength ? `${light ? 'Leicht' : 'Stark'}${showers ? 'e' : 'er'} ` : '';
	const label = `${adjective}${PRECIPITATION[what][showers ? 1 : 0]}${thunder ? ' und Gewitter' : ''}`;
	const kind: WeatherKind = thunder ? 'thunder' : what === 'snow' ? 'snow' : what === 'sleet' ? 'sleet' : showers ? 'showers' : light ? 'drizzle' : 'rain';
	return { label, kind, night };
}
