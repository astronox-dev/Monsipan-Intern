import { json, redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { clearSessionCookie, SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { scheduleMaintenance } from '$lib/server/backup';
import { ensureDatabase } from '$lib/server/db';
import { ensurePermissions } from '$lib/server/permissions';
import { reportTools } from '$lib/server/compress';

export const init: ServerInit = async () => {
	await ensureDatabase();
	await ensurePermissions();
	scheduleMaintenance();
	void reportTools();
};

// /bericht/<token>: Tagesbericht für den Kunden – ohne Anmeldung, der Link selbst ist der Schlüssel;
// /pruefen/<token>: Prüfseite hinter dem QR-Code einer Rechnung;
// /api/anfragen/webseite: Kontaktformular der Webseite – prüft seinen Schlüssel selbst;
// /api/fahrzeug: die Tablets in den Autos – Kopplungscode bzw. ihr eigener Schlüssel
const PUBLIC_PATHS = ['/login', '/passwort-vergessen', '/passwort-zuruecksetzen', '/healthz', '/bericht', '/angebot', '/pruefen', '/api/anfragen/webseite', '/api/fahrzeug'];
const isPublic = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Seit dem Umbau zur Plattform liegen die Seiten in Bereichen. Alte Lesezeichen,
 * Verknüpfungen am Handy und Links in älteren Mails bleiben damit gültig.
 */
const MOVED: Record<string, string> = {
	'/bestand': '/lager/bestand',
	'/buchen': '/lager/buchen',
	'/bewegungen': '/lager/bewegungen',
	'/bestellliste': '/lager/bestellliste',
	'/berichte': '/lager/berichte',
	'/artikel': '/lager/artikel',
	'/scanner-test': '/lager/scanner-test',
	'/stammdaten': '/verwaltung/stammdaten',
	'/benutzer': '/verwaltung/benutzer',
	'/einstellungen': '/verwaltung/einstellungen'
};

/**
 * Frühere Adressen der Anwendung. Zeigt ORIGIN schon auf die neue (z. B.
 * portal.monsipan.at), leitet die App von dort mit Pfad und Query weiter – so
 * reicht es, im Tunnel beide Adressen auf denselben Container zu legen.
 * ORIGIN ersetzt nur die Adresse der Anwendung; der Host-Kopf der Anfrage
 * verrät, unter welcher sie aufgerufen wurde.
 */
const OLD_HOSTS = new Set(['lager.monsipan.at', 'intern.monsipan.at']);

function hostMoved(request: Request): string | null {
	if (!env.ORIGIN) return null;
	const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(':')[0].toLowerCase();
	if (!OLD_HOSTS.has(host)) return null;
	try {
		const target = new URL(env.ORIGIN);
		return target.hostname === host ? null : target.origin;
	} catch {
		return null;
	}
}

function movedTarget(path: string): string | null {
	for (const [alt, neu] of Object.entries(MOVED)) {
		if (path === alt) return neu;
		if (path.startsWith(`${alt}/`)) return neu + path.slice(alt.length);
	}
	return null;
}

export const handle: Handle = async ({ event, resolve }) => {
	await ensureDatabase();
	await ensurePermissions();

	const moved = movedTarget(event.url.pathname);
	const origin = hostMoved(event.request);
	if (origin) redirect(308, origin + (moved ?? event.url.pathname) + event.url.search);
	if (moved) redirect(308, moved + event.url.search);

	event.locals.user = null;
	event.locals.sessionToken = null;
	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = await validateSession(token);
		if (session) {
			event.locals.user = session.user;
			event.locals.sessionToken = token;
		} else {
			clearSessionCookie(event.cookies);
		}
	}

	const theme = event.cookies.get('theme');
	event.locals.theme = theme === 'light' || theme === 'dark' ? theme : 'system';

	const path = event.url.pathname;
	if (!event.locals.user && !isPublic(path)) {
		if (path.startsWith('/api/') || path.startsWith('/export/')) {
			return json({ message: 'Nicht angemeldet' }, { status: 401 });
		}
		const next = path === '/' ? '' : `?weiter=${encodeURIComponent(path + event.url.search)}`;
		redirect(303, `/login${next}`);
	}

	if (event.locals.user?.mustChangePassword && path !== '/passwort-aendern' && path !== '/logout' && !path.startsWith('/api/')) {
		redirect(303, '/passwort-aendern');
	}

	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('%app.theme%', event.locals.theme === 'system' ? '' : event.locals.theme),
		preload: ({ type, path }) =>
			type === 'js' || type === 'css' || (type === 'font' && /barlow-latin-(400|600)-normal.*\.woff2$/.test(path))
	});

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=()');
	return response;
};

export const handleError: HandleServerError = ({ error, status }) => {
	if (status !== 404) console.error(error);
	return { message: status === 404 ? 'Seite nicht gefunden' : 'Unerwarteter Fehler – bitte erneut versuchen.' };
};
