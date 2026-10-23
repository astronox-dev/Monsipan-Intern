import { fail } from '@sveltejs/kit';
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	createPasswordReset,
	generatePassword,
	hashPassword,
	invalidateUserSessions,
	isRateLimited,
	registerFailure,
	verifyPassword
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { movements, parties, users } from '$lib/server/db/schema';
import { intOrNull, requirePermission } from '$lib/server/guard';
import { inviteMail, isMailConfigured, passwordResetMail, sendMail } from '$lib/server/mail';
import { partyOptions } from '$lib/server/options';
import { effectiveRole } from '$lib/server/lead';
import { fullName } from '$lib/format';
import { mayHaveParty, needsParty, ROLE_LABELS, ROLES, type Role } from '$lib/permissions';
import { canBecomeOwner, denyReason, type UserAction, type UserRef } from '$lib/user-rules';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePermission(locals, 'benutzer.sehen');
	const [list, partyList] = await Promise.all([
		db
			.select({
				id: users.id,
				username: users.username,
				email: users.email,
				firstName: users.firstName,
				lastName: users.lastName,
				role: users.role,
				partyId: users.partyId,
				partyName: parties.name,
				active: users.active,
				owner: users.owner,
				mustChangePassword: users.mustChangePassword,
				timesheetExempt: users.timesheetExempt,
				leaveAccountExempt: users.leaveAccountExempt,
				leadUntil: users.leadUntil,
				lastLoginAt: users.lastLoginAt,
				lastSeenAt: users.lastSeenAt
			})
			.from(users)
			.leftJoin(parties, eq(parties.id, users.partyId))
			.where(isNull(users.deletedAt))
			.orderBy(asc(users.active), asc(users.firstName), asc(users.username))
			.all(),
		partyOptions()
	]);
	list.sort((a, b) => Number(b.active) - Number(a.active));
	// Vorübergehend Partieführer – nur, solange es gilt
	const people = list.map((u) => ({ ...u, leadUntil: effectiveRole(u.role, u.leadUntil) !== u.role ? u.leadUntil : null }));
	return { users: people, parties: partyList, mailConfigured: isMailConfigured() };
};

const UserSchema = z.object({
	firstName: z.string().trim().min(1, 'Vorname fehlt').max(60),
	lastName: z.string().trim().max(60),
	username: z
		.string()
		.trim()
		.toLowerCase()
		.min(2, 'Benutzername zu kurz')
		.max(40)
		.regex(/^[a-z0-9._-]+$/, 'Nur Kleinbuchstaben, Ziffern, Punkt, Minus und Unterstrich'),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.max(120)
		.refine((s) => s === '' || z.email().safeParse(s).success, 'Ungültige E-Mail-Adresse')
		.transform((s) => s || null),
	role: z.enum(ROLES)
});

/**
 * Liest das Formular; Partieführer und Arbeiter brauchen eine aktive Partie.
 * Fehlt die Rolle (etwa beim gesperrten Inhaber-Konto), gilt die bisherige.
 */
async function readUser(f: FormData, currentRole: Role = 'arbeiter') {
	const parsed = UserSchema.safeParse({
		firstName: f.get('firstName') ?? '',
		lastName: f.get('lastName') ?? '',
		username: f.get('username') ?? '',
		email: f.get('email') ?? '',
		role: f.get('role') ?? currentRole
	});
	if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0].message };
	// Partieführer und Arbeiter brauchen eine Partie; Leitung und Büro dürfen eine haben
	let partyId: number | null = null;
	if (mayHaveParty(parsed.data.role)) {
		partyId = intOrNull(f.get('partyId'));
		const party = partyId
			? await db.select({ active: parties.active }).from(parties).where(eq(parties.id, partyId)).get()
			: null;
		if (partyId && !party?.active) return { ok: false as const, message: 'Diese Partie gibt es nicht (mehr).' };
		if (needsParty(parsed.data.role) && !party?.active) {
			return { ok: false as const, message: `${ROLE_LABELS[parsed.data.role]} müssen einer Partie zugeordnet sein.` };
		}
	}
	return {
		ok: true as const,
		data: { ...parsed.data, partyId, timesheetExempt: f.get('timesheetExempt') === 'on', leaveAccountExempt: f.get('leaveAccountExempt') === 'on' }
	};
}

