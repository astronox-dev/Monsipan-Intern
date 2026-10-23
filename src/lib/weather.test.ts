import { describe, expect, it } from 'vitest';
import { summarize, symbolInfo, viennaTime, type ForecastStep } from './weather';

/** Ein Schritt der Vorhersage: stündlich (mit 1-h-Wert) oder als Sechs-Stunden-Block */
function step(time: string, temp: number, o: { one?: [string, number]; six?: [string, number, number?, number?]; half?: string; wind?: number } = {}): ForecastStep {
	return {
		time,
		data: {
			instant: { details: { air_temperature: temp, apparent_air_temperature: temp - 2, wind_speed: o.wind ?? 2 } },
			next_1_hours: o.one ? { summary: { symbol_code: o.one[0] }, details: { precipitation_amount: o.one[1] } } : undefined,
			next_6_hours: o.six
				? { summary: { symbol_code: o.six[0] }, details: { precipitation_amount: o.six[1], air_temperature_min: o.six[2], air_temperature_max: o.six[3] } }
				: undefined,
			next_12_hours: o.half ? { summary: { symbol_code: o.half } } : undefined
		}
	};
}

describe('Wetter', () => {
	it('rechnet in Wiener Zeit – auch über die Zeitumstellung', () => {
		expect(viennaTime(new Date('2026-10-23T22:30:00Z'))).toEqual({ date: '2026-10-24', hour: 0 });
		expect(viennaTime(new Date('2026-10-25T23:30:00Z'))).toEqual({ date: '2026-10-26', hour: 0 });
	});

	it('fasst die Vorhersage zu Tagen zusammen, jede Stunde nur einmal', () => {
		// Jetzt: Freitag 12:30 in Wien; der Morgen ist vorbei
		const now = new Date('2026-10-23T10:30:00Z');
		const steps = [
			step('2026-10-23T09:00:00Z', 9, { one: ['clearsky_day', 0], six: ['fair_day', 0], half: 'partlycloudy_day' }), // schon vorbei
			step('2026-10-23T10:00:00Z', 11, { one: ['fair_day', 0], six: ['lightrain', 3], half: 'rain', wind: 5 }),
			step('2026-10-23T11:00:00Z', 12, { one: ['cloudy', 0], six: ['lightrain', 3] }),
			step('2026-10-23T12:00:00Z', 13, { one: ['lightrain', 0.6], six: ['lightrain', 3] }),
			step('2026-10-23T13:00:00Z', 10, { one: ['rain', 1.2], six: ['rain', 3] }),
			// Samstag 05:00 ist noch nicht Morgen; ab 08:00 geben die 12 Stunden das Symbol
			step('2026-10-24T03:00:00Z', 4, { one: ['fog', 0], six: ['fog', 0], half: 'fog' }),
			step('2026-10-24T06:00:00Z', 5, { one: ['cloudy', 0], six: ['cloudy', 0], half: 'partlycloudy_day' }),
			// Ab hier nur noch Blöcke – mit Tiefst- und Höchstwerten dazwischen
			step('2026-10-24T07:00:00Z', 6, { six: ['cloudy', 0.4, 3, 14] }),
			step('2026-10-24T13:00:00Z', 12, { six: ['rainshowers_day', 2.5, 8, 12], half: 'cloudy' })
		];
		const w = summarize(steps, 'Eibesbrunn', '2026-10-23T09:00:00Z', now);
		expect(w.now).toEqual({ hour: 12, temp: 11, feels: 9, symbol: 'fair_day', wind: 18 });
		expect(w.rainFrom).toBe(14);
		expect(w.days).toEqual([
			// Heute nur noch die nächsten sechs Stunden als Symbol; 0,6 + 1,2 mm, nicht der Block dazu
			{ date: '2026-10-23', symbol: 'lightrain', min: 10, max: 13, rain: 1.8, wind: 18 },
			{ date: '2026-10-24', symbol: 'partlycloudy_day', min: 3, max: 14, rain: 2.9, wind: 7 }
		]);
	});

	it('bleibt es trocken, gibt es kein „Regen ab"', () => {
		const w = summarize([step('2026-10-23T10:00:00Z', 11, { one: ['clearsky_day', 0], six: ['clearsky_day', 0] })], 'Eibesbrunn', '', new Date('2026-10-23T10:10:00Z'));
		expect(w.rainFrom).toBeNull();
		expect(w.days[0]).toMatchObject({ rain: 0, symbol: 'clearsky_day' });
	});

	it('zeigt höchstens die gewünschten Tage', () => {
		const steps = Array.from({ length: 12 }, (_, i) => step(`2026-11-${String(i + 1).padStart(2, '0')}T06:00:00Z`, 5, { six: ['cloudy', 0], half: 'cloudy' }));
		const w = summarize(steps, 'Eibesbrunn', '', new Date('2026-11-01T05:00:00Z'));
		expect(w.days.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
	});

	it('benennt die Wettersymbole auf Deutsch', () => {
		expect(symbolInfo('clearsky_day')).toEqual({ label: 'Sonnig', kind: 'clear', night: false });
		expect(symbolInfo('clearsky_night')).toEqual({ label: 'Klar', kind: 'clear', night: true });
		expect(symbolInfo('partlycloudy_day').label).toBe('Teils bewölkt');
		expect(symbolInfo('cloudy')).toMatchObject({ label: 'Bewölkt', kind: 'cloudy' });
		expect(symbolInfo('lightrain')).toMatchObject({ label: 'Leichter Regen', kind: 'drizzle' });
		expect(symbolInfo('heavyrain')).toMatchObject({ label: 'Starker Regen', kind: 'rain' });
		expect(symbolInfo('lightrainshowers_day')).toMatchObject({ label: 'Leichte Regenschauer', kind: 'showers' });
		expect(symbolInfo('sleet')).toMatchObject({ label: 'Schneeregen', kind: 'sleet' });
		expect(symbolInfo('heavysnowshowers_night')).toMatchObject({ label: 'Starke Schneeschauer', kind: 'snow', night: true });
		expect(symbolInfo('rainandthunder')).toMatchObject({ label: 'Regen und Gewitter', kind: 'thunder' });
		// So schreibt es die API wirklich
		expect(symbolInfo('lightssleetshowersandthunder_day')).toMatchObject({ label: 'Leichte Schneeregenschauer und Gewitter', kind: 'thunder' });
		expect(symbolInfo('unbekannt').kind).toBe('cloudy');
	});
});
