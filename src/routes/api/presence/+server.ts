import { error } from '@sveltejs/kit';
import { setPresence } from '$lib/server/events';
import type { RequestHandler } from './$types';

/**
 * Anwesenheit: Der Tab meldet, auf welcher Seite er ist und ob dort getippt
 * wird – beim Öffnen, beim Tippen und alle 20 Sekunden. Leeres `topic`: weg.
 * Kommt auch per sendBeacon (beim Schließen), daher ohne eigenen Kopf.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) error(401);
	let body: { tab?: unknown; topic?: unknown; editing?: unknown };
	try {
		body = JSON.parse(await request.text());
	} catch {
		error(400);
	}
	const tab = typeof body.tab === 'string' ? body.tab.slice(0, 64) : '';
	const topic = typeof body.topic === 'string' && body.topic.startsWith('/') ? body.topic.slice(0, 200) : '';
	if (!tab) error(400);
	const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
	setPresence(tab, { id: user.id, name }, topic, body.editing === true);
	return new Response(null, { status: 204 });
};