async function uniqueConflict(username: string, email: string | null, exceptId?: number) {
	const byName = await db
		.select({ id: users.id })
		.from(users)
		.where(exceptId ? and(eq(users.username, username), ne(users.id, exceptId)) : eq(users.username, username))
		.get();
	if (byName) return 'Dieser Benutzername ist vergeben.';
	if (email) {
		const byMail = await db
			.select({ id: users.id })
			.from(users)
			.where(exceptId ? and(eq(users.email, email), ne(users.id, exceptId)) : eq(users.email, email))
			.get();
		if (byMail) return 'Diese E-Mail-Adresse gehört schon zu einem anderen Konto.';
	}
	return null;
}

/** Zielkonto laden – für die Inhaber-Regeln braucht es Rolle, Inhaber-Kennzeichen und Status */
function loadTarget(id: number) {
	return db
		.select({ id: users.id, role: users.role, owner: users.owner, active: users.active, deletedAt: users.deletedAt })
		.from(users)
		.where(eq(users.id, id))
		.get();
}

async function activeAdminCount(exceptId: number) {
	const row = await db
		.select({ n: sql<number>`count(*)` })
		.from(users)
		.where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptId)))
		.get();
	return Number(row?.n ?? 0);
}

export const actions: Actions = {
	create: async ({ request, locals, url }) => {
		requirePermission(locals, 'benutzer.erstellen');
		const f = await request.formData();
		const parsed = await readUser(f);
		if (!parsed.ok) return fail(400, { message: parsed.message });
		const d = parsed.data;
		const conflict = await uniqueConflict(d.username, d.email);
		if (conflict) return fail(400, { message: conflict });

		const invite = f.get('mode') === 'mail' && d.email && isMailConfigured();
		const tempPassword = invite ? null : generatePassword();
		const created = await db
			.insert(users)
			.values({ ...d, passwordHash: await hashPassword(tempPassword ?? generatePassword(24)), mustChangePassword: !invite })
			.returning({ id: users.id })
			.get();
		if (invite) {
			const token = await createPasswordReset(created.id, 7 * 86_400_000);
			const sent = await sendMail(inviteMail(d.email!, fullName(d), d.username, `${url.origin}/passwort-zuruecksetzen/${token}`));
			return { created: { name: fullName(d), username: d.username, invited: sent, password: null } };
		}
		return { created: { name: fullName(d), username: d.username, invited: false, password: tempPassword } };
	},

	update: async ({ request, locals }) => {
		const me = requirePermission(locals, 'benutzer.bearbeiten');
		const f = await request.formData();
		const id = intOrNull(f.get('id'));
		if (!id) return fail(400, { message: 'Benutzer fehlt' });
		const current = await loadTarget(id);
		if (!current || current.deletedAt) return fail(400, { message: 'Benutzer nicht gefunden.' });
		const parsed = await readUser(f, current.role);
		if (!parsed.ok) return fail(400, { message: parsed.message });
		const d = parsed.data;
		const active = f.get('active') === 'on';
		const conflict = await uniqueConflict(d.username, d.email, id);
		if (conflict) return fail(400, { message: conflict });
		if (id === me.id && (!active || d.role !== 'admin')) {
			return fail(400, { message: 'Du kannst dich nicht selbst deaktivieren oder dir die Admin-Rolle nehmen.' });
		}
		const action: UserAction = d.role !== current.role ? 'role' : current.active && !active ? 'deactivate' : 'edit';
		const denied = denyReason(me, current, action);
		if (denied) return fail(403, { message: denied });
		if (current.role === 'admin' && current.active && (d.role !== 'admin' || !active) && (await activeAdminCount(id)) === 0) {
			return fail(400, { message: 'Es muss mindestens ein aktiver Admin bleiben.' });
		}
		await db.update(users).set({ ...d, active }).where(eq(users.id, id));
		if (!active) await invalidateUserSessions(id);
		return { updated: id };
	},

	delete: async ({ request, locals }) => {
		const me = requirePermission(locals, 'benutzer.loeschen');
		const id = intOrNull((await request.formData()).get('id'));
		if (!id) return fail(400, { message: 'Benutzer fehlt' });
		if (id === me.id) return fail(400, { message: 'Du kannst dich nicht selbst löschen.' });
		const user = await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).get();
		if (!user) return fail(400, { message: 'Benutzer nicht gefunden.' });
		const denied = denyReason(me, user, 'delete');
		if (denied) return fail(403, { message: denied });
		if (user.role === 'admin' && user.active && (await activeAdminCount(id)) === 0) {
			return fail(400, { message: 'Es muss mindestens ein aktiver Admin bleiben.' });
		}

		const used = await db
			.select({ n: sql<number>`count(*)` })
			.from(movements)
			.where(or(eq(movements.userId, id), eq(movements.cancelledBy, id), eq(movements.recipientUserId, id)))
			.get();

		if (Number(used?.n ?? 0) === 0) {
			// Nie gebucht: komplett entfernen (Sitzungen und Reset-Links hängen per Cascade dran)
			await db.delete(users).where(eq(users.id, id));
		} else {
			// Hat gebucht: Name bleibt für die Historie, Zugang und Benutzername werden frei
			await db
				.update(users)
				.set({
					deletedAt: new Date(),
					active: false,
					email: null,
					partyId: null,
					username: `geloescht-${id}-${user.username}`.slice(0, 80),
					passwordHash: await hashPassword(generatePassword(24))
				})
				.where(eq(users.id, id));
			await invalidateUserSessions(id);
		}
		return { deleted: fullName(user) };
	},

	reset: async ({ request, locals, url }) => {
		const me = requirePermission(locals, 'benutzer.bearbeiten');
		const f = await request.formData();
		const id = intOrNull(f.get('id'));
		const user = id ? await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).get() : null;
		if (!user) return fail(400, { message: 'Benutzer fehlt' });
		const denied = denyReason(me, user, 'password');
		if (denied) return fail(403, { message: denied });
		if (f.get('mode') === 'mail') {
			if (!user.email) return fail(400, { message: 'Für diesen Benutzer ist keine E-Mail-Adresse hinterlegt.' });
			const token = await createPasswordReset(user.id);
			const sent = await sendMail(passwordResetMail(user.email, fullName(user), `${url.origin}/passwort-zuruecksetzen/${token}`));
			if (!sent) return fail(500, { message: 'Die E-Mail konnte nicht gesendet werden. SMTP-Einstellungen prüfen.' });
			return { reset: { name: fullName(user), mailed: true, password: null } };
		}
		const password = generatePassword();
		await db
			.update(users)
			.set({ passwordHash: await hashPassword(password), mustChangePassword: true })
			.where(eq(users.id, user.id));
		await invalidateUserSessions(user.id);
		return { reset: { name: fullName(user), mailed: false, password } };
	},

	/** Inhaberschaft an einen anderen aktiven Admin übergeben – nur der Inhaber, mit Passwort */
	transferOwner: async ({ request, locals, getClientAddress }) => {
		const me = requirePermission(locals, 'benutzer.bearbeiten');
		if (!me.owner) return fail(403, { message: 'Die Inhaberschaft kann nur der Inhaber übergeben.' });
		const f = await request.formData();
		const id = intOrNull(f.get('id'));
		if (!id || id === me.id) return fail(400, { message: 'Bitte einen anderen aktiven Admin auswählen.' });

		const key = `owner:${getClientAddress()}:${me.id}`;
		if (isRateLimited(key, 5)) return fail(429, { message: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' });
		const mine = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me.id)).get();
		if (!mine || !(await verifyPassword(mine.hash, String(f.get('password') ?? '')))) {
			registerFailure(key);
			return fail(400, { message: 'Das Passwort stimmt nicht.' });
		}

		const target = await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).get();
		if (!target) return fail(400, { message: 'Benutzer nicht gefunden.' });
		if (!canBecomeOwner(target)) return fail(400, { message: 'Die Inhaberschaft kann nur an einen aktiven Admin übergeben werden.' });

		await db.transaction(async (tx) => {
			await tx.update(users).set({ owner: false }).where(eq(users.owner, true));
			await tx.update(users).set({ owner: true }).where(eq(users.id, id));
		});
		console.warn(`[inhaber] ${me.username} hat die Inhaberschaft an ${target.username} übergeben`);
		return { ownerTransferred: fullName(target) };
	}
};
