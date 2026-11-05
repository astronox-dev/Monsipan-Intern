import { fail } from '@sveltejs/kit';
import { createPasswordReset, findUserForLogin, isRateLimited, registerFailure } from '$lib/server/auth';
import { passwordResetMail, sendMail } from '$lib/server/mail';
import { fullName } from '$lib/format';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, getClientAddress, url }) => {
		const identifier = String((await request.formData()).get('identifier') ?? '').trim().normalize('NFC');
		if (!identifier) return fail(400, { identifier, message: 'Bitte Benutzername oder E-Mail eingeben.' });

		const key = `reset:${getClientAddress()}`;
		if (isRateLimited(key, 5, 60 * 60_000)) {
			return fail(429, { identifier, message: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
		}
		registerFailure(key, 60 * 60_000);

		const user = await findUserForLogin(identifier);
		if (user?.active && user.email) {
			const token = await createPasswordReset(user.id);
			await sendMail(passwordResetMail(user.email, fullName(user), `${url.origin}/passwort-zuruecksetzen/${token}`));
		}
		// Immer dieselbe Antwort – verrät nicht, welche Konten existieren
		return { sent: true };
	}
};
