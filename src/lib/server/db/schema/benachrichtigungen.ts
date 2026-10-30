/**
 * Benachrichtigungen: was jede Person bekommen hat (für die Glocke), ihre
 * Geräte für Push und die Einstellungen des Admins – je Ereignis Gruppen und
 * einzelne Personen – sowie, was jemand für sich abgeschaltet hat.
 */
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { ROLES } from '$lib/permissions';
import { createdAt } from './common';
import { users } from './core';

export const notifications = sqliteTable(
	'notifications',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Ereignis aus dem Katalog, z. B. „auftrag.zugeordnet" */
		event: text('event').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull().default(''),
		/** Wohin ein Tipp führt, z. B. „/auftraege/12" */
		url: text('url').notNull().default('/'),
		/** Dieselbe Meldung an mehrere Personen – liest sie eine, ist sie für alle gelesen */
		batch: text('batch'),
		createdAt: createdAt(),
		readAt: integer('read_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('notifications_user_idx').on(t.userId, t.createdAt), index('notifications_batch_idx').on(t.batch)]
);

/** Ein Gerät für Push: im Browser über Web-Push, in der Android-App über Firebase */
export const PUSH_KINDS = ['web', 'fcm'] as const;

export const pushSubscriptions = sqliteTable(
	'push_subscriptions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: PUSH_KINDS }).notNull(),
		/** Web-Push: Endpunkt des Browsers; Firebase: das Gerätetoken */
		endpoint: text('endpoint').notNull(),
		p256dh: text('p256dh'),
		auth: text('auth'),
		userAgent: text('user_agent'),
		createdAt: createdAt(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
	},
	(t) => [uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)]
);

/** Admin: welche Gruppe welches Ereignis bekommt – fehlende Paare kommen beim Start aus dem Katalog */
export const notificationRules = sqliteTable(
	'notification_rules',
	{
		event: text('event').notNull(),
		role: text('role', { enum: ROLES }).notNull(),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [primaryKey({ columns: [t.event, t.role] })]
);

/** Admin: zusätzlich einzelne Personen je Ereignis */
export const notificationPeople = sqliteTable(
	'notification_people',
	{
		event: text('event').notNull(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.event, t.userId] })]
);

/** Was jemand für sich abgeschaltet hat */
export const notificationMutes = sqliteTable(
	'notification_mutes',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		event: text('event').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.event] })]
);

/*
 * Info-Mails: derselbe Aufbau wie Glocke und Push, aber eigene Auswahl – wer
 * etwas als Push bekommt, muss es nicht auch noch per Mail bekommen.
 */

/** Admin: welche Gruppe welches Ereignis als Info-Mail bekommt */
export const notificationMailRules = sqliteTable(
	'notification_mail_rules',
	{
		event: text('event').notNull(),
		role: text('role', { enum: ROLES }).notNull(),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [primaryKey({ columns: [t.event, t.role] })]
);

/** Admin: zusätzlich einzelne Personen je Ereignis per Info-Mail */
export const notificationMailPeople = sqliteTable(
	'notification_mail_people',
	{
		event: text('event').notNull(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.event, t.userId] })]
);

/** Welche Info-Mails jemand für sich abgeschaltet hat */
export const notificationMailMutes = sqliteTable(
	'notification_mail_mutes',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		event: text('event').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.event] })]
);
