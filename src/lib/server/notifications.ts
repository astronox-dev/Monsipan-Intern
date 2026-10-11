/**
 * Benachrichtigungen verschicken und lesen.
 *
 * `notify()` sucht die Empfänger (Gruppen und Personen aus den Einstellungen
 * des Admins, ohne wer es abgeschaltet hat, ohne wer es selbst ausgelöst hat,
 * nur wer es sehen darf), legt je Person einen Eintrag für die Glocke an,
 * sagt offenen Browsern Bescheid und schickt Push an ihre Geräte. Das läuft
 * im Hintergrund – die Antwort an den Auslöser wartet nicht darauf.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { can, ROLES, type Role } from '$lib/permissions';
import {
	isNotificationEvent,
	mayReceive,
	NOTIFICATION_EVENT_KEYS,
	NOTIFICATION_EVENTS,
	type NotificationEvent,
	type NotificationEventDef
} from '$lib/notifications';
import { db } from './db';
import { notificationMutes, notificationPeople, notificationRules, notifications, users } from './db/schema';
import { broadcast } from './events';
import { pushTo } from './push';

/* ------------------------------------------------------- Einstellungen */

let ensured: Promise<void> | null = null;

/** Fehlende Paare (Ereignis, Gruppe) aus den Vorgaben im Katalog anlegen – einmal je Start */
export function ensureNotificationRules(): Promise<void> {
	ensured ??= (async () => {
		const rows = await db.select({ event: notificationRules.event, role: notificationRules.role }).from(notificationRules).all();
		const known = new Set(rows.map((r) => `${r.event}|${r.role}`));
		const missing = NOTIFICATION_EVENT_KEYS.flatMap((event) =>
			ROLES.filter((role) => !known.has(`${event}|${role}`)).map((role) => ({
				event,
				role,
				enabled: (NOTIFICATION_EVENTS[event].defaults as readonly Role[]).includes(role)
			}))
		);
		if (missing.length) {
			await db.transaction(async (tx) => {
				for (const m of missing) await tx.insert(notificationRules).values(m).onConflictDoNothing();
			});
		}
	})();
	return ensured;
}

export interface NotificationSettings {
	/** Je Ereignis die Gruppen, die es bekommen */
	roles: Record<string, Role[]>;
	/** Je Ereignis zusätzliche Personen */
	people: Record<string, number[]>;
}

export async function notificationSettings(): Promise<NotificationSettings> {
	await ensureNotificationRules();
	const [rules, people] = await Promise.all([
		db.select().from(notificationRules).where(eq(notificationRules.enabled, true)).all(),
		db.select().from(notificationPeople).all()
	]);
	const out: NotificationSettings = { roles: {}, people: {} };
	for (const e of NOTIFICATION_EVENT_KEYS) {
		out.roles[e] = [];
		out.people[e] = [];
	}
	for (const r of rules) if (isNotificationEvent(r.event)) out.roles[r.event].push(r.role);
	for (const p of people) if (isNotificationEvent(p.event)) out.people[p.event].push(p.userId);
	return out;
}

/** Den ganzen Stand aus dem Formular übernehmen */
export async function saveNotificationSettings(roles: Set<string>, people: Set<string>) {
	await db.transaction(async (tx) => {
		for (const event of NOTIFICATION_EVENT_KEYS) {
			for (const role of ROLES) {
				const enabled = roles.has(`${event}|${role}`);
				await tx
					.insert(notificationRules)
					.values({ event, role, enabled, updatedAt: new Date() })
					.onConflictDoUpdate({ target: [notificationRules.event, notificationRules.role], set: { enabled, updatedAt: new Date() } });
			}
		}
		await tx.delete(notificationPeople);
		for (const key of people) {
			const [event, id] = key.split('|');
			if (isNotificationEvent(event) && /^\d+$/.test(id)) await tx.insert(notificationPeople).values({ event, userId: Number(id) }).onConflictDoNothing();
		}
	});
}

