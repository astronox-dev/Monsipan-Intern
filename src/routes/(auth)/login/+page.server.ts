import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import {
	clearFailures,
	createSession,
	findUserForLogin,
	hashPassword,
	isRateLimited,
	registerFailure,
	setSessionCookie,
	verifyPassword
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

/** Nur Pfade im Portal – „//fremd.at" und „/\fremd.at" (Browser lesen beides als fremde Adresse) nicht */
function safeNext(next: string | null): string {
	if (!next || !next.startsWith('/') || next[1] === '/' || next[1] === '\\' || /[\u0000-\u001f]/.test(next)) return '/';
	return next;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('weiter')));
	return { reset: url.searchParams.has('zurueckgesetzt') };
};

let dummyHash: Promise<string> | null = null;

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const remember = form.get('remember') === 'on';

		if (!identifier || !password) {
			return fail(400, { identifier, message: 'Bitte Benutzername oder E-Mail und Passwort eingeben.' });
		}

		const ip = getClientAddress();
		const key = `login:${ip}:${identifier.toLowerCase()}`;
		const ipKey = `login-ip:${ip}`;
		if (isRateLimited(key, 8) || isRateLimited(ipKey, 40)) {
			return fail(429, { identifier, message: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.' });
		}

		const user = await findUserForLogin(identifier);
		let ok = false;
		if (user) {
			ok = user.active && (await verifyPassword(user.passwordHash, password));
		} else {
			// Gleiche Rechenzeit wie bei existierenden Konten
			dummyHash ??= hashPassword('dummy-password');
			await verifyPassword(await dummyHash, password);
		}

		if (!user || !ok) {
			registerFailure(key);
			registerFailure(ipKey);
			const message =
				user && !user.active
					? 'Dieses Konto ist deaktiviert. Bitte an die Administration wenden.'
					: 'Benutzername/E-Mail oder Passwort stimmt nicht.';
			return fail(400, { identifier, message });
		}

		clearFailures(key);
		await db.update(users).set({ lastLoginAt: new Date(), lastSeenAt: new Date() }).where(eq(users.id, user.id));
		const session = await createSession(user.id, remember, request.headers.get('user-agent'));
		setSessionCookie(cookies, session.token, session.expiresAt, remember);

		redirect(303, user.mustChangePassword ? '/passwort-aendern' : safeNext(url.searchParams.get('weiter')));
	}
};
