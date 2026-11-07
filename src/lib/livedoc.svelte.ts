/**
 * Gemeinsam an einem Formular arbeiten (Angebot, Rechnung, Tagesbericht …):
 * Speichert jemand anderer, lädt die Seite den neuen Stand und führt ihn mit dem
 * eigenen Formular zusammen – Feld für Feld, Zeile für Zeile (siehe merge3).
 * Eigene, noch nicht gespeicherte Eingaben bleiben; fremde erscheinen sofort.
 *
 * Die Seite beschreibt ihr Formular als „Modell" (schlichtes JSON, Zeilen mit
 * `uid`): `read` aus den geladenen Daten, `get` aus dem Formular, `set` zurück
 * ins Formular. Alles Weitere macht LiveDoc:
 *
 * - nach jeder Änderung der Daten (fremdes Speichern, eigenes Speichern,
 *   Neuladen) zusammenführen und den gemeinsamen Stand merken,
 * - fremde Änderungen an dieser Seite selbst laden (statt die Seite neu aufzubauen),
 * - nach dem eigenen Speichern den Stand vom Server holen,
 * - einen Konflikt beim Speichern selbst lösen (neu laden, zusammenführen, noch einmal).
 */
import { invalidateAll } from '$app/navigation';
import { onDestroy, untrack } from 'svelte';
import { equal, merge3 } from '$lib/merge';
import { onRemoteChange, presence } from '$lib/live.svelte';
import type { Autosave } from '$lib/autosave.svelte';

export interface LiveDocOptions<M> {
	read: () => M;
	get: () => M;
	set: (m: M) => void;
	saver?: Autosave;
	/** Gerade nicht zusammenführen (etwa während einer Unterschrift) */
	paused?: () => boolean;
}

export class LiveDoc<M> {
	/** Zuletzt Fremdes übernommen: von wem, wann */
	lastRemote = $state<{ by: string; at: Date } | null>(null);

	#opts: LiveDocOptions<M>;
	#base: M;
	#pendingBy: number | null = null;
	#waiters: (() => void)[] = [];
	#reloadTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(opts: LiveDocOptions<M>) {
		this.#opts = opts;
		this.#base = clone(untrack(() => opts.read()));

		// Neue Daten von der Seite: zusammenführen
		$effect(() => {
			const remote = opts.read();
			untrack(() => this.#merge(remote));
		});

		// Fremde Änderung an dieser Seite: neuen Stand laden – das Zusammenführen folgt von selbst
		const off = onRemoteChange((change) => {
			this.#pendingBy = change.userId;
			this.reload();
			return true;
		});
		const offSave = opts.saver?.afterSave(() => this.reload(400));
		opts.saver?.resolveConflicts(async () => {
			await this.reload(0);
			return true;
		});
		onDestroy(() => {
			off();
			offSave?.();
			clearTimeout(this.#reloadTimer);
		});
	}

	/**
	 * Das normale Absenden kam zu spät – jemand anderer hat inzwischen
	 * gespeichert: neuen Stand holen, zusammenführen und gleich speichern.
	 */
	async afterConflict() {
		await this.reload(0);
		this.#opts.saver?.touch();
	}

	/** Hat das Formular etwas, das noch nicht auf dem Server ist? */
	dirty(): boolean {
		return !equal(this.#opts.get(), this.#base);
	}

	/** Neuen Stand holen (gebündelt) – erfüllt, sobald er zusammengeführt ist */
	reload(wait = 250): Promise<void> {
		return new Promise((resolve) => {
			this.#waiters.push(resolve);
			clearTimeout(this.#reloadTimer);
			this.#reloadTimer = setTimeout(async () => {
				const done = this.#waiters.splice(0);
				try {
					await invalidateAll();
				} finally {
					for (const fn of done) fn();
				}
			}, wait);
		});
	}

	#merge(remote: M) {
		if (this.#opts.paused?.()) return;
		const base = this.#base;
		this.#base = clone(remote);
		if (equal(base, remote)) return;
		const local = this.#opts.get();
		const merged = merge3(base, local, remote);
		if (!equal(merged, local)) {
			this.#opts.set(merged);
			if (this.#pendingBy != null) {
				const who = Object.values(presence.byTopic)
					.flat()
					.find((p) => p.userId === this.#pendingBy);
				this.lastRemote = { by: who?.name ?? 'jemand anderer', at: new Date() };
			}
		}
		this.#pendingBy = null;
	}
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * Zeilen übernehmen, ohne die vorhandenen Objekte wegzuwerfen: gleiche `uid`
 * behält ihr Objekt (und damit ihren Schlüssel im Formular), nur geänderte
 * Felder werden gesetzt. `make` baut eine neue Zeile.
 */
export function applyRows<T extends { uid: string }, R extends { uid: string }>(
	current: T[],
	next: R[],
	make: (r: R) => T,
	assign: (t: T, r: R) => void
): T[] | null {
	const byUid = new Map(current.map((t) => [t.uid, t]));
	const out = next.map((r) => {
		const t = byUid.get(r.uid);
		if (!t) return make(r);
		assign(t, r);
		return t;
	});
	const sameOrder = out.length === current.length && out.every((t, i) => t === current[i]);
	return sameOrder ? null : out;
}

/** Felder eines Objekts setzen – nur, was sich wirklich ändert */
export function assignFields<T extends Record<string, unknown>>(target: T, from: Partial<T>) {
	for (const [k, v] of Object.entries(from)) {
		if (!equal(target[k], v)) (target as Record<string, unknown>)[k] = v;
	}
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Listen ohne eigene Kennung (feste Zeilen, etwa im Arbeitsauftrag) bekommen
 * ihren Platz als Kennung – so führt merge3 sie Zeile für Zeile zusammen.
 */
export function keyed<T>(v: T): T {
	if (Array.isArray(v)) return (v.every(isObj) ? v.map((x, i) => ({ uid: `#${i}`, ...(keyed(x) as object) })) : v.map(keyed)) as T;
	if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keyed(x)])) as T;
	return v;
}

/** Zurück: die Platz-Kennungen wieder weg */
export function unkeyed<T>(v: T): T {
	if (Array.isArray(v))
		return v.map((x) =>
			isObj(x) && typeof x.uid === 'string' && x.uid.startsWith('#') ? unkeyed(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'uid'))) : unkeyed(x)
		) as T;
	if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unkeyed(x)])) as T;
	return v;
}

/** Tief übernehmen – nur, was sich ändert; gleich lange Listen Platz für Platz */
export function deepAssign(target: Record<string, unknown>, from: Record<string, unknown>) {
	for (const [k, v] of Object.entries(from)) {
		const cur = target[k];
		if (isObj(cur) && isObj(v)) deepAssign(cur, v);
		else if (Array.isArray(cur) && Array.isArray(v) && cur.length === v.length) {
			v.forEach((x, i) => {
				if (isObj(cur[i]) && isObj(x)) deepAssign(cur[i] as Record<string, unknown>, x);
				else if (!equal(cur[i], x)) cur[i] = x;
			});
		} else if (!equal(cur, v)) target[k] = v;
	}
}
