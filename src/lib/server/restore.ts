/**
 * Sicherung wiederherstellen: entweder eine Datei aus /data/backups oder eine
 * hochgeladene – .db-Datei oder Komplettsicherung als ZIP (siehe ./backup-zip,
 * `restoreUpload` unten). Ablauf: prüfen, auf den aktuellen Schemastand
 * migrieren, Sicherung des jetzigen Standes anlegen und dann den gesamten
 * Inhalt in einer Transaktion ersetzen.
 *
 * Die Datenbankdatei wird bewusst nicht ausgetauscht: Windows gibt sie nach dem
 * Schließen nicht sofort frei, und laufende Anfragen würden ins Leere greifen.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import yauzl from 'yauzl';
import { APP_NAME } from '$lib/app';
import { ARCHIVE_DIR } from '$lib/modules/auftraege/server/signatur/archive';
import { BACKUP_DIR, BACKUP_FILE_RE, createBackup, pauseSweep, sweepTempFiles } from './backup';
import { DB_ENTRY, FILE_FOLDERS, MANIFEST_ENTRY, promisedHash, SIGNATUR_DIR } from './backup-zip';
import { client, DATA_DIR, migrationsPath } from './db';
import { broadcast } from './events';
import { clearSettingsCache } from './settings';

/** Größte erlaubte Datei beim Hochladen */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const SQLITE_HEADER = 'SQLite format 3\0';
const NEEDED_TABLES = ['users', 'products', 'movements', 'stock', 'locations'];
/** Verwaltungstabellen, die nicht mitkopiert werden */
const SKIP_TABLES = new Set(['__drizzle_migrations']);
const CHUNK = 200;

export class RestoreError extends Error {}

/**
 * Zwischendateien bekommen eindeutige Namen: Windows gibt eine gerade
 * geschlossene Datenbankdatei erst später frei, Löschen darf also scheitern.
 */
const tempFile = (prefix: string) => path.join(DATA_DIR, `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.db`);

/** Stammt die Datei aus einem Upload? Die darf nach dem Einspielen weg. */
const isUpload = (file: string) => path.basename(file).startsWith('upload-');

function removeQuietly(file: string) {
	for (const suffix of ['', '-wal', '-shm']) {
		try {
			fs.rmSync(file + suffix, { force: true });
		} catch {
			/* noch gesperrt – wird beim nächsten Mal aufgeräumt */
		}
	}
}

export interface BackupContents {
	products: number;
	movements: number;
	users: number;
	locations: number;
	/** Änderungszeitpunkt der Datei */
	createdAt: Date;
	size: number;
}

function assertSqlite(file: string) {
	const head = Buffer.alloc(16);
	const fd = fs.openSync(file, 'r');
	try {
		fs.readSync(fd, head, 0, 16, 0);
	} finally {
		fs.closeSync(fd);
	}
	if (head.toString('latin1') !== SQLITE_HEADER) throw new RestoreError('Das ist keine SQLite-Datenbank.');
}

const tableNames = async (c: Client) =>
	(await c.execute("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")).rows.map((r) => String(r.name));

/** Datei prüfen und die wichtigsten Zahlen lesen – die laufende Datenbank bleibt unberührt */
export async function inspectBackup(file: string): Promise<BackupContents> {
	if (!fs.existsSync(file)) throw new RestoreError('Datei nicht gefunden.');
	assertSqlite(file);
	const c = createClient({ url: `file:${file}` });
	try {
		const check = await c.execute('PRAGMA quick_check');
		if (String(check.rows[0]?.[0] ?? '') !== 'ok') throw new RestoreError('Die Datei ist beschädigt.');
		const names = new Set(await tableNames(c));
		for (const t of NEEDED_TABLES) {
			if (!names.has(t)) throw new RestoreError(`Diese Datei ist keine Sicherung von ${APP_NAME}.`);
		}
		const count = async (table: string) => Number((await c.execute(`select count(*) as n from "${table}"`)).rows[0].n ?? 0);
		const stat = fs.statSync(file);
		return {
			products: await count('products'),
			movements: await count('movements'),
			users: await count('users'),
			locations: await count('locations'),
			createdAt: stat.mtime,
			size: stat.size
		};
	} catch (err) {
		if (err instanceof RestoreError) throw err;
		throw new RestoreError('Die Datei konnte nicht gelesen werden.');
	} finally {
		c.close();
	}
}

