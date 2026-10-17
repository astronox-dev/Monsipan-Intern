/**
 * Tabellen, die alle Bereiche brauchen: Benutzer, Anmeldung, Partien und
 * Einstellungen. Fachbereiche bauen darauf auf, nicht umgekehrt.
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ROLES } from '$lib/permissions';
import { createdAt } from './common';

/** Person oder Gruppe (Partie), an die Material ausgegeben wird */
export const parties = sqliteTable('parties', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	kind: text('kind', { enum: ['person', 'gruppe'] }).notNull().default('gruppe'),
	note: text('note').notNull().default(''),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	/** Platz als Spalte in der Wochenplanung (per Ziehen); ohne Platz alphabetisch dahinter */
	planOrder: integer('plan_order'),
	createdAt: createdAt()
});

/**
 * Einheiten zur Auswahl in Angeboten, Rechnungen und Tagesberichten – gepflegt
 * unter Stammdaten. Die Positionen speichern den Text, nicht die Kennung.
 */
export const units = sqliteTable('units', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	sortOrder: integer('sort_order').notNull().default(0)
});

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	email: text('email').unique(),
	firstName: text('first_name').notNull().default(''),
	lastName: text('last_name').notNull().default(''),
	passwordHash: text('password_hash').notNull(),
	role: text('role', { enum: ROLES }).notNull(),
	/** Partie des Benutzers (Pflicht für Partieführer und Arbeiter) – beim Buchen vorausgewählt */
	partyId: integer('party_id').references(() => parties.id, { onDelete: 'set null' }),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	/** Inhaber: darf als Einziger Admins löschen, herabstufen oder deaktivieren – genau ein Konto */
	owner: integer('owner', { mode: 'boolean' }).notNull().default(false),
	mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
	/** Führt keine Stundenzettel (etwa Admin- oder Büro-Konten) – fehlt in der Wochenliste */
	timesheetExempt: integer('timesheet_exempt', { mode: 'boolean' }).notNull().default(false),
	lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
	/** Zuletzt die App geöffnet – bei Anfragen höchstens alle paar Minuten fortgeschrieben */
	lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
	/** Gelöscht, aber wegen vorhandener Buchungen als Name in der Historie behalten */
	deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
	createdAt: createdAt()
});

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(), // SHA-256 des Tokens, nie das Token selbst
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		persistent: integer('persistent', { mode: 'boolean' }).notNull().default(false),
		userAgent: text('user_agent'),
		createdAt: createdAt()
	},
	(t) => [index('sessions_user_idx').on(t.userId)]
);

export const passwordResets = sqliteTable('password_resets', {
	tokenHash: text('token_hash').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	usedAt: integer('used_at', { mode: 'timestamp_ms' }),
	createdAt: createdAt()
});

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

/**
 * Rechte je Rolle, vom Admin unter Benutzer → Berechtigungen gepflegt.
 * Fehlende Paare werden beim Start aus den Standardrechten im Code ergänzt.
 */
export const rolePermissions = sqliteTable(
	'role_permissions',
	{
		role: text('role', { enum: ROLES }).notNull(),
		permission: text('permission').notNull(),
		allowed: integer('allowed', { mode: 'boolean' }).notNull().default(false),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [primaryKey({ columns: [t.role, t.permission] })]
);

export type User = typeof users.$inferSelect;
export type Party = typeof parties.$inferSelect;