/** Zurück auf die Vorgaben im Katalog: Gruppen wie ausgeliefert, keine Personen */
export async function resetNotificationSettings() {
	await db.transaction(async (tx) => {
		await tx.delete(notificationRules);
		await tx.delete(notificationPeople);
	});
	ensured = null;
	await ensureNotificationRules();
}

/* ----------------------------------------------------------- Empfänger */

const activeUser = and(eq(users.active, true), isNull(users.deletedAt));

/** Wer diese Benachrichtigung bekommt – ohne den Auslöser */
export async function recipientsFor(event: NotificationEvent, partyId: number | null | undefined, actorId?: number | null): Promise<number[]> {
	await ensureNotificationRules();
	const [rules, people, mutes] = await Promise.all([
		db
			.select({ role: notificationRules.role })
			.from(notificationRules)
			.where(and(eq(notificationRules.event, event), eq(notificationRules.enabled, true)))
			.all(),
		db.select({ userId: notificationPeople.userId }).from(notificationPeople).where(eq(notificationPeople.event, event)).all(),
		db.select({ userId: notificationMutes.userId }).from(notificationMutes).where(eq(notificationMutes.event, event)).all()
	]);
	const roles = rules.map((r) => r.role);
	const ids = people.map((p) => p.userId);
	const match: SQL[] = [];
	if (roles.length) match.push(inArray(users.role, roles));
	if (ids.length) match.push(inArray(users.id, ids));
	if (!match.length) return [];
	const candidates = await db
		.select({ id: users.id, role: users.role, partyId: users.partyId })
		.from(users)
		.where(and(activeUser, or(...match)))
		.all();
	const muted = new Set(mutes.map((m) => m.userId));
	return candidates.filter((c) => c.id !== actorId && !muted.has(c.id) && mayReceive(c, event, partyId, can)).map((c) => c.id);
}

/* ------------------------------------------------------------ Versand */

export interface NotifyInput {
	event: NotificationEvent;
	title: string;
	body?: string;
	/** Wohin ein Tipp führt */
	url: string;
	/** Partie, um die es geht – Partieführer und Arbeiter bekommen es nur für die eigene */
	partyId?: number | null;
	/** Wer es ausgelöst hat – bekommt selbst nichts */
	actorId?: number | null;
	/** Bekommen es auf jeden Fall (z. B. wessen Urlaub es ist) – sofern sie es sehen dürfen und es nicht abgeschaltet haben */
	userIds?: number[];
}

/** Die fest genannten Empfänger: aktiv, mit dem nötigen Recht, nicht stummgeschaltet, nicht der Auslöser */
async function directRecipients(event: NotificationEvent, userIds: number[], actorId?: number | null): Promise<number[]> {
	const wanted = userIds.filter((id) => id !== actorId);
	if (!wanted.length) return [];
	const [people, mutes] = await Promise.all([
		db
			.select({ id: users.id, role: users.role, partyId: users.partyId })
			.from(users)
			.where(and(activeUser, inArray(users.id, wanted)))
			.all(),
		db.select({ userId: notificationMutes.userId }).from(notificationMutes).where(eq(notificationMutes.event, event)).all()
	]);
	const muted = new Set(mutes.map((m) => m.userId));
	return people.filter((p) => !muted.has(p.id) && can(p.role, NOTIFICATION_EVENTS[event].requires)).map((p) => p.id);
}

