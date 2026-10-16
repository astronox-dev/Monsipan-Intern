/**
 * PDF-Dokumente am Artikel (und als Unterlagen an Aufträgen). Die Datenbank kennt nur Titel, Art und Prüfsumme;
 * die Dateien liegen unter /data/dokumente/<sha256>.pdf. Gleiche Dateien liegen
 * nur einmal da, auch wenn sie an mehreren Artikeln hängen.
 *
 * Wird ein Dokument gelöscht (oder alles zurückgesetzt), bleibt die Datei noch
 * eine Weile liegen: So findet eine eingespielte Sicherung ihre PDFs wieder.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { MAX_DOCUMENT_BYTES } from '$lib/documents';
import { DATA_DIR, db } from './db';
import { offerDocuments, orderDocuments, productDocuments, users } from './db/schema';
import { appendPart, isWriting, partFile } from './parts';

export const DOC_DIR = path.join(DATA_DIR, 'dokumente');

/** So lange bleiben nicht mehr verwendete Dateien liegen */
export const KEEP_UNUSED_DAYS = 90;

const PDF_MAGIC = '%PDF-';
const SHA_FILE = /^([0-9a-f]{64})\.pdf$/;

export class DocumentError extends Error {}

export const documentFile = (sha256: string) => path.join(DOC_DIR, `${sha256}.pdf`);

/**
 * Hochgeladene Datei prüfen und ablegen – gestreamt, mit Prüfsumme und
 * Größengrenze (`null`: ohne, etwa für Pläne am Auftrag). Gibt Prüfsumme und Größe zurück.
 */
export async function storeDocument(upload: File, maxBytes: number | null = MAX_DOCUMENT_BYTES): Promise<{ sha256: string; size: number }> {
	if (upload.size === 0) throw new DocumentError('Die Datei ist leer.');
	if (maxBytes !== null && upload.size > maxBytes) {
		throw new DocumentError(`Die Datei ist zu groß – erlaubt sind ${maxBytes / 1024 / 1024} MB.`);
	}
	fs.mkdirSync(DOC_DIR, { recursive: true });
	const temp = path.join(DOC_DIR, `upload-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.tmp`);
	try {
		const { sha256, size, head } = await copyChecked(Readable.fromWeb(upload.stream() as Parameters<typeof Readable.fromWeb>[0]), temp, maxBytes);
		return adopt(temp, sha256, size, head);
	} catch (err) {
		fs.rmSync(temp, { force: true });
		throw err;
	}
}

/** Strom in eine Datei schreiben (ohne `to` nur lesen) – dabei Prüfsumme, Größe und Anfang mitnehmen */
async function copyChecked(from: Readable, to: string | null, maxBytes: number | null) {
	const hash = crypto.createHash('sha256');
	let size = 0;
	let head = Buffer.alloc(0);
	const tap = new Transform({
		transform(chunk: Buffer, _enc, done) {
			size += chunk.length;
			if (maxBytes !== null && size > maxBytes) return done(new DocumentError('Die Datei ist zu groß.'));
			if (head.length < 1024) head = Buffer.concat([head, chunk]).subarray(0, 1024);
			hash.update(chunk);
			done(null, chunk);
		}
	});
	const sink = to ? fs.createWriteStream(to) : new Writable({ write: (_chunk, _enc, done) => done() });
	await pipeline(from, tap, sink);
	return { sha256: hash.digest('hex'), size, head };
}

/** Geprüfte Datei unter ihrer Prüfsumme ablegen – liegt sie schon da, bleibt es bei einer */
function adopt(temp: string, sha256: string, size: number, head: Buffer) {
	if (size === 0) throw new DocumentError('Die Datei ist leer.');
	// Die Kennung darf laut PDF-Norm in den ersten 1024 Bytes stehen
	if (!head.toString('latin1').includes(PDF_MAGIC)) throw new DocumentError('Das ist keine PDF-Datei.');
	const target = documentFile(sha256);
	if (fs.existsSync(target)) fs.rmSync(temp, { force: true });
	else fs.renameSync(temp, target);
	touch(target);
	return { sha256, size };
}

/* ----------------------------------------------------- Uploads in Teilen */

/**
 * Pläne am Auftrag dürfen beliebig groß sein: Der Browser schickt sie in Teilen
 * (siehe ./parts), abgebrochene räumt `tidyFolder` nach einem Tag weg. Am Ende
 * wird die Datei geprüft, abgelegt und bekommt einen Beleg – mit dessen
 * Kennung hängt das Formular sie dann an den Auftrag.
 */

/** Fertige Uploads, je Person und Kennung */
const finished = new Map<string, { name: string; sha256: string; size: number; at: number }>();
const finishedKey = (userId: number, id: string) => `${userId}:${id}`;
const FINISHED_TTL = 86_400_000;

/** Einen Teil anhängen – siehe `appendPart` */
export function appendUploadPart(userId: number, id: string, offset: number, part: ReadableStream<Uint8Array>) {
	return appendPart(partFile(DOC_DIR, userId, id), offset, part);
}

