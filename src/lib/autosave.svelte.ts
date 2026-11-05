/**
 * Automatisch speichern: Nach jeder Änderung (`touch()`) wird kurz gewartet und
 * dann das Formular an seine Speicher-Aktion geschickt – ohne die Seite neu zu
 * laden. Das Formular trägt `version` (den geladenen Stand); antwortet der
 * Server mit einem Konflikt, hört das Speichern auf, bis jemand entscheidet:
 * neu laden oder die eigene Fassung behalten (`keepMine()`).
 *
 * Beim Verlassen der Seite wird Ausstehendes noch geschickt.
 */
import { deserialize } from '$app/forms';
import { beforeNavigate } from '$app/navigation';
import { onMount, tick } from 'svelte';

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export interface AutosaveOptions {
	/** Das Formular – zur Zeit des Speicherns; sonst über `use:autosaveForm` */
	form?: () => HTMLFormElement | null | undefined;
	/** Die Speicher-Aktion, etwa „?/save" */
	action: string;
	/** Gerade erlaubt? (änderbar, nicht mitten in einem anderen Absenden) */
	enabled?: () => boolean;
	/** Zusätzliche Felder, etwa `auto: '1'` – die Aktion erkennt daran das automatische Speichern */
	extra?: Record<string, string>;
	/** Gespeichert – mit dem, was die Aktion zurückgibt (neue `version`) */
	onsaved?: (data: Record<string, unknown>) => void;
	delay?: number;
}

export class Autosave {
	state = $state<AutosaveState>('idle');
	savedAt = $state<Date | null>(null);
	message = $state('');
	/** Wer inzwischen gespeichert hat */
	conflictBy = $state('');

	#opts: AutosaveOptions;
	#form: HTMLFormElement | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#running: Promise<void> | null = null;
	#again = false;
	#force = false;

	constructor(opts: AutosaveOptions) {
		this.#opts = opts;
		beforeNavigate(() => {
			if (this.state === 'pending') this.flush(true);
		});
		onMount(() => {
			const hide = () => {
				if (document.visibilityState === 'hidden' && this.state === 'pending') this.flush(true);
			};
			const leave = () => {
				if (this.state === 'pending') this.flush(true);
			};
			document.addEventListener('visibilitychange', hide);
			window.addEventListener('pagehide', leave);
			return () => {
				clearTimeout(this.#timer);
				document.removeEventListener('visibilitychange', hide);
				window.removeEventListener('pagehide', leave);
			};
		});
	}

	/** Das Formular, wenn es nicht über `form` kommt */
	attach(form: HTMLFormElement) {
		this.#form = form;
	}

	/** Etwas hat sich geändert */
	touch() {
		if (this.state === 'conflict') return;
		if (this.#opts.enabled && !this.#opts.enabled()) return;
		this.state = 'pending';
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.flush(), this.#opts.delay ?? 2000);
	}

	/** Nicht mehr speichern, was aussteht – das Formular wird gleich normal abgeschickt */
	cancel() {
		clearTimeout(this.#timer);
		if (this.state === 'pending') this.state = 'idle';
	}

	/** Das normale Absenden meldet einen Konflikt – ab jetzt wie beim automatischen Speichern */
	markConflict(by: string, message: string) {
		clearTimeout(this.#timer);
		this.state = 'conflict';
		this.conflictBy = by || 'Jemand anderer';
		this.message = message;
	}

	/** Gespeichert über das normale Absenden */
	markSaved() {
		clearTimeout(this.#timer);
		this.#force = false;
		this.state = 'saved';
		this.savedAt = new Date();
		this.message = '';
	}

	/** Trotz Konflikt die eigene Fassung speichern */
	keepMine() {
		this.#force = true;
		this.state = 'pending';
		this.flush();
	}

	/** Jetzt speichern. `leaving`: die Seite geht – die Anfrage darf das überleben */
	async flush(leaving = false): Promise<void> {
		clearTimeout(this.#timer);
		// Erst den neuesten Stand (auch die Version) ins Formular
		await tick();
		if (this.#running) {
			this.#again = true;
			return this.#running;
		}
		const form = this.#opts.form?.() ?? this.#form;
		if (!form || (this.#opts.enabled && !this.#opts.enabled())) {
			if (this.state === 'pending') this.state = 'idle';
			return;
		}
		const body = new FormData(form);
		for (const [k, v] of Object.entries(this.#opts.extra ?? {})) body.set(k, v);
		if (this.#force) body.set('ueberschreiben', '1');
		this.state = 'saving';
		this.#running = (async () => {
			try {
				const res = await fetch(new URL(this.#opts.action, location.href), {
					method: 'POST',
					body,
					headers: { 'x-sveltekit-action': 'true' },
					keepalive: leaving
				});
				const result = deserialize(await res.text());
				if (result.type === 'success') {
					this.#force = false;
					this.state = 'saved';
					this.savedAt = new Date();
					this.message = '';
					this.#opts.onsaved?.(result.data ?? {});
				} else if (result.type === 'failure' && result.data?.conflict) {
					this.state = 'conflict';
					const c = result.data.conflict as { by?: string };
					this.conflictBy = c.by || 'Jemand anderer';
					this.message = String(result.data.message ?? '');
				} else {
					this.state = 'error';
					this.message =
						result.type === 'failure'
							? String(result.data?.message ?? 'Nicht gespeichert.')
							: result.type === 'error'
								? 'Nicht gespeichert – bitte neu laden.'
								: '';
				}
			} catch {
				this.state = 'error';
				this.message = 'Keine Verbindung – wird beim nächsten Ändern noch einmal versucht.';
			} finally {
				this.#running = null;
			}
		})();
		await this.#running;
		if (this.#again) {
			this.#again = false;
			if ((this.state as AutosaveState) !== 'conflict') {
				this.state = 'pending';
				await this.flush();
			}
		}
	}
}

/** „Gespeichert 14:32" usw. – für die Anzeige */
export function autosaveLabel(a: Autosave): string {
	switch (a.state) {
		case 'pending':
			return 'Ungespeicherte Änderungen …';
		case 'saving':
			return 'Wird gespeichert …';
		case 'saved':
			return `Gespeichert ${a.savedAt?.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) ?? ''}`;
		case 'error':
			return `Nicht gespeichert: ${a.message}`;
		case 'conflict':
			return `Nicht gespeichert – ${a.conflictBy} hat inzwischen gespeichert`;
		default:
			return '';
	}
}

/**
 * Für Formulare ohne eigenen Zustand: jede Eingabe im Formular (und jeder
 * Knopf darin, der etwas ändert – Zeile dazu, entfernen …) speichert kurz
 * danach. Felder in `[data-no-autosave]` zählen nicht.
 *
 *   <form use:autosaveForm={saver}>
 */
export function autosaveForm(node: HTMLFormElement, saver: Autosave) {
	let current = saver;
	current.attach(node);
	const on = (e: Event) => {
		const t = e.target as HTMLElement | null;
		if (!t || t.closest('[data-no-autosave]')) return;
		if (e.type === 'click' && !t.closest('button[type="button"]')) return;
		// Erst nach dem Klick hat die Seite ihren Zustand geändert
		setTimeout(() => current.touch(), 0);
	};
	node.addEventListener('input', on);
	node.addEventListener('change', on);
	node.addEventListener('click', on);
	return {
		update(next: Autosave) {
			current = next;
			current.attach(node);
		},
		destroy() {
			node.removeEventListener('input', on);
			node.removeEventListener('change', on);
			node.removeEventListener('click', on);
		}
	};
}
