/**
 * Benachrichtigungen verschicken und lesen.
 *
 * `notify()` sucht die Empfänger (Gruppen und Personen aus den Einstellungen
 * des Admins, ohne wer es abgeschaltet hat, ohne wer es selbst ausgelöst hat,
 * nur wer es sehen darf), legt je Person einen Eintrag für die Glocke an,
 * sagt offenen Browsern Bescheid und schickt Push an ihre Geräte. Dasselbe
 * mit eigener Auswahl als Info-Mail. Das läuft im Hintergrund – die Antwort
 * an den Auslöser wartet nicht darauf.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { can, ROLES, type Role } from '$lib/permissions';
import {
	isNotificationEvent,
	mayReceive,
	NOTIFICATION_EVENT_KEYS,
	NOTIFICATION_EVENTS,
	type NotificationChannel,
	type NotificationEvent,
	type NotificationEventDef
} from '$lib/notifications';
import { db } from './db';
import {
	notificationMailMutes,
	notificationMailPeople,
	notificationMailRules,
	notificationMutes,
	notificationPeople,
	notificationRules,
	notifications,
	users
} from './db/schema';
import { broadcast } from './events';
import { infoMail, isMailConfigured, sendMail } from './mail';
import { pushTo } from './push';
import { getSettings } from './settings';

/* ------------------------------------------------------- Einstellungen */

const TABLES = {
	push: { rules: notificationRules, people: notificationPeople, mutes: notificationMutes },
	mail: { rules: notificationMailRules, people: notificationMailPeople, mutes: notificationMailMutes }
};
/** Beide Wege haben dieselben Spalten – für die Typen genügt der eine */
const tables = (channel: NotificationChannel) => TABLES[channel] as unknown as typeof TABLES.push;

const ensured: Partial<Record<NotificationChannel, Promise<void>>> = {};
/** Nach „Auf Standard zurücksetzen": die Vorgaben aus dem Katalog, nicht die alten Einstellungen */
let catalogOnly = false;

/** Wer ein Ereignis von Haus aus bekommt */
async function defaultsFor(channel: NotificationChannel, firstTime: boolean): Promise<(e: NotificationEvent) => readonly Role[]> {
	if (channel === 'push') return (e) => NOTIFICATION_EVENTS[e].defaults;
	const mail = (e: NotificationEvent) => (NOTIFICATION_EVENTS[e] as NotificationEventDef).mailDefaults ?? [];
	if (!firstTime || catalogOnly) return mail;
	// Beim ersten Mal: die bisherigen „Warn-Mails zum Mindestbestand" aus den Einstellungen übernehmen
	const s = await getSettings();
	return (e) => (e === 'lager.mindestbestand' ? (s.alertEmailsEnabled ? s.alertRoles : []) : mail(e));
}

/** Fehlende Paare (Ereignis, Gruppe) aus den Vorgaben im Katalog anlegen – einmal je Start und Weg */
export function ensureNotificationRules(channel: NotificationChannel = 'push'): Promise<void> {
	ensured[channel] ??= (async () => {
		const t = tables(channel);
		const rows = await db.select({ event: t.rules.event, role: t.rules.role }).from(t.rules).all();
		const known = new Set(rows.map((r) => `${r.event}|${r.role}`));
		const defaults = await defaultsFor(channel, rows.length === 0);
		const missing = NOTIFICATION_EVENT_KEYS.flatMap((event) =>
			ROLES.filter((role) => !known.has(`${event}|${role}`)).map((role) => ({
				event,
				role,
				enabled: defaults(event).includes(role)
			}))
		);
		if (missing.length) {
			await db.transaction(async (tx) => {
				for (const m of missing) await tx.insert(t.rules).values(m).onConflictDoNothing();
			});
		}
	})();
	return ensured[channel]!;
}

export interface NotificationSettings {
	/** Je Ereignis die Gruppen, die es bekommen */
	roles: Record<string, Role[]>;
	/** Je Ereignis zusätzliche Personen */
	people: Record<string, number[]>;
}

