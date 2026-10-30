import { describe, expect, it } from 'vitest';
import { distance, kilometers, overlapping, placeAt, segments, smoothTrack, stops, vehicleState, viennaDayStart, type TrackPoint } from './track';

const MIN = 60_000;
const rad = (d: number) => (d * Math.PI) / 180;
const at = (min: number, lat: number, lon: number, accuracy: number | null = 10): TrackPoint => ({ at: Date.UTC(2026, 9, 27, 6) + min * MIN, lat, lon, speed: null, accuracy });

describe('Fuhrpark – Strecke', () => {
	it('misst Entfernungen', () => {
		// Eibesbrunn – Wolkersdorf, rund 2,6 km Luftlinie
		expect(Math.round(distance({ lat: 48.3608, lon: 16.4925 }, { lat: 48.3812, lon: 16.5163 }))).toBeGreaterThan(2500);
		expect(Math.round(distance({ lat: 48.3608, lon: 16.4925 }, { lat: 48.3812, lon: 16.5163 }))).toBeLessThan(2900);
		expect(distance({ lat: 48, lon: 16 }, { lat: 48, lon: 16 })).toBe(0);
	});

	it('zählt Kilometer – ohne ungenaue Punkte und Sprünge', () => {
		const route = [at(0, 48.3608, 16.4925), at(5, 48.3812, 16.5163), at(10, 48.3608, 16.4925)];
		expect(kilometers(route)).toBeCloseTo(5.4, 0);
		// Ein ungenauer Punkt (2 km) dazwischen zählt nicht
		expect(kilometers([route[0], at(2, 48.5, 16.9, 2000), route[1]])).toBe(kilometers(route.slice(0, 2)));
		// 100 km in einer Minute ist ein Ausreißer
		expect(kilometers([at(0, 48, 16), at(1, 48.9, 16)])).toBe(0);
	});

	it('findet Standzeiten ab 10 Minuten im Umkreis von 100 m – auch über eine Lücke', () => {
		const points = [
			at(0, 48.3608, 16.4925),
			at(3, 48.3609, 16.4926),
			// 40 Minuten nichts (das Tablet sendet im Stehen kaum), dann immer noch da
			at(43, 48.3608, 16.4924),
			at(45, 48.37, 16.5),
			at(46, 48.3812, 16.5163),
			at(48, 48.3813, 16.5163)
		];
		const found = stops(points);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ from: points[0].at, to: points[2].at, minutes: 43 });
	});
});

describe('Fuhrpark – Glätten', () => {
	it('in der Wohnung: aus dem Stern wird ein Punkt mit Standzeit, ohne Kilometer', () => {
		const home = { lat: 48.3608, lon: 16.4925 };
		// Etwa eine Stunde jede Minute ein Standort, 10–40 m daneben (WLAN), dazu Ausreißer
		const jitter: TrackPoint[] = Array.from({ length: 60 }, (_, i) => {
			const angle = (i * 137) % 360;
			const r = (10 + ((i * 7) % 30)) / 111_000;
			return at(i, home.lat + r * Math.cos(rad(angle)), home.lon + (r * Math.sin(rad(angle))) / 0.66, 20 + (i % 15));
		});
		// Ausreißer: 150 m in den Hof, genau genug gemeldet – und gleich wieder zurück
		jitter[20] = at(20, home.lat - 0.00135, home.lon, 30);
		jitter[41] = at(41, home.lat - 0.0014, home.lon + 0.0002, 35);
		// Ganz ungenau (Funkmast)
		jitter[33] = at(33, home.lat + 0.004, home.lon, 300);

		expect(kilometers(jitter)).toBeGreaterThan(1);
		const smooth = smoothTrack(jitter);
		expect(kilometers(smooth)).toBe(0);
		// Nur der Ort und eine Kopie mit der letzten Zeit
		expect(new Set(smooth.map((p) => `${p.lat},${p.lon}`)).size).toBe(1);
		expect(stops(smooth)).toMatchObject([{ minutes: 59 }]);
	});

	it('zu Fuß mit dem Tablet über die Baustelle: Standzeit, keine Fahrt', () => {
		const site = { lat: 48.12, lon: 16.45 };
		const arrive = { ...at(0, site.lat, site.lon, 6), speed: 0 };
		// Eine halbe Stunde hin und her, bis 200 m weit, Schritttempo
		const walk = Array.from({ length: 30 }, (_, i) => ({ ...at(i + 1, site.lat + ((i % 10) * 0.00018) * (i % 2 ? 1 : -1), site.lon + (i % 7) * 0.0002, 8), speed: 1.3 }));
		const smooth = smoothTrack([arrive, ...walk]);
		expect(kilometers(smooth)).toBe(0);
		expect(stops(smooth)).toMatchObject([{ minutes: 30 }]);
		// Wegfahren bleibt eine Fahrt
		const leave = Array.from({ length: 5 }, (_, i) => ({ ...at(32 + i * 0.5, site.lat + 0.004 * (i + 1), site.lon, 6), speed: 15 }));
		expect(kilometers(smoothTrack([arrive, ...walk, ...leave]))).toBeGreaterThan(2);
	});

	it('eine echte Fahrt bleibt eine Fahrt', () => {
		const route = Array.from({ length: 9 }, (_, i) => ({ ...at(i, 48.3608 + (0.0204 * i) / 8, 16.4925 + (0.0238 * i) / 8, 6), speed: 13 }));
		const smooth = smoothTrack(route);
		expect(smooth).toHaveLength(9);
		expect(kilometers(smooth)).toBe(kilometers(route));
	});
});

