import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { ORIGIN: 'https://intern.example.at' } }));

const { getWeather, resetWeatherCache } = await import('./weather');

const forecast = (temp: number) => ({
	properties: {
		meta: { updated_at: '2026-10-23T09:00:00Z' },
		timeseries: [
			{
				time: '2026-10-23T10:00:00Z',
				data: {
					instant: { details: { air_temperature: temp, wind_speed: 3 } },
					next_1_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 0 } },
					next_6_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 0 } }
				}
			}
		]
	}
});

function answer(status: number, body?: unknown, expires = 'Fri, 23 Oct 2026 11:00:00 GMT') {
	return new Response(body ? JSON.stringify(body) : null, { status, headers: { expires, 'last-modified': 'Fri, 23 Oct 2026 10:00:00 GMT' } });
}

/** Uhrzeit für den Zwischenspeicher – nur die Uhr, Timer laufen echt */
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	resetWeatherCache();
});

describe('Wetter abrufen', () => {
	it('fragt mit Kennung und hält die Antwort bis „Expires"', async () => {
		const fetch = vi.fn().mockResolvedValue(answer(200, forecast(11)));
		vi.stubGlobal('fetch', fetch);
		at('2026-10-23T10:15:00Z');
		const w = await getWeather();
		expect(w?.now?.temp).toBe(11);
		expect(fetch.mock.calls[0][0]).toContain('lat=48.3608&lon=16.4925');
		expect(fetch.mock.calls[0][1].headers['User-Agent']).toContain('https://intern.example.at');

		at('2026-10-23T10:45:00Z');
		await getWeather();
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('fragt danach mit „If-Modified-Since" nach und zeigt solange die letzte', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(answer(200, forecast(11), 'Fri, 23 Oct 2026 10:30:00 GMT'))
			.mockResolvedValueOnce(answer(304, undefined, 'Fri, 23 Oct 2026 12:00:00 GMT'));
		vi.stubGlobal('fetch', fetch);
		at('2026-10-23T10:15:00Z');
		await getWeather();
		at('2026-10-23T10:50:00Z');
		const w = await getWeather();
		expect(w?.now?.temp).toBe(11);
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		expect(fetch.mock.calls[1][1].headers['If-Modified-Since']).toBe('Fri, 23 Oct 2026 10:00:00 GMT');
	});

	it('ohne Dienst gibt es keine Vorhersage – und keinen Fehler', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		at('2026-10-23T10:15:00Z');
		expect(await getWeather()).toBeNull();
	});
});
