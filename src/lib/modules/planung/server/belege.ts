/**
 * Belege zur Krankmeldung: Foto (am Gerät schon auf JPEG verkleinert) oder
 * PDF. Die Dateien liegen unter /data/krankmeldungen/<sha256>.jpg bzw. .pdf;
 * die Datenbank kennt nur Prüfsumme, Art und Dateinamen.
 *
 * Wie bei den anderen Ablagen bleiben Dateien gelöschter Belege noch eine
 * Weile liegen, damit eine eingespielte Sicherung sie wiederfindet.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, db } from '$lib/server/db';
import { sickDocuments } from '$lib/server/db/schema';
import { tidyFolder } from '$lib/server/documents';
import { jpegSize } from '$lib/modules/tagesberichte/photos';
import { compressJpeg, compressPdfBuffer } from '$lib/server/compress';

export const BELEG_DIR = path.join(DATA_DIR, 'krankmeldungen');
export const MAX_BELEG_BYTES = 20 * 1024 * 1024;
const SHA_FILE = /^([0-9a-f]{64})\.(?:jpg|pdf)$/;

export class BelegError extends Error {}

export const belegFile = (sha256: string, kind: 'jpg' | 'pdf') => path.join(BELEG_DIR, `${sha256}.${kind}`);

/** Prüfen (JPEG oder PDF) und unter der Prüfsumme ablegen */
export async function storeBeleg(upload: File): Promise<{ sha256: string; kind: 'jpg' | 'pdf'; size: number }> {
	if (upload.size === 0) throw new BelegError(`„${upload.name}" ist leer.`);
	if (upload.size > MAX_BELEG_BYTES) throw new BelegError(`„${upload.name}" ist zu groß – erlaubt sind ${MAX_BELEG_BYTES / 1024 / 1024} MB.`);
	const original = Buffer.from(await upload.arrayBuffer());
	const kind = jpegSize(original) ? 'jpg' : original.subarray(0, 1024).toString('latin1').includes('%PDF-') ? 'pdf' : null;
	if (!kind) throw new BelegError(`„${upload.name}" ist weder ein Foto noch ein PDF.`);
	// Verlustfrei kleiner (siehe $lib/server/compress)
	const buf = kind === 'jpg' ? await compressJpeg(original) : await compressPdfBuffer(original, BELEG_DIR);
	const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
	await fs.promises.mkdir(BELEG_DIR, { recursive: true });
	const target = belegFile(sha256, kind);
	if (!fs.existsSync(target)) {
		const temp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
		await fs.promises.writeFile(temp, buf);
		await fs.promises.rename(temp, target);
	}
	return { sha256, kind, size: buf.length };
}

/** Einmal am Tag: benutzte Belege markieren, lange unbenutzte löschen */
export async function tidyBelege(now = new Date()): Promise<{ removed: number }> {
	const rows = await db.select({ sha256: sickDocuments.sha256 }).from(sickDocuments).all();
	return tidyFolder(BELEG_DIR, SHA_FILE, new Set(rows.map((r) => r.sha256)), now);
}
