/**
 * Hochladen in Teilen: große Dateien (Pläne am Auftrag, Komplettsicherungen)
 * kommen in mehreren Anfragen, damit jede klein bleibt – Cloudflare und
 * BODY_SIZE_LIMIT begrenzen je Anfrage, nicht je Datei. Die Teile landen der
 * Reihe nach in einer .tmp-Datei je Person und Upload; bricht die Verbindung ab,
 * sagt `received`, ab wo es weitergeht. Den Browser-Teil dazu hat `$lib/upload`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Kennung eines Uploads – erzeugt der Browser */
export const UPLOAD_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Die Datei eines Uploads in `dir` – je Person, damit niemand an fremde Uploads anhängt */
export const partFile = (dir: string, userId: number, id: string) => path.join(dir, `teil-${userId}-${id}.tmp`);

const writing = new Set<string>();

/** Schreibt gerade noch ein Teil in diese Datei? */
export const isWriting = (file: string) => writing.has(file);

export const sizeOf = (file: string) => (fs.existsSync(file) ? fs.statSync(file).size : 0);

/**
 * Einen Teil anhängen – nur genau dort, wo das schon Angekommene endet. Sonst
 * (Wiederholung nach Abbruch, oder es schreibt gerade noch) bleibt die Datei,
 * wie sie ist, und `received` sagt, ab wo es weitergeht.
 */
export async function appendPart(file: string, offset: number, part: ReadableStream<Uint8Array>) {
	if (writing.has(file) || offset !== sizeOf(file)) return { ok: false, received: sizeOf(file) };
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writing.add(file);
	try {
		await pipeline(Readable.fromWeb(part as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(file, { flags: 'a' }));
	} catch {
		/* Verbindung abgebrochen – angekommen ist, was in der Datei steht */
	} finally {
		writing.delete(file);
	}
	return { ok: true, received: sizeOf(file) };
}

/** Liegengebliebene Uploads in `dir` löschen, die seit einem Tag niemand mehr fortgesetzt hat */
export function sweepParts(dir: string, now = Date.now()) {
	if (!fs.existsSync(dir)) return;
	for (const name of fs.readdirSync(dir)) {
		if (!/^teil-\d+-[A-Za-z0-9_-]+\.tmp$/.test(name)) continue;
		const file = path.join(dir, name);
		try {
			if (!writing.has(file) && fs.statSync(file).mtimeMs < now - 86_400_000) fs.rmSync(file, { force: true });
		} catch {
			/* nächstes Mal */
		}
	}
}