describe('Fuhrpark – Zustand', () => {
	const now = Date.UTC(2026, 9, 27, 12);
	it('fährt, steht, meldet sich nicht – oder nie', () => {
		expect(vehicleState({ lastAt: now - MIN, lastSeenAt: now - MIN, lastSpeed: 12 }, now)).toBe('faehrt');
		expect(vehicleState({ lastAt: now - 60 * MIN, lastSeenAt: now - 2 * MIN, lastSpeed: 12 }, now)).toBe('steht');
		expect(vehicleState({ lastAt: now - MIN, lastSeenAt: now - MIN, lastSpeed: 0.5 }, now)).toBe('steht');
		expect(vehicleState({ lastAt: now - 3 * 60 * MIN, lastSeenAt: now - 2 * 60 * MIN, lastSpeed: 0 }, now)).toBe('offline');
		expect(vehicleState({ lastAt: null, lastSeenAt: null, lastSpeed: null }, now)).toBe('nie');
	});

	it('Tagesbeginn in Wien – Sommer- und Winterzeit', () => {
		expect(new Date(viennaDayStart('2026-07-01')).toISOString()).toBe('2026-06-30T22:00:00.000Z');
		expect(new Date(viennaDayStart('2026-12-01')).toISOString()).toBe('2026-11-30T23:00:00.000Z');
		// Umstellung am 25.10.: der Tag beginnt noch in Sommerzeit
		expect(new Date(viennaDayStart('2026-10-25')).toISOString()).toBe('2026-10-24T22:00:00.000Z');
	});
});

describe('Fuhrpark – Fahrten und Standzeiten', () => {
	/** Gerade Fahrt von a nach b, jede halbe Minute ein Punkt */
	const drive = (startMin: number, minutes: number, a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
		Array.from({ length: minutes * 2 + 1 }, (_, i) => {
			const f = i / (minutes * 2);
			return { ...at(startMin + i / 2, a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f, 6), speed: 14 };
		});
	const lager = { lat: 48.3608, lon: 16.4925 };
	const baustelle = { lat: 48.3812, lon: 16.5163 };
	const tankstelle = { lat: 48.37, lon: 16.5044 };

	it('kurze Halte unter 10 Minuten gehören zur Fahrt', () => {
		const points = [
			...drive(0, 4, lager, tankstelle),
			// 8 Minuten tanken
			{ ...at(12, tankstelle.lat, tankstelle.lon, 6), speed: 0 },
			...drive(12.5, 4, tankstelle, baustelle),
			// Eine Stunde auf der Baustelle
			{ ...at(80, baustelle.lat, baustelle.lon, 6), speed: 0 }
		];
		const seg = segments(smoothTrack(points));
		expect(seg.map((s) => s.kind)).toEqual(['fahrt', 'stopp']);
		const [trip, stop] = seg;
		expect(trip.kind === 'fahrt' && trip.km).toBeGreaterThan(2.5);
		// Ab der Ankunft (im Umkreis von 100 m) bis zum letzten Standort
		expect(stop.kind === 'stopp' && stop.minutes).toBe(64);
	});

	it('über Mitternacht: eine Fahrt, die in beide Tage fällt', () => {
		const midnight = Date.UTC(2026, 9, 27, 23) - Date.UTC(2026, 9, 27, 6);
		const start = midnight / MIN - 10;
		const points = [{ ...at(start - 30, lager.lat, lager.lon, 6), speed: 0 }, ...drive(start, 20, lager, baustelle), { ...at(start + 60, baustelle.lat, baustelle.lon, 6), speed: 0 }];
		const seg = segments(smoothTrack(points));
		const trips = seg.filter((s) => s.kind === 'fahrt');
		expect(trips).toHaveLength(1);
		const cut = Date.UTC(2026, 9, 27, 23);
		expect(overlapping(trips, cut - 86_400_000, cut)).toHaveLength(1);
		expect(overlapping(trips, cut, cut + 86_400_000)).toHaveLength(1);
	});

	it('kennt feste Orte im Umkreis – der nächste gewinnt', () => {
		const places = [
			{ id: 1, name: 'Lager Eibesbrunn', ...lager, radius: 150 },
			{ id: 2, name: 'Nachbar', lat: lager.lat + 0.0018, lon: lager.lon, radius: 300 }
		];
		expect(placeAt({ lat: lager.lat + 0.0003, lon: lager.lon }, places)?.name).toBe('Lager Eibesbrunn');
		expect(placeAt({ lat: lager.lat + 0.0016, lon: lager.lon }, places)?.name).toBe('Nachbar');
		expect(placeAt(baustelle, places)).toBeNull();
	});
});
