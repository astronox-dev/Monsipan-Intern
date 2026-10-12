import { fail } from '@sveltejs/kit';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword, invalidateUserSessions, MIN_PASSWORD_LENGTH, verifyPassword } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { parties, sessions, users } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/guard';
import { myNotificationEvents, setMuted } from '$lib/server/notifications';
import { isMailConfigured } from '$lib/server/mail';
import { isNotificationEvent } from '$lib/notifications';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const row = await db.select({ n: sql<number>`count(*)` }).from(sessions).where(eq(sessions.userId, user.id)).get();
	const party = user.partyId ? await db.select({ name: parties.name }).from(parties).where(eq(parties.id, user.partyId)).get() : null;
	return {
		sessionCount: Number(row?.n ?? 1),
		partyName: party?.name ?? null,
		myEvents: await myNotificationEvents(user),
		mailConfigured: isMailConfigured()
	};
};

export const actions: Actions = {
	/** Eine Benachrichtigung für sich ab- bzw. wieder einschalten – Glocke/Push oder Info-Mail */
	mute: async ({ request, locals }) => {
		const user = requireUser(locals);
		const f = await request.formData();
		const event = String(f.get('event') ?? '');
		if (!isNotificationEvent(event)) return fail(400, { message: 'Unbekannte Benachrichtigung' });
		await setMuted(user.id, event, f.get('aus') === '1', f.get('kanal') === 'mail' ? 'mail' : 'push');
		return { muted: true };
	},
	profile: async ({ request, locals }) => {
		const user = requireUser(locals);
		const f = await request.formData();
		const parsed = z
			.object({
				firstName: z.string().trim().min(1, 'Vorname fehlt').max(60),
				lastName: z.string().trim().max(60),
				email: z
					.string()
					.trim()
					.toLowerCase()
					.max(120)
					.refine((s) => s === '' || z.email().safeParse(s).success, 'Ungültige E-Mail-Adresse')
					.transform((s) => s || null)
			})
			.safeParse({ firstName: f.get('firstName') ?? '', lastName: f.get('lastName') ?? '', email: f.get('email') ?? '' });
		if (!parsed.success) return fail(400, { form: 'profile', message: parsed.error.issues[0].message });
		if (parsed.data.email) {
			const taken = await db
				.select({ id: users.id })
				.from(users)
				.where(and(eq(users.email, parsed.data.email), ne(users.id, user.id)))
				.get();
			if (taken) return fail(400, { form: 'profile', message: 'Diese E-Mail-Adresse gehört schon zu einem anderen Konto.' });
		}
		await db.update(users).set(parsed.data).where(eq(users.id, user.id));
		return { form: 'profile', ok: true };
	},
	password: async ({ request, locals }) => {
		const user = requireUser(locals);
		const f = await request.formData();
		const current = String(f.get('current') ?? '');
		const password = String(f.get('password') ?? '');
		const confirm = String(f.get('confirm') ?? '');
		const row = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id)).get();
		if (!row || !(await verifyPassword(row.hash, current))) return fail(400, { form: 'password', message: 'Das aktuelle Passwort stimmt nicht.' });
		if (password.length < MIN_PASSWORD_LENGTH) return fail(400, { form: 'password', message: `Das neue Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.` });
		if (password !== confirm) return fail(400, { form: 'password', message: 'Die beiden neuen Passwörter stimmen nicht überein.' });
		await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, user.id));
		await invalidateUserSessions(user.id, locals.sessionToken ?? undefined);
		return { form: 'password', ok: true };
	},
	sessions: async ({ locals }) => {
		const user = requireUser(locals);
		await invalidateUserSessions(user.id, locals.sessionToken ?? undefined);
		return { form: 'sessions', ok: true };
	}
};