export async function notificationSettings(channel: NotificationChannel = 'push'): Promise<NotificationSettings> {
	await ensureNotificationRules(channel);
	const t = tables(channel);
	const [rules, people] = await Promise.all([db.select().from(t.rules).where(eq(t.rules.enabled, true)).all(), db.select().from(t.people).all()]);
	const out: NotificationSettings = { roles: {}, people: {} };
	for (const e of NOTIFICATION_EVENT_KEYS) {
		out.roles[e] = [];
		out.people[e] = [];
	}
	for (const r of rules) if (isNotificationEvent(r.event)) out.roles[r.event].push(r.role);
	for (const p of people) if (isNotificationEvent(p.event)) out.people[p.event].push(p.userId);
	return out;
}

/** Den ganzen Stand eines Wegs aus dem Formular übernehmen */
export async function saveNotificationSettings(roles: Set<string>, people: Set<string>, channel: NotificationChannel = 'push') {
	await ensureNotificationRules(channel);
	const t = tables(channel);
	await db.transaction(async (tx) => {
		for (const event of NOTIFICATION_EVENT_KEYS) {
			for (const role of ROLES) {
				const enabled = roles.has(`${event}|${role}`);
				await tx
					.insert(t.rules)
					.values({ event, role, enabled, updatedAt: new Date() })
					.onConflictDoUpdate({ target: [t.rules.event, t.rules.role], set: { enabled, updatedAt: new Date() } });
			}
		}
		await tx.delete(t.people);
		for (const key of people) {
			const [event, id] = key.split('|');
			if (isNotificationEvent(event) && /^\d+$/.test(id)) await tx.insert(t.people).values({ event, userId: Number(id) }).onConflictDoNothing();
		}
	});
}

/** Zurück auf die Vorgaben im Katalog – beide Wege: Gruppen wie ausgeliefert, keine Personen */
export async function resetNotificationSettings() {
	await db.transaction(async (tx) => {
		for (const channel of ['push', 'mail'] as const) {
			await tx.delete(tables(channel).rules);
			await tx.delete(tables(channel).people);
		}
	});
	catalogOnly = true;
	for (const channel of ['push', 'mail'] as const) {
		delete ensured[channel];
		await ensureNotificationRules(channel);
	}
}

/* ----------------------------------------------------------- Empfänger */

const activeUser = and(eq(users.active, true), isNull(users.deletedAt));

