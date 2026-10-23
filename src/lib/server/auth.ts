import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Cookies } from '@sveltejs/kit';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { dev } from '$app/environment';
import { db } from './db';
import { passwordResets, sessions, users, type User } from './db/schema';
import { effectiveRole } from './lead';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const hash = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
	return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
	const [algo, N, r, p, saltB64, hashB64] = stored.split('$');
	if (algo !== 'scrypt') return false;
	const expected = Buffer.from(hashB64, 'base64');
	const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
		N: Number(N),
		r: Number(r),
		p: Number(p),
		maxmem: SCRYPT.maxmem
	});
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Lesbares Einmal-Passwort ohne verwechselbare Zeichen */
export function generatePassword(length = 12): string {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
	const bytes = randomBytes(length);
	let out = '';
	for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
	return out;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/* ---------------------------------------------------------------- Sitzungen */

export const SESSION_COOKIE = 'lager_session';
const DAY = 86_400_000;
const PERSISTENT_TTL = 30 * DAY;
const SHORT_TTL = 12 * 60 * 60 * 1000;
/** „Zuletzt geöffnet" wird höchstens so oft geschrieben – sonst bei jeder Anfrage */
const SEEN_EVERY = 5 * 60_000;

export type SessionUser = Pick<
	User,
	'id' | 'username' | 'email' | 'firstName' | 'lastName' | 'role' | 'partyId' | 'owner' | 'mustChangePassword'
> & {
	/** Vorübergehend Partieführer bis zu diesem Tag (dann ist `role` schon „partiefuehrer") */
	leadUntil?: string | null;
};

export async function createSession(userId: number, persistent: boolean, userAgent: string | null) {
	const token = newToken();
	const expiresAt = new Date(Date.now() + (persistent ? PERSISTENT_TTL : SHORT_TTL));
	await db.insert(sessions).values({
		id: sha256(token),
		userId,
		expiresAt,
		persistent,
		userAgent: userAgent?.slice(0, 250) ?? null
	});
	return { token, expiresAt, persistent };
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date, persistent: boolean) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		...(persistent ? { expires: expiresAt } : {})
	});
}

export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Prüft das Cookie und verlängert die Sitzung bei Aktivität */
export async function validateSession(token: string): Promise<{ user: SessionUser; sessionId: string } | null> {
	const id = sha256(token);
	const row = await db
		.select({
			sessionId: sessions.id,
			expiresAt: sessions.expiresAt,
			persistent: sessions.persistent,
			id: users.id,
			username: users.username,
			email: users.email,
			firstName: users.firstName,
			lastName: users.lastName,
			role: users.role,
			partyId: users.partyId,
			leadUntil: users.leadUntil,
			owner: users.owner,
			active: users.active,
			mustChangePassword: users.mustChangePassword,
			lastSeenAt: users.lastSeenAt
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, id))
		.get();
	if (!row) return null;
	const now = Date.now();
	if (row.expiresAt.getTime() < now || !row.active) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}
	const ttl = row.persistent ? PERSISTENT_TTL : SHORT_TTL;
	// Nur verlängern, wenn schon ein Teil der Laufzeit verbraucht ist – spart Schreibzugriffe
	if (row.expiresAt.getTime() - now < ttl - (row.persistent ? DAY : 15 * 60_000)) {
		await db
			.update(sessions)
			.set({ expiresAt: new Date(now + ttl) })
			.where(eq(sessions.id, id));
	}
	if (!row.lastSeenAt || now - row.lastSeenAt.getTime() > SEEN_EVERY) {
		await db.update(users).set({ lastSeenAt: new Date(now) }).where(eq(users.id, row.id));
	}
	const { sessionId, expiresAt: _e, persistent: _p, active: _a, lastSeenAt: _s, ...rest } = row;
	// Vorübergehend Partieführer: bis dahin gelten dessen Rechte
	const role = effectiveRole(rest.role, rest.leadUntil);
	const user: SessionUser = { ...rest, role, leadUntil: role !== rest.role ? rest.leadUntil : null };
	return { user, sessionId };
}

export async function invalidateSession(token: string) {
	await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function invalidateUserSessions(userId: number, exceptToken?: string) {
	if (exceptToken) {
		await db.delete(sessions).where(and(eq(sessions.userId, userId), sql`${sessions.id} <> ${sha256(exceptToken)}`));
	} else {
		await db.delete(sessions).where(eq(sessions.userId, userId));
	}
}

export async function purgeExpired() {
	const now = new Date();
	await db.delete(sessions).where(lt(sessions.expiresAt, now));
	await db.delete(passwordResets).where(or(lt(passwordResets.expiresAt, now), sql`${passwordResets.usedAt} IS NOT NULL`));
}

/* ---------------------------------------------------------------- Anmeldung */

export async function findUserForLogin(identifier: string) {
	const id = identifier.trim().toLowerCase();
	if (!id) return null;
	return (
		(await db
			.select()
			.from(users)
			.where(or(eq(users.username, id), eq(users.email, id)))
			.get()) ?? null
	);
}

/* ----------------------------------------------------------- Passwort-Reset */

const RESET_TTL = 60 * 60 * 1000;

export async function createPasswordReset(userId: number, ttlMs = RESET_TTL): Promise<string> {
	const token = newToken();
	await db.insert(passwordResets).values({
		tokenHash: sha256(token),
		userId,
		expiresAt: new Date(Date.now() + ttlMs)
	});
	return token;
}

export async function findPasswordReset(token: string) {
	return (
		(await db
			.select({ userId: passwordResets.userId, username: users.username, firstName: users.firstName })
			.from(passwordResets)
			.innerJoin(users, eq(users.id, passwordResets.userId))
			.where(
				and(
					eq(passwordResets.tokenHash, sha256(token)),
					gt(passwordResets.expiresAt, new Date()),
					isNull(passwordResets.usedAt),
					eq(users.active, true)
				)
			)
			.get()) ?? null
	);
}

export async function consumePasswordReset(token: string, newPassword: string): Promise<number | null> {
	const reset = await findPasswordReset(token);
	if (!reset) return null;
	const passwordHash = await hashPassword(newPassword);
	await db.transaction(async (tx) => {
		await tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, reset.userId));
		await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.userId, reset.userId));
		await tx.delete(sessions).where(eq(sessions.userId, reset.userId));
	});
	return reset.userId;
}

/* ---------------------------------------------------------- Rate-Limiting */

const attempts = new Map<string, { count: number; first: number }>();

/** true = gesperrt. Zählt Fehlversuche je Schlüssel in einem Zeitfenster. */
export function isRateLimited(key: string, max = 8, windowMs = 15 * 60_000): boolean {
	const a = attempts.get(key);
	if (!a) return false;
	if (Date.now() - a.first > windowMs) {
		attempts.delete(key);
		return false;
	}
	return a.count >= max;
}

export function registerFailure(key: string, windowMs = 15 * 60_000) {
	const now = Date.now();
	const a = attempts.get(key);
	if (!a || now - a.first > windowMs) attempts.set(key, { count: 1, first: now });
	else a.count++;
	if (attempts.size > 5000) {
		for (const [k, v] of attempts) if (now - v.first > windowMs) attempts.delete(k);
	}
}

export function clearFailures(key: string) {
	attempts.delete(key);
}
