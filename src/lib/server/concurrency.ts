/**
 * Gegen gleichzeitiges Überschreiben: Das Formular schickt mit, welchen Stand
 * es geladen hat (`version` = updatedAt in ms). Hat inzwischen jemand anderer
 * gespeichert, wird nicht gespeichert, sondern gemeldet, wer – außer man will
 * ausdrücklich die eigene Fassung behalten (`force`).
 */
export interface SaveGuard {
	userId: number;
	/** Der geladene Stand – null: ohne Prüfung (ältere Formulare, Tests) */
	version: number | null;
	/** Trotzdem speichern – „Meine Fassung behalten" */
	force: boolean;
}

export interface Conflict {
	/** Wer zuletzt gespeichert hat */
	by: string;
	/** Wann – ms */
	at: number;
}

export function readGuard(form: FormData, userId: number): SaveGuard {
	const v = Number(form.get('version'));
	return {
		userId,
		version: Number.isFinite(v) && v > 0 ? v : null,
		force: form.get('ueberschreiben') === '1'
	};
}

/** Name aus Vor- und Nachname (eines Joins auf users) */
export function userName(u: { first: string | null; last: string | null } | null | undefined): string {
	return u ? [u.first, u.last].filter(Boolean).join(' ') : '';
}

/** Die Meldung für das Formular */
export function conflictMessage(c: Conflict, what: string): string {
	return `${c.by || 'Jemand anderer'} hat ${what} inzwischen gespeichert – deine Änderungen sind noch nicht gespeichert.`;
}