/** Sicherung aus dem Ordner /data/backups */
export function backupPath(file: string): string {
	if (!BACKUP_FILE_RE.test(file)) throw new RestoreError('Unbekannte Sicherung.');
	return path.join(BACKUP_DIR, file);
}

/** Hochgeladene Datei zwischenspeichern, ohne sie komplett in den Speicher zu laden */
export async function stageUpload(upload: File): Promise<string> {
	if (upload.size === 0) throw new RestoreError('Die Datei ist leer.');
	if (upload.size > MAX_UPLOAD_BYTES) throw new RestoreError('Die Datei ist zu groß.');
	const target = tempFile('upload');
	await pipeline(Readable.fromWeb(upload.stream() as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(target));
	return target;
}

/** Ältere Sicherung auf den aktuellen Schemastand bringen */
async function migrateFile(file: string) {
	const c = createClient({ url: `file:${file}` });
	try {
		await migrate(drizzle(c), { migrationsFolder: migrationsPath() });
	} catch {
		throw new RestoreError('Die Sicherung passt nicht zur aktuellen Version und konnte nicht angepasst werden.');
	} finally {
		c.close();
	}
}

/** Tabellen so sortieren, dass Eltern vor ihren Kindern stehen (Fremdschlüssel) */
async function inDependencyOrder(c: Client, tables: string[]): Promise<string[]> {
	const parents = new Map<string, string[]>();
	for (const t of tables) {
		const fks = await c.execute(`PRAGMA foreign_key_list("${t}")`);
		const refs = [...new Set(fks.rows.map((r) => String(r.table)))].filter((p) => p !== t && tables.includes(p));
		parents.set(t, refs);
	}
	const out: string[] = [];
	const seen = new Set<string>();
	const visit = (t: string, stack: Set<string>) => {
		if (seen.has(t) || stack.has(t)) return;
		stack.add(t);
		for (const p of parents.get(t) ?? []) visit(p, stack);
		stack.delete(t);
		seen.add(t);
		out.push(t);
	};
	for (const t of tables) visit(t, new Set());
	return out;
}

/** Gesamten Inhalt der Quelldatei übernehmen – alles oder nichts */
async function replaceContents(sourceFile: string) {
	const src = createClient({ url: `file:${sourceFile}` });
	let order: string[];
	const data = new Map<string, { columns: string[]; rows: unknown[][] }>();
	try {
		const target = new Set(await tableNames(client));
		const tables = (await tableNames(src)).filter((t) => target.has(t) && !SKIP_TABLES.has(t));
		order = await inDependencyOrder(client, tables);
		for (const t of order) {
			const res = await src.execute(`select * from "${t}"`);
			data.set(t, { columns: res.columns, rows: res.rows.map((row) => res.columns.map((c) => row[c] ?? null)) });
		}
	} finally {
		src.close();
	}

	const tx = await client.transaction('write');
	try {
		// Fremdschlüssel erst beim Abschluss prüfen – die Reihenfolge ist dann egal
		await tx.execute('PRAGMA defer_foreign_keys = ON');
		// Die Sperren ausgestellter Rechnungen (Trigger) gelten für den Betrieb, nicht für das Einspielen:
		// in derselben Transaktion ablegen und danach unverändert wieder anlegen
		const triggers = (await tx.execute("select name, sql from sqlite_master where type = 'trigger' and sql is not null")).rows.map((r) => ({
			name: String(r.name),
			sql: String(r.sql)
		}));
		for (const t of triggers) await tx.execute(`drop trigger "${t.name}"`);
		for (const t of [...order].reverse()) await tx.execute(`delete from "${t}"`);
		for (const t of order) {
			const { columns, rows } = data.get(t)!;
			if (!rows.length) continue;
			const cols = columns.map((c) => `"${c}"`).join(', ');
			const values = `(${columns.map(() => '?').join(', ')})`;
			for (let i = 0; i < rows.length; i += CHUNK) {
				const chunk = rows.slice(i, i + CHUNK);
				await tx.execute({
					sql: `insert into "${t}" (${cols}) values ${chunk.map(() => values).join(', ')}`,
					args: chunk.flat() as never[]
				});
			}
		}
		for (const t of triggers) await tx.execute(t.sql);
		await tx.commit();
	} catch (err) {
		await tx.rollback().catch(() => {});
		console.error('[restore]', err);
		throw new RestoreError('Die Sicherung konnte nicht übernommen werden – der bisherige Stand ist unverändert.');
	}
}

export interface RestoreResult {
	/** Sicherung des Standes von vorher */
	backup: string;
	contents: BackupContents;
}

/**
 * Spielt die Datei ein. Danach gelten die Anmeldungen aus der Sicherung –
 * wer gerade angemeldet ist, muss sich neu anmelden.
 */
export async function restoreFromFile(source: string, label: string): Promise<RestoreResult> {
	// Während des Einspielens räumt die Wartung nicht dazwischen
	const resume = pauseSweep();
	let staged: string | null = null;
	try {
		const contents = await inspectBackup(source);

		// Altlasten weg – aber niemals die Datei, die gerade eingespielt wird
		sweepTempFiles(source);
		// Auf einer Kopie arbeiten: die Sicherung selbst bleibt, wie sie ist
		staged = tempFile('restore');
		fs.copyFileSync(source, staged);

		const backup = await createBackup('before-restore');
		await migrateFile(staged);
		await replaceContents(staged);

		clearSettingsCache();
		broadcast('stock', { productIds: [] });
		console.warn(`[restore] ${label} eingespielt (${contents.products} Artikel, ${contents.movements} Bewegungen); vorher gesichert als ${backup}`);
		return { backup, contents };
	} finally {
		if (staged) removeQuietly(staged);
		if (isUpload(source)) removeQuietly(source);
		resume();
	}
}

/* ------------------------------------------------------ Komplettsicherung */

export interface FileRestore {
	/** Neu angelegt */
	added: number;
	/** Lag schon da */
	present: number;
	/** Beschädigt oder nicht vorgesehen – nicht übernommen */
	skipped: number;
}

export interface UploadRestoreResult extends RestoreResult {
	/** Nur bei einer ZIP-Datei */
	files: FileRestore | null;
}

/** ZIP-Datei (Komplettsicherung) oder reine Datenbank? */
export function isZipFile(file: string): boolean {
	const head = Buffer.alloc(4);
	const fd = fs.openSync(file, 'r');
	try {
		fs.readSync(fd, head, 0, 4, 0);
	} finally {
		fs.closeSync(fd);
	}
	return head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}

async function openZip(file: string) {
	try {
		return await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, strictFileNames: true });
	} catch {
		throw new RestoreError('Die ZIP-Datei ist beschädigt oder unvollständig.');
	}
}