async function deliver(input: NotifyInput) {
	const found = await recipientsFor(input.event, input.partyId, input.actorId);
	const direct = input.userIds?.length ? await directRecipients(input.event, input.userIds, input.actorId) : [];
	const ids = [...new Set([...found, ...direct])];
	if (!ids.length) return;
	const title = input.title.slice(0, 200);
	const body = (input.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
	const rows = await db
		.insert(notifications)
		.values(ids.map((userId) => ({ userId, event: input.event, title, body, url: input.url })))
		.returning({ id: notifications.id, userId: notifications.userId });
	// Offene Browser laden ihre Glocke neu – nur die Nummern, nicht der Inhalt
	broadcast('notifications', { userIds: ids });
	// Ein Tipp auf die Push-Meldung führt über den eigenen Eintrag: der wird dabei gelesen
	await pushTo(rows.map((r) => ({ userId: r.userId, payload: { title, body, url: `/benachrichtigungen/${r.id}`, tag: `${input.event}:${input.url}` } })));
}

/** Benachrichtigung auslösen – im Hintergrund, Fehler landen nur im Log */
export function notify(input: NotifyInput): void {
	deliver(input).catch((err) => console.error('[benachrichtigung]', input.event, err));
}

/* ------------------------------------------------------------- Lesen */

export function listNotifications(userId: number, limit = 100) {
	return db
		.select({
			id: notifications.id,
			event: notifications.event,
			title: notifications.title,
			body: notifications.body,
			url: notifications.url,
			createdAt: notifications.createdAt,
			readAt: notifications.readAt
		})
		.from(notifications)
		.where(eq(notifications.userId, userId))
		.orderBy(desc(notifications.createdAt), desc(notifications.id))
		.limit(limit)
		.all();
}

/** Für die Glocke: wie viele ungelesen, und die neueste (für den Hinweis beim Eintreffen) */
export async function unreadSummary(userId: number) {
	const [count, latest] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(notifications)
			.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
			.get(),
		db
			.select({ id: notifications.id, title: notifications.title, body: notifications.body, url: notifications.url })
			.from(notifications)
			.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
			.orderBy(desc(notifications.id))
			.limit(1)
			.get()
	]);
	return { unread: count?.n ?? 0, latest: latest ?? null };
}

/** Ein Eintrag dieser Person – zum Öffnen */
export function getNotification(userId: number, id: number) {
	return db
		.select({ id: notifications.id, url: notifications.url, readAt: notifications.readAt })
		.from(notifications)
		.where(and(eq(notifications.userId, userId), eq(notifications.id, id)))
		.get();
}

/** Eine bzw. alle als gelesen markieren */
export async function markRead(userId: number, id?: number) {
	const where = [eq(notifications.userId, userId), isNull(notifications.readAt)];
	if (id != null) where.push(eq(notifications.id, id));
	await db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(and(...where));
}

/** Alte Benachrichtigungen räumt die nächtliche Wartung weg */
export const KEEP_NOTIFICATIONS_DAYS = 90;

export async function purgeOldNotifications(now = new Date()) {
	await db.delete(notifications).where(lt(notifications.createdAt, new Date(now.getTime() - KEEP_NOTIFICATIONS_DAYS * 86_400_000)));
}

/* ---------------------------------------------------- Eigene Auswahl */

/**
 * Für die Seite der Person: welche Ereignisse sie bekommt (über ihre Gruppe
 * oder persönlich) und welche sie abgeschaltet hat.
 */
export async function myNotificationEvents(user: { id: number; role: Role; partyId: number | null }) {
	const [settings, mutes] = await Promise.all([
		notificationSettings(),
		db.select({ event: notificationMutes.event }).from(notificationMutes).where(eq(notificationMutes.userId, user.id)).all()
	]);
	const muted = new Set(mutes.map((m) => m.event));
	return NOTIFICATION_EVENT_KEYS.filter((e) => {
		const def: NotificationEventDef = NOTIFICATION_EVENTS[e];
		const listed = settings.roles[e].includes(user.role) || settings.people[e].includes(user.id);
		// Ob es überhaupt ankommen kann: sehen dürfen, bei Partie-Ereignissen eine Partie haben oder alle sehen
		return listed && can(user.role, def.requires) && (!def.all || can(user.role, def.all) || user.partyId != null);
	}).map((e) => ({ event: e, viaGroup: settings.roles[e].includes(user.role), muted: muted.has(e) }));
}

export async function setMuted(userId: number, event: NotificationEvent, muted: boolean) {
	if (muted) await db.insert(notificationMutes).values({ userId, event }).onConflictDoNothing();
	else await db.delete(notificationMutes).where(and(eq(notificationMutes.userId, userId), eq(notificationMutes.event, event)));
}
