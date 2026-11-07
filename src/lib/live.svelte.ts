/**
 * Live: Was andere speichern, erscheint hier ohne Neuladen – und man sieht, wer
 * dieselbe Seite gerade offen hat.
 *
 * - Jeder Tab hat eine Kennung (`tabId`); sie geht als Kopf `x-tab` mit jedem
 *   Absenden mit. Der Server meldet danach allen „geändert: /angebote/12" –
 *   nur der Tab, der gespeichert hat, nicht.
 * - Ohne eigenes Zusammenführen lädt eine betroffene Seite einfach neu
 *   (`invalidateAll`). Seiten mit eigenem Formularzustand melden sich mit
 *   `onRemoteChange` an und führen fremde Änderungen selbst ein (LiveDoc).
 * - Anwesenheit: Der Tab meldet seine Seite; `presence` hält, wer wo ist.
 */
import { invalidateAll } from '$app/navigation';

export const tabId: string = (() => {
	if (typeof crypto === 'undefined') return '';
	return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
})();

export interface Present {
	userId: number;
	name: string;
	editing: boolean;
}

/** Wer auf welcher Seite ist – vom Server */
export const presence = $state<{ byTopic: Record<string, Present[]> }>({ byTopic: {} });

/** Pfad ohne abschließenden Schrägstrich */
const clean = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** Liegt `a` in `b` oder umgekehrt (Liste ↔ Eintrag, Eintrag ↔ bearbeiten)? */
export function related(a: string, b: string): 'same' | 'near' | null {
	a = clean(a);
	b = clean(b);
	if (a === b) return 'same';
	if (a === '/' || b === '/') return null;
	if (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) return 'near';
	return null;
}

type Handler = (change: { path: string; userId: number }) => boolean | void;
const handlers = new Set<Handler>();
/** Weitere Pfade, auf die die aktuelle Seite hört (etwa die Planung auf Aufträge) */
const watched = new Set<string>();

/**
 * Eine Seite führt fremde Änderungen selbst ein. Gibt der Handler `true`
 * zurück, ist die Änderung erledigt – sonst lädt die Seite wie üblich neu.
 */
export function onRemoteChange(fn: Handler): () => void {
	handlers.add(fn);
	return () => handlers.delete(fn);
}

/** Auch bei Änderungen unter diesen Pfaden neu laden */
export function watchPaths(paths: string[]): () => void {
	for (const p of paths) watched.add(p);
	return () => {
		for (const p of paths) watched.delete(p);
	};
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let lastFar = 0;
function scheduleReload(soon: boolean) {
	clearTimeout(reloadTimer);
	// Was die Seite selbst betrifft gleich, Listen und Übersichten höchstens alle paar Sekunden
	const wait = soon ? 300 : Math.max(300, 4000 - (Date.now() - lastFar));
	reloadTimer = setTimeout(() => {
		lastFar = Date.now();
		if (document.visibilityState === 'visible') void invalidateAll();
		else pendingWhileHidden = true;
	}, wait);
}
let pendingWhileHidden = false;

/** Vom Server: „geändert" – betrifft es diese Seite? */
export function receiveChange(change: { path: string; tab: string; userId: number }, here: string) {
	if (!change.path || change.tab === tabId) return;
	const rel = related(change.path, here) ?? ([...watched].some((w) => related(change.path, w)) ? 'near' : null);
	if (!rel) return;
	for (const h of handlers) if (h(change)) return;
	scheduleReload(rel === 'same');
}

/** Wieder sichtbar: Verpasstes nachladen */
export function onVisible() {
	if (pendingWhileHidden) {
		pendingWhileHidden = false;
		void invalidateAll();
	}
}

/* ---------------------------------------------------------------- Absenden kennzeichnen */

let patched = false;
/** Jedes Absenden an den eigenen Server trägt die Kennung des Tabs */
export function markRequests() {
	if (patched || typeof window === 'undefined') return;
	patched = true;
	const original = window.fetch.bind(window);
	window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		try {
			const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
			const url = new URL(input instanceof Request ? input.url : String(input), location.href);
			if (method !== 'GET' && method !== 'HEAD' && url.origin === location.origin) {
				const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
				headers.set('x-tab', tabId);
				return original(input, { ...init, headers });
			}
		} catch {
			/* im Zweifel unverändert */
		}
		return original(input, init);
	};
}

/* ---------------------------------------------------------------- Anwesenheit melden */

let topic = '';
let editingUntil = 0;
let beat: ReturnType<typeof setInterval> | undefined;
let lastSent = '';

function send(force = false) {
	const editing = Date.now() < editingUntil;
	const body = JSON.stringify({ tab: tabId, topic, editing });
	if (!force && body === lastSent) return;
	lastSent = body;
	void fetch('/api/presence', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {
		lastSent = '';
	});
}

/** Die Seite gewechselt */
export function setTopic(path: string) {
	topic = clean(path);
	editingUntil = 0;
	send();
	clearInterval(beat);
	beat = setInterval(() => send(true), 20_000);
}

let editingTimer: ReturnType<typeof setTimeout> | undefined;
/** Hier wird getippt – „bearbeitet gerade" für ein paar Sekunden */
export function typing() {
	const was = Date.now() < editingUntil;
	editingUntil = Date.now() + 8000;
	if (!was) send();
	clearTimeout(editingTimer);
	editingTimer = setTimeout(() => send(), 8200);
}

/** Tab geht zu */
export function leaveTopic() {
	clearInterval(beat);
	try {
		navigator.sendBeacon('/api/presence', JSON.stringify({ tab: tabId, topic: '', editing: false }));
	} catch {
		/* egal – der Server räumt nach einer Minute selbst auf */
	}
}

export function receivePresence(t: string, people: Present[]) {
	presence.byTopic[t] = people;
}
export function receivePresenceAll(all: Record<string, Present[]>) {
	presence.byTopic = all;
}

/** Die anderen auf dieser Seite (ohne mich in diesem Tab – andere Tabs von mir zählen nicht) */
export function othersOn(path: string, me: number): Present[] {
	return (presence.byTopic[clean(path)] ?? []).filter((p) => p.userId !== me);
}
