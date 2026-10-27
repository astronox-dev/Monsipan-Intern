/**
 * Fuhrpark: Fahrzeuge und ihre Standorte. In jedem Auto liegt ein Tablet mit
 * der App „Monsipan Fahrzeug" – einmal gekoppelt, schickt es den Standort.
 * Standorte älter als 90 Tage löscht die nächtliche Wartung.
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt } from './common';
import { parties } from './core';

export const vehicles = sqliteTable(
	'vehicles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Wie man das Auto nennt, etwa „Pritsche Nord" */
		name: text('name').notNull(),
		plate: text('plate').notNull().default(''),
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