/** Eintrag in eine Datei schreiben und dabei Größe, CRC-32 und SHA-256 bestimmen */
async function writeEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, target: string) {
	const sha = crypto.createHash('sha256');
	let crc = 0;
	let size = 0;
	const tap = new Transform({
		transform(chunk: Buffer, _enc, done) {
			crc = zlib.crc32(chunk, crc);
			sha.update(chunk);
			size += chunk.length;
			done(null, chunk);
		}
	});
	await pipeline(await zip.openReadStreamPromise(entry), tap, fs.createWriteStream(target));
	return { ok: size === entry.uncompressedSize && crc === entry.crc32, sha256: sha.digest('hex') };
}

/** Die Datenbank aus der ZIP-Datei holen – zum Prüfen und Einspielen wie eine .db-Datei */
async function extractDatabase(file: string): Promise<string> {
	const zip = await openZip(file);
	const target = tempFile('upload');
	try {
		for await (const entry of zip.eachEntry()) {
			if (entry.fileName !== DB_ENTRY) continue;
			if (!(await writeEntry(zip, entry, target)).ok) throw new RestoreError('Die Datenbank in der ZIP-Datei ist beschädigt.');
			return target;
		}
		throw new RestoreError(`In der ZIP-Datei fehlt die Datenbank – ist das eine Sicherung von ${APP_NAME}?`);
	} catch (err) {
		removeQuietly(target);
		if (err instanceof RestoreError) throw err;
		throw new RestoreError('Die ZIP-Datei ließ sich nicht lesen.');
	} finally {
		zip.close();
	}
}

