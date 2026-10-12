import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { can, ROLES, type Role } from '$lib/permissions';
import { isNotificationEvent } from '$lib/notifications';
import { db } from '$lib/server/db';
import { pushSubscriptions, users } from '$lib/server/db/schema';
import { requirePermission } from '$lib/server/guard';
import { notificationSettings, resetNotificationSettings, saveNotificationSettings } from '$lib/server/notifications';
import { firebaseInfo, parseServiceAccount, saveFirebaseAccount } from '$lib/server/push';
import { mailInfo } from '$lib/server/mail';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requirePermission(locals, 'benachrichtigungen.sehen');
	const [settings, mailSettings, people, devices, firebase] = await Promise.all([
		notificationSettings('push'),
		notificationSettings('mail'),
		db
			.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username, role: users.role, email: users.email })
			.from(users)
			.where(and(eq(users.active, true), isNull(users.deletedAt)))
			.orderBy(asc(users.firstName), asc(users.lastName))
			.all(),
		db
			.select({ kind: pushSubscriptions.kind, n: sql<number>`count(*)`.mapWith(Number) })
			.from(pushSubscriptions)
			.groupBy(pushSubscriptions.kind)
			.all(),
		firebaseInfo()
	]);
	// Für die Info-Mails: wer überhaupt eine Adresse hat – je Gruppe gezählt
	const withEmail = people.filter((p) => !!p.email?.trim());
	const emailsPerRole = Object.fromEntries(ROLES.map((r) => [r, withEmail.filter((p) => p.role === r).length])) as Record<Role, number>;
	return {
		settings,
		mailSettings,
		people: people.map(({ email, ...p }) => ({ ...p, hasEmail: !!email?.trim() })),
		mail: { ...mailInfo(), emailsPerRole },
		push: {
			appReady: !!firebase,
			firebase,
			webDevices: devices.find((d) => d.kind === 'web')?.n ?? 0,
			appDevices: devices.find((d) => d.kind === 'fcm')?.n ?? 0
		},
		canEdit: can(user.role, 'benachrichtigungen.bearbeiten')
	};
};

const isRole = (v: string): v is Role => (ROLES as readonly string[]).includes(v);

export const actions: Actions = {
	/** Beide Wege auf einmal: rolle/person für Glocke und Push, mail-rolle/mail-person für die Info-Mail */
	save: async ({ request, locals }) => {
		requirePermission(locals, 'benachrichtigungen.bearbeiten');
		const form = await request.formData();
		const read = (prefix: string) => {
			const roles = new Set<string>();
			for (const v of form.getAll(`${prefix}rolle`).map(String)) {
				const [event, role] = v.split('|');
				if (isNotificationEvent(event) && isRole(role)) roles.add(`${event}|${role}`);
			}
			const people = new Set<string>();
			for (const v of form.getAll(`${prefix}person`).map(String)) {
				const [event, id] = v.split('|');
				if (isNotificationEvent(event) && /^\d+$/.test(id)) people.add(`${event}|${id}`);
			}
			return { roles, people };
		};
		const push = read('');
		const mail = read('mail-');
		await saveNotificationSettings(push.roles, push.people, 'push');
		await saveNotificationSettings(mail.roles, mail.people, 'mail');
		return { saved: true };
	},

	/** Dienstkonto-Schlüssel aus Firebase hochladen – damit kommt Push in der Android-App an */
	firebase: async ({ request, locals }) => {
		requirePermission(locals, 'benachrichtigungen.bearbeiten');
		const file = (await request.formData()).get('schluessel');
		if (!(file instanceof File) || file.size === 0) return fail(400, { firebaseMessage: 'Bitte die JSON-Datei auswählen.' });
		if (file.size > 20_000) return fail(400, { firebaseMessage: 'Die Datei ist zu groß für einen Dienstkonto-Schlüssel.' });
		const parsed = parseServiceAccount(await file.text());
		if ('message' in parsed) return fail(400, { firebaseMessage: parsed.message });
		await saveFirebaseAccount(parsed);
		return { firebaseSaved: true };
	},

	firebaseRemove: async ({ locals }) => {
		requirePermission(locals, 'benachrichtigungen.bearbeiten');
		await saveFirebaseAccount(null);
		return { firebaseRemoved: true };
	},

	reset: async ({ locals }) => {
		requirePermission(locals, 'benachrichtigungen.bearbeiten');
		await resetNotificationSettings();
		return { reset: true };
	}
};
