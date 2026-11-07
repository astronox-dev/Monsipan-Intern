/**
 * Drei-Wege-Zusammenführen für gleichzeitiges Bearbeiten: `base` ist der Stand,
 * den beide zuletzt gemeinsam hatten, `local` das eigene Formular, `remote` der
 * neue Stand vom Server (was die anderen gespeichert haben).
 *
 * - Hat nur eine Seite etwas geändert, gilt deren Änderung.
 * - Objekte werden Feld für Feld zusammengeführt.
 * - Listen von Zeilen mit `uid` Zeile für Zeile: neue Zeilen beider Seiten
 *   bleiben (an ihrer Stelle), gelöschte fallen weg – außer die andere Seite
 *   hat sie inzwischen geändert –, verschoben wird wie die Seite, die verschoben hat.
 * - Haben beide dasselbe Feld verschieden geändert, gilt das eigene (es wird
 *   gleich gespeichert und ist dann für alle so).
 */

type Json = unknown;
type Row = { uid: string } & Record<string, unknown>;

export function equal(a: Json, b: Json): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) {
		const bb = b as unknown[];
		return a.length === bb.length && a.every((x, i) => equal(x, bb[i]));
	}
	const ao = a as Record<string, unknown>;
	const bo = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
	for (const k of keys) if (!equal(ao[k], bo[k])) return false;
	return true;
}

const isPlain = (v: Json): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isRows = (v: Json): v is Row[] => Array.isArray(v) && v.every((x) => isPlain(x) && typeof x.uid === 'string');

export function merge3<T>(base: T, local: T, remote: T): T {
	if (equal(local, base)) return remote;
	if (equal(remote, base) || equal(local, remote)) return local;
	if (isRows(base) && isRows(local) && isRows(remote)) return mergeRows(base, local, remote) as T;
	if (isPlain(base) && isPlain(local) && isPlain(remote)) {
		const out: Record<string, unknown> = {};
		for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
			if (!(k in remote) && k in base) continue; // drüben weggefallen
			if (!(k in local)) {
				if (!(k in base)) out[k] = remote[k];
				continue;
			}
			out[k] = merge3(base[k], local[k], remote[k]);
		}
		return out as T;
	}
	// Beide haben denselben Wert verschieden geändert: das eigene gilt
	return local;
}

function mergeRows(base: Row[], local: Row[], remote: Row[]): Row[] {
	const b = new Map(base.map((r) => [r.uid, r]));
	const l = new Map(local.map((r) => [r.uid, r]));
	const r = new Map(remote.map((x) => [x.uid, x]));

	// Welche Zeilen bleiben – und in welcher Fassung
	const kept = new Map<string, Row>();
	for (const uid of new Set([...l.keys(), ...r.keys()])) {
		const inB = b.get(uid);
		const inL = l.get(uid);
		const inR = r.get(uid);
		if (inL && inR) kept.set(uid, inB ? merge3(inB, inL, inR) : inL);
		else if (inL && !inR) {
			// Neu hier – oder drüben gelöscht (dann nur behalten, wenn hier inzwischen geändert)
			if (!inB || !equal(inB, inL)) kept.set(uid, inL);
		} else if (inR && !inL) {
			// Neu drüben – oder hier gelöscht (dann nur behalten, wenn drüben inzwischen geändert)
			if (!inB || !equal(inB, inR)) kept.set(uid, inR);
		}
	}

	// Reihenfolge: wer verschoben hat, bestimmt sie; sonst die vom Server
	const common = (list: Row[]) => list.filter((x) => b.has(x.uid) && kept.has(x.uid)).map((x) => x.uid);
	const baseOrder = base.filter((x) => kept.has(x.uid)).map((x) => x.uid);
	const localMoved = !equal(
		common(local),
		baseOrder.filter((u) => l.has(u))
	);
	const remoteMoved = !equal(
		common(remote),
		baseOrder.filter((u) => r.has(u))
	);
	const [primary, secondary] = localMoved && !remoteMoved ? [local, remote] : [remote, local];

	const order = primary.filter((x) => kept.has(x.uid)).map((x) => x.uid);
	// Zeilen nur auf der anderen Seite: vor ihren Nachfolger dort – ohne Nachfolger ans Ende
	for (let i = secondary.length - 1; i >= 0; i--) {
		const x = secondary[i];
		if (!kept.has(x.uid) || order.includes(x.uid)) continue;
		let at = order.length;
		for (let j = i + 1; j < secondary.length; j++) {
			const pos = order.indexOf(secondary[j].uid);
			if (pos >= 0) {
				at = pos;
				break;
			}
		}
		order.splice(at, 0, x.uid);
	}
	return order.map((uid) => kept.get(uid)!);
}

/** Neue Kennung für eine Zeile */
export function newUid(): string {
	return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