/** Alle Teile sind da: prüfen und ablegen, ohne Größengrenze */
export async function finishUpload(userId: number, id: string, name: string) {
	// Schon fertig (die Antwort ging unterwegs verloren)
	const done = finished.get(finishedKey(userId, id));
	if (done) return { sha256: done.sha256, size: done.size };
	const file = partFile(DOC_DIR, userId, id);
	if (isWriting(file)) throw new DocumentError('Die Datei wird noch übertragen.');
	if (!fs.existsSync(file)) throw new DocumentError('Die Datei ist leer.');
	try {
		const { sha256, size, head } = await copyChecked(fs.createReadStream(file), null, null);
		const stored = adopt(file, sha256, size, head);
		const now = Date.now();
		for (const [key, f] of finished) if (now - f.at > FINISHED_TTL) finished.delete(key);
		finished.set(finishedKey(userId, id), { name: name.trim().slice(0, 200) || 'unterlage.pdf', ...stored, at: now });
		return stored;
	} catch (err) {
		fs.rmSync(file, { force: true });
		throw err;
	}
}

/** Fertige Uploads dieser Person einlösen – jeden einmal */
export function takeUploads(userId: number, ids: string[]): { name: string; sha256: string; size: number }[] {
	const keys = ids.map((id) => finishedKey(userId, id));
	const found = keys.map((key) => finished.get(key));
	if (found.some((f) => !f)) throw new DocumentError('Eine Datei ist nicht vollständig angekommen – bitte noch einmal hochladen.');
	for (const key of keys) finished.delete(key);
	return found.map((f) => ({ name: f!.name, sha256: f!.sha256, size: f!.size }));
}

function touch(file: string) {
	const now = new Date();
	try {
		fs.utimesSync(file, now, now);
	} catch {
		/* unkritisch */
	}
}

/**
 * PDF ausliefern – zum Anzeigen oder mit ?download zum Speichern. Der Inhalt
 * ändert sich nie, die Prüfsumme taugt als ETag. Wer es sehen darf, prüft der Aufrufer.
 */
export function documentResponse(doc: { sha256: string; fileName: string }, url: URL, request: Request): Response {
	const file = documentFile(doc.sha256);
	if (!fs.existsSync(file)) error(410, 'Die Datei zu dieser Unterlage ist nicht mehr vorhanden.');
	const etag = `"${doc.sha256}"`;
	const headers: Record<string, string> = { etag, 'cache-control': 'private, max-age=86400' };
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });

	const ascii = doc.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
	const disposition = url.searchParams.has('download') ? 'attachment' : 'inline';
	return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
		headers: {
			...headers,
			'content-type': 'application/pdf',
			'content-length': String(fs.statSync(file).size),
			'content-disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`
		}
	});
}

/** Dokumente eines Artikels, neueste zuerst innerhalb der Art */
export function listDocuments(productId: number) {
	return db
		.select({
			id: productDocuments.id,
			kind: productDocuments.kind,
			title: productDocuments.title,
			fileName: productDocuments.fileName,
			size: productDocuments.size,
			createdAt: productDocuments.createdAt,
			uploadedBy: sql<string | null>`nullif(trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')), '')`
		})
		.from(productDocuments)
		.leftJoin(users, eq(users.id, productDocuments.uploadedBy))
		.where(eq(productDocuments.productId, productId))
		.orderBy(asc(productDocuments.kind), asc(productDocuments.title))
		.all();
}

/**
 * Aufräumen, einmal am Tag: Dateien, die ein Dokument benutzt, gelten als
 * frisch (Änderungszeit = heute). Dateien, die seit KEEP_UNUSED_DAYS niemand
 * mehr benutzt, werden gelöscht. Abgebrochene Uploads nach einem Tag.
 */
export async function tidyDocuments(now = new Date()): Promise<{ removed: number }> {
	// Benutzt sind die PDFs an Artikeln, Aufträgen und Angeboten
	const [products, orders, offers] = await Promise.all([
		db.select({ sha: productDocuments.sha256 }).from(productDocuments).all(),
		db.select({ sha: orderDocuments.sha256 }).from(orderDocuments).all(),
		db.select({ sha: offerDocuments.sha256 }).from(offerDocuments).all()
	]);
	return tidyFolder(DOC_DIR, SHA_FILE, new Set([...products, ...orders, ...offers].map((r) => r.sha)), now);
}

/**
 * Ordner mit Dateien nach Prüfsumme aufräumen (auch für die Fotos der
 * Tagesberichte): `pattern` liefert in Gruppe 1 die Prüfsumme aus dem Dateinamen.
 */
export function tidyFolder(dir: string, pattern: RegExp, used: Set<string>, now = new Date()): { removed: number } {
	if (!fs.existsSync(dir)) return { removed: 0 };
	const unusedSince = now.getTime() - KEEP_UNUSED_DAYS * 86_400_000;
	const staleUpload = now.getTime() - 86_400_000;
	let removed = 0;
	for (const name of fs.readdirSync(dir)) {
		const file = path.join(dir, name);
		try {
			const match = pattern.exec(name);
			if (!match) {
				if (name.endsWith('.tmp') && fs.statSync(file).mtimeMs < staleUpload) fs.rmSync(file, { force: true });
				continue;
			}
			if (used.has(match[1])) {
				fs.utimesSync(file, now, now);
			} else if (fs.statSync(file).mtimeMs < unusedSince) {
				fs.rmSync(file, { force: true });
				removed++;
			}
		} catch {
			/* einzelne Datei nicht lesbar – nächstes Mal wieder */
		}
	}
	return { removed };
}