/** Wer diese Benachrichtigung auf diesem Weg bekommt – ohne den Auslöser */
export async function recipientsFor(
	event: NotificationEvent,
	partyId: number | null | undefined,
	actorId?: number | null,
	channel: NotificationChannel = 'push'
): Promise<number[]> {
	await ensureNotificationRules(channel);
	const t = tables(channel);
	const [rules, people, mutes] = await Promise.all([
		db
			.select({ role: t.rules.role })
			.from(t.rules)
			.where(and(eq(t.rules.event, event), eq(t.rules.enabled, true)))
			.all(),
		db.select({ userId: t.people.userId }).from(t.people).where(eq(t.people.event, event)).all(),
		db.select({ userId: t.mutes.userId }).from(t.mutes).where(eq(t.mutes.event, event)).all()
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
	/** Bekommen auf jeden Fall die Info-Mail (z. B. wer das Angebot angelegt hat) – sofern sie es sehen dürfen und nicht abgeschaltet haben */
	mailUserIds?: number[];
	/** Adresse des Portals für den Link in der Info-Mail – sonst ORIGIN aus der Umgebung */
	origin?: string;
}

/** Die fest genannten Empfänger: aktiv, mit dem nötigen Recht, nicht stummgeschaltet, nicht der Auslöser */
async function directRecipients(event: NotificationEvent, userIds: number[], actorId?: number | null, channel: NotificationChannel = 'push'): Promise<number[]> {
	const wanted = userIds.filter((id) => id !== actorId);
	if (!wanted.length) return [];
	const t = tables(channel);
	const [people, mutes] = await Promise.all([
		db
			.select({ id: users.id, role: users.role, partyId: users.partyId })
			.from(users)
			.where(and(activeUser, inArray(users.id, wanted)))
			.all(),
		db.select({ userId: t.mutes.userId }).from(t.mutes).where(eq(t.mutes.event, event)).all()
	]);
	const muted = new Set(mutes.map((m) => m.userId));
	return people.filter((p) => !muted.has(p.id) && can(p.role, NOTIFICATION_EVENTS[event].requires)).map((p) => p.id);
}

const cleanTitle = (t: string) => t.slice(0, 200);
const cleanBody = (b: string | undefined) => (b ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);

/** Wer die Info-Mail bekommt: ausgewählt oder fest genannt, mit E-Mail-Adresse – je Adresse einmal */
export async function mailRecipientsFor(input: Pick<NotifyInput, 'event' | 'partyId' | 'actorId' | 'mailUserIds'>): Promise<string[]> {
	const found = await recipientsFor(input.event, input.partyId, input.actorId, 'mail');
	const direct = input.mailUserIds?.length ? await directRecipients(input.event, input.mailUserIds, input.actorId, 'mail') : [];
	const ids = [...new Set([...found, ...direct])];
	if (!ids.length) return [];
	const rows = await db.select({ email: users.email }).from(users).where(inArray(users.id, ids)).all();
	return [...new Set(rows.map((r) => r.email?.trim().toLowerCase() ?? '').filter((e) => e.includes('@')))];
}

async function deliverMail(input: NotifyInput) {
	if (!isMailConfigured()) return;
	const to = await mailRecipientsFor(input);
	if (!to.length) return;
	const origin = (env.ORIGIN || input.origin || '').replace(/\/+$/, '');
	const info = {
		event: NOTIFICATION_EVENTS[input.event].label,
		title: cleanTitle(input.title),
		body: cleanBody(input.body),
		link: /^https?:\/\//.test(origin) ? `${origin}${input.url}` : null
	};
	// Je Person eine eigene Mail – niemand sieht die Adressen der anderen
	for (const address of to) await sendMail(infoMail(address, info));
}

async function deliver(input: NotifyInput) {
	await Promise.all([deliverPush(input), deliverMail(input)]);
}

async function deliverPush(input: NotifyInput) {
	const found = await recipientsFor(input.event, input.partyId, input.actorId);
	const direct = input.userIds?.length ? await directRecipients(input.event, input.userIds, input.actorId) : [];
	const ids = [...new Set([...found, ...direct])];
	if (!ids.length) return;
	const title = cleanTitle(input.title);
	const body = cleanBody(input.body);
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
 * oder persönlich) und welche sie abgeschaltet hat – je Weg.
 */
export async function myNotificationEvents(user: { id: number; role: Role; partyId: number | null }) {
	const mine = async (channel: NotificationChannel) => {
		const t = tables(channel);
		const [settings, mutes] = await Promise.all([
			notificationSettings(channel),
			db.select({ event: t.mutes.event }).from(t.mutes).where(eq(t.mutes.userId, user.id)).all()
		]);
		const muted = new Set(mutes.map((m) => m.event));
		return NOTIFICATION_EVENT_KEYS.filter((e) => {
			const def: NotificationEventDef = NOTIFICATION_EVENTS[e];
			const listed = settings.roles[e].includes(user.role) || settings.people[e].includes(user.id);
			// Ob es überhaupt ankommen kann: sehen dürfen, bei Partie-Ereignissen eine Partie haben oder alle sehen
			return listed && can(user.role, def.requires) && (!def.all || can(user.role, def.all) || user.partyId != null);
		}).map((e) => ({ event: e, viaGroup: settings.roles[e].includes(user.role), muted: muted.has(e) }));
	};
	const [push, mail] = await Promise.all([mine('push'), mine('mail')]);
	return { push, mail };
}

export async function setMuted(userId: number, event: NotificationEvent, muted: boolean, channel: NotificationChannel = 'push') {
	const t = tables(channel);
	if (muted) await db.insert(t.mutes).values({ userId, event }).onConflictDoNothing();
	else await db.delete(t.mutes).where(and(eq(t.mutes.userId, userId), eq(t.mutes.event, event)));
}
