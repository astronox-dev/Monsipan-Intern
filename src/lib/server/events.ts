/**
 * Server-Sent Events: Nach jeder Änderung erfahren alle offenen Browser davon
 * und laden die betroffenen Daten neu. Läuft im selben Prozess, kein Broker nötig.
 *
 * Dazu die Anwesenheit: Jeder Browser-Tab meldet, auf welcher Seite er ist
 * (und ob dort gerade getippt wird) – alle sehen, wer noch dieselbe Seite offen hat.
 */
const encoder = new TextEncoder();

interface Client {
	ctrl: ReadableStreamDefaultController<Uint8Array>;
	tab: string;
}
const clients = new Set<Client>();

export function eventStream(signal: AbortSignal, tab = ''): ReadableStream<Uint8Array> {
	let client: Client;
	let ping: ReturnType<typeof setInterval>;
	const close = () => {
		clearInterval(ping);
		clients.delete(client);
		// Tab zu: von der Seite, auf der er war, abmelden
		if (tab && !hasTab(tab)) leave(tab);
		try {
			client.ctrl.close();
		} catch {
			/* schon zu */
		}
	};
	return new ReadableStream({
		start(controller) {
			client = { ctrl: controller, tab };
			clients.add(client);
			controller.enqueue(encoder.encode('retry: 5000\n: verbunden\n\n'));
			// Wer gerade wo ist – damit ein neuer Tab gleich alle sieht
			controller.enqueue(encoder.encode(`event: presence-all\ndata: ${JSON.stringify(presenceAll())}\n\n`));
			ping = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					close();
				}
			}, 25_000);
			signal.addEventListener('abort', close);
		},
		cancel: close
	});
}

const hasTab = (tab: string) => [...clients].some((c) => c.tab === tab);

export function broadcast(event: string, data: unknown) {
	const chunk = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	for (const c of clients) {
		try {
			c.ctrl.enqueue(chunk);
		} catch {
			clients.delete(c);
		}
	}
}

/* ------------------------------------------------------------------ Änderungen */

/**
 * Etwas wurde gespeichert: Seiten auf demselben Pfad (und darüber, etwa die
 * Liste) laden neu. `tab` ist der Tab, der gespeichert hat – er selbst nicht.
 */
export function changed(path: string, tab: string, userId: number) {
	broadcast('changed', { path, tab, userId });
}

/* ------------------------------------------------------------------ Anwesenheit */

export interface Present {
	userId: number;
	name: string;
	/** Tippt gerade (in den letzten Sekunden) */
	editing: boolean;
}

interface Entry extends Present {
	topic: string;
	at: number;
}

/** Je Tab, wo er gerade ist */
const presence = new Map<string, Entry>();
/** Nach so langer Stille gilt ein Tab als weg (der Browser meldet sich alle 20 s) */
const STALE_MS = 60_000;

function people(topic: string): Present[] {
	const byUser = new Map<number, Present>();
	for (const e of presence.values()) {
		if (e.topic !== topic) continue;
		const known = byUser.get(e.userId);
		byUser.set(e.userId, { userId: e.userId, name: e.name, editing: e.editing || !!known?.editing });
	}
	return [...byUser.values()];
}

function presenceAll(): Record<string, Present[]> {
	const out: Record<string, Present[]> = {};
	for (const topic of new Set([...presence.values()].map((e) => e.topic))) out[topic] = people(topic);
	return out;
}

const announce = (topic: string) => broadcast('presence', { topic, people: people(topic) });

/** Der Tab ist auf `topic` (leer: nirgends) */
export function setPresence(tab: string, user: { id: number; name: string }, topic: string, editing: boolean) {
	const before = presence.get(tab);
	if (!topic) {
		if (before) leave(tab);
		return;
	}
	const same = before && before.topic === topic && before.editing === editing && before.userId === user.id;
	presence.set(tab, { userId: user.id, name: user.name, editing, topic, at: Date.now() });
	if (same) return;
	if (before && before.topic !== topic) announce(before.topic);
	announce(topic);
}

function leave(tab: string) {
	const before = presence.get(tab);
	if (!before) return;
	presence.delete(tab);
	announce(before.topic);
}

// Verwaiste Tabs (Handy weggelegt, Verbindung weg) aufräumen
const sweep = setInterval(() => {
	const now = Date.now();
	for (const [tab, e] of presence) if (now - e.at > STALE_MS) leave(tab);
}, 15_000);
sweep.unref?.();
