/**
 * Fuhrpark: Fahrzeuge und ihre Standorte. In jedem Auto liegt ein Tablet mit
 * der App „Monsipan Fahrzeug" – einmal gekoppelt, schickt es den Standort.
 * Standorte älter als 90 Tage löscht die nächtliche Wartung. Dazu feste Orte
 * (Lager, Firma, Baustellen) und die Anschriften, die zu Standzeiten gehören.
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt } from './common';
import { parties, users } from './core';

/** Art des Fahrzeugs – bestimmt das Symbol in Liste und Karte */
export const VEHICLE_KINDS = ['pkw', 'transporter', 'lkw'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

export const vehicles = sqliteTable(
	'vehicles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Wie man das Auto nennt, etwa „Pritsche Nord" */
		name: text('name').notNull(),
		plate: text('plate').notNull().default(''),
		kind: text('kind', { enum: VEHICLE_KINDS }).notNull().default('transporter'),
		/** Wer das Auto gerade fährt – Wechsel stehen in vehicle_drivers, fürs Fahrtenbuch */
		driverId: integer('driver_id').references(() => users.id, { onDelete: 'set null' }),
		/** Partie, die das Auto meist fährt – nur zur Anzeige */
		partyId: integer('party_id').references(() => parties.id, { onDelete: 'set null' }),
		note: text('note').notNull().default(''),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		/** Schlüssel des gekoppelten Tablets (SHA-256) – ohne ist kein Tablet gekoppelt */
		deviceTokenHash: text('device_token_hash'),
		deviceName: text('device_name').notNull().default(''),
		pairedAt: integer('paired_at', { mode: 'timestamp_ms' }),
		/** Kopplungscode (SHA-256) und bis wann er gilt */
		pairCodeHash: text('pair_code_hash'),
		pairCodeExpires: integer('pair_code_expires', { mode: 'timestamp_ms' }),
		/** Zuletzt hat sich das Tablet gemeldet (auch ohne neuen Standort) */
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
		/** Der letzte Standort – für die Live-Karte ohne Suche in den Standorten */
		lastAt: integer('last_at', { mode: 'timestamp_ms' }),
		lastLat: real('last_lat'),
		lastLon: real('last_lon'),
		/** m/s */
		lastSpeed: real('last_speed'),
		lastHeading: real('last_heading'),
		lastAccuracy: real('last_accuracy'),
		/** Akku des Tablets in Prozent, und ob es lädt (= Zündung an) */
		battery: integer('battery'),
		charging: integer('charging', { mode: 'boolean' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [uniqueIndex('vehicles_device_token_idx').on(t.deviceTokenHash), uniqueIndex('vehicles_pair_code_idx').on(t.pairCodeHash)]
);

export const vehiclePositions = sqliteTable(
	'vehicle_positions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		vehicleId: integer('vehicle_id')
			.notNull()
			.references(() => vehicles.id, { onDelete: 'cascade' }),
		at: integer('at', { mode: 'timestamp_ms' }).notNull(),
		lat: real('lat').notNull(),
		lon: real('lon').notNull(),
		/** m/s */
		speed: real('speed'),
		heading: real('heading'),
		/** Genauigkeit in m */
		accuracy: real('accuracy')
	},
	(t) => [index('vehicle_positions_vehicle_at_idx').on(t.vehicleId, t.at), index('vehicle_positions_at_idx').on(t.at)]
);

/** Wer ab wann ein Auto fährt – so stimmt der Fahrer im Fahrtenbuch auch für frühere Fahrten */
export const vehicleDrivers = sqliteTable(
	'vehicle_drivers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		vehicleId: integer('vehicle_id')
			.notNull()
			.references(() => vehicles.id, { onDelete: 'cascade' }),
		/** Ohne: ab da niemand eingetragen */
		driverId: integer('driver_id').references(() => users.id, { onDelete: 'set null' }),
		/** Der Name zum Zeitpunkt – bleibt, auch wenn das Konto später weg ist */
		driverName: text('driver_name').notNull().default(''),
		since: integer('since', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('vehicle_drivers_vehicle_idx').on(t.vehicleId, t.since)]
);

/** Feste Orte: Lager, Firma, Baustellen – auf der Karte markiert, im Verlauf mit Namen */
export const fleetPlaces = sqliteTable('fleet_places', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	address: text('address').notNull().default(''),
	lat: real('lat').notNull(),
	lon: real('lon').notNull(),
	/** Umkreis in Metern – steht ein Auto darin, ist es „dort" */
	radius: integer('radius').notNull().default(150),
	createdAt: createdAt(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
});

/**
 * Anschriften zu Standorten (OpenStreetMap), je auf etwa 10 m gerundeter
 * Lage einmal gefragt. Leer heißt: dort gibt es keine – nach einer Woche
 * wird neu gefragt.
 */
export const geoAddresses = sqliteTable('geo_addresses', {
	key: text('key').primaryKey(),
	label: text('label').notNull().default(''),
	fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull()
});