/**
 * Dateien aus der ZIP-Datei übernehmen. Was schon da ist, bleibt unberührt –
 * die Namen sind Prüfsummen, gleicher Name heißt gleicher Inhalt. Jede Datei
 * wird geprüft (CRC-32 und, wo der Name sie trägt, SHA-256); Beschädigtes und
 * nicht Vorgesehenes bleibt draußen.
 *
 * Der Signaturschlüssel kommt getrennt (`key`), erst nach der Datenbank: Er
 * gehört zum Zertifikat darin. Ein anderer vorhandener Schlüssel bleibt als
 * siegel-vor-restore-….pem daneben liegen.
 */
async function restoreDataFiles(file: string, which: 'files' | 'key'): Promise<FileRestore> {
	const result: FileRestore = { added: 0, present: 0, skipped: 0 };
	const zip = await openZip(file);
	try {
		for await (const entry of zip.eachEntry()) {
			const name = entry.fileName;
			if (name.endsWith('/') || name === DB_ENTRY || name === MANIFEST_ENTRY) continue;
			const slash = name.indexOf('/');
			const folder = FILE_FOLDERS.find((f) => f.name === name.slice(0, slash));
			const rel = name.slice(slash + 1);
			if (!folder || !folder.pattern.test(rel)) {
				if (which === 'files') result.skipped++;
				continue;
			}
			const isKey = folder.dir === SIGNATUR_DIR;
			if (isKey !== (which === 'key')) continue;

			const target = path.join(folder.dir, ...rel.split('/'));
			if (fs.existsSync(target) && !isKey) {
				result.present++;
				continue;
			}
			fs.mkdirSync(path.dirname(target), { recursive: true });
			const temp = `${target}.${Date.now().toString(36)}.tmp`;
			try {
				const written = await writeEntry(zip, entry, temp);
				const promised = promisedHash(rel);
				if (!written.ok || (promised && !written.sha256.startsWith(promised))) {
					console.warn(`[restore] ${name} ist beschädigt und wurde nicht übernommen`);
					result.skipped++;
					continue;
				}
				if (isKey && fs.existsSync(target)) {
					if (fs.readFileSync(target).equals(fs.readFileSync(temp))) {
						result.present++;
						continue;
					}
					const stamp = new Date().toISOString().slice(0, 19).replace(/\D/g, '');
					fs.copyFileSync(target, path.join(folder.dir, `siegel-vor-restore-${stamp}.pem`));
				}
				fs.renameSync(temp, target);
				// Archivierte Rechnungen bleiben schreibgeschützt wie beim Ausstellen
				if (folder.dir === ARCHIVE_DIR) fs.chmodSync(target, 0o444);
				result.added++;
			} finally {
				fs.rmSync(temp, { force: true });
			}
		}
	} catch (err) {
		if (err instanceof RestoreError) throw err;
		console.error('[restore]', err);
		throw new RestoreError('Die Dateien aus der ZIP-Datei ließen sich nicht vollständig übernehmen – die Datenbank ist unverändert.');
	} finally {
		zip.close();
	}
	return result;
}

/**
 * Hochgeladene Sicherung einspielen: eine ZIP-Datei (Komplettsicherung) oder
 * eine reine Datenbank (.db, auch ältere Sicherungen). Bei der ZIP-Datei erst
 * die Datenbank prüfen, dann die fehlenden Dateien ergänzen, dann die
 * Datenbank einspielen und zuletzt den Signaturschlüssel.
 */
export async function restoreUpload(file: string, label: string): Promise<UploadRestoreResult> {
	if (!isZipFile(file)) return { ...(await restoreFromFile(file, label)), files: null };
	const dbFile = await extractDatabase(file);
	try {
		await inspectBackup(dbFile);
		const files = await restoreDataFiles(file, 'files');
		const result = await restoreFromFile(dbFile, label);
		const key = await restoreDataFiles(file, 'key');
		const total = { added: files.added + key.added, present: files.present + key.present, skipped: files.skipped };
		console.warn(`[restore] Dateien: ${total.added} ergänzt, ${total.present} schon vorhanden, ${total.skipped} nicht übernommen`);
		return { ...result, files: total };
	} finally {
		removeQuietly(dbFile);
	}
}
