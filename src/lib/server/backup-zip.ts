/**
 * Komplettsicherung als ZIP-Datei: die Datenbank (eine Sicherung aus
 * /data/backups) und alle Dateien aus /data – PDFs an Artikeln und Pläne an
 * Aufträgen, Fotos der Tagesberichte, Krankmeldungen, Briefkopf, das
 * Rechnungsarchiv und der Schlüssel der Rechnungssignatur.
 *
 * Die nächtlichen Sicherungen bleiben reine Datenbank-Kopien – sonst läge jede
 * Datei 14-mal am Server. Die ZIP-Datei entsteht erst beim Herunterladen. Das
 * passt, weil sich keine Datei je ändert (der Name ist ihre Prüfsumme bzw. die
 * Rechnung im Archiv) und gelöschte 90 Tage liegen bleiben.
 *
 * Eingespielt wird sie in ./restore (`restoreUpload`).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import yazl from 'yazl';
import { APP_NAME } from '$lib/app';
import { ARCHIVE_DIR } from '$lib/modules/auftraege/server/signatur/archive';
import { BELEG_DIR } from '$lib/modules/planung/server/belege';
import { PHOTO_DIR } from '$lib/modules/tagesberichte/server/photos';
import { DATA_DIR } from './db';
import { DOC_DIR } from './documents';
import { LETTERHEAD_DIR } from './letterhead';

/** Beschreibung der Sicherung in der ZIP-Datei */
export const MANIFEST_ENTRY = 'monsipan-sicherung.json';
export const DB_ENTRY = 'lager.db';

export interface FileFolder {
	/** Ordner in /data und in der ZIP-Datei */
	name: string;
	dir: string;
	/** Erlaubte Dateien (Pfad relativ zum Ordner, mit /) – alles andere bleibt draußen */
	pattern: RegExp;
	label: string;
}

/** Der Schlüssel für die Rechnungssignatur (ohne SIGNATUR_DATEI) */
export const SIGNATUR_DIR = path.join(DATA_DIR, 'signatur');

export const FILE_FOLDERS: FileFolder[] = [
	{ name: 'dokumente', dir: DOC_DIR, pattern: /^[0-9a-f]{64}\.pdf$/, label: 'PDFs (Artikel, Aufträge, Angebote, Anfragen, Richtlinien)' },
	{ name: 'fotos', dir: PHOTO_DIR, pattern: /^[0-9a-f]{64}\.jpg$/, label: 'Fotos (Tagesberichte, Anfragen, Angebote)' },
	{ name: 'krankmeldungen', dir: BELEG_DIR, pattern: /^[0-9a-f]{64}\.(?:jpg|pdf)$/, label: 'Krankmeldungen' },
	{ name: 'briefkopf', dir: LETTERHEAD_DIR, pattern: /^[0-9a-f]{64}\.(?:png|jpg)$/, label: 'Briefkopf' },
	{ name: 'rechnungen', dir: ARCHIVE_DIR, pattern: /^\d{4}\/[\w.-]+_[0-9a-f]{12}\.pdf$/, label: 'Rechnungsarchiv' },
	{ name: 'signatur', dir: SIGNATUR_DIR, pattern: /^siegel\.pem$/, label: 'Schlüssel der Rechnungssignatur' }
];

/**
 * Prüfsumme, die der Dateiname verspricht: ganz (64 Zeichen) oder – im
 * Rechnungsarchiv – ihr Anfang (12 Zeichen). Der Schlüssel hat keine.
 */
export function promisedHash(rel: string): string | null {
	const name = rel.split('/').pop() ?? '';
	return /^([0-9a-f]{64})\./.exec(name)?.[1] ?? /_([0-9a-f]{12})\.pdf$/.exec(name)?.[1] ?? null;
}

export interface DataFile {
	folder: FileFolder;
	/** Relativ zum Ordner, mit / */
	rel: string;
	full: string;
	size: number;
}

/** Alle Dateien, die in eine Komplettsicherung gehören */
export function listDataFiles(): DataFile[] {
	const out: DataFile[] = [];
	const walk = (folder: FileFolder, dir: string, prefix: string) => {
		let names: fs.Dirent[];
		try {
			names = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const d of names) {
			const rel = prefix + d.name;
			const full = path.join(dir, d.name);
			if (d.isDirectory()) walk(folder, full, `${rel}/`);
			else if (d.isFile() && folder.pattern.test(rel)) out.push({ folder, rel, full, size: fs.statSync(full).size });
		}
	};
	for (const folder of FILE_FOLDERS) walk(folder, folder.dir, '');
	return out;
}

/** Wie viele Dateien und wie groß – für die Einstellungen */
export function dataFilesSummary() {
	const files = listDataFiles();
	return { count: files.length, size: files.reduce((sum, f) => sum + f.size, 0) };
}

/**
 * ZIP-Datei mit der Datenbank-Sicherung `snapshot` und allen Dateien – als
 * Strom, mit der Größe vorab (alles unkomprimiert: PDFs und Fotos sind es schon,
 * und so zeigt der Browser beim Herunterladen den Fortschritt).
 */
export async function backupZip(snapshot: string): Promise<{ stream: Readable; size: number; files: number }> {
	const files = listDataFiles();
	const zip = new yazl.ZipFile();
	const manifest = {
		app: APP_NAME,
		format: 1,
		erstellt: new Date().toISOString(),
		sicherung: path.basename(snapshot),
		datenbank: DB_ENTRY,
		dateien: Object.fromEntries(FILE_FOLDERS.map((f) => [f.name, files.filter((x) => x.folder === f).length]))
	};
	zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, '\t')), MANIFEST_ENTRY, { compress: false });
	zip.addFile(snapshot, DB_ENTRY, { compress: false });
	for (const f of files) zip.addFile(f.full, `${f.folder.name}/${f.rel}`, { compress: false });

	const stream = zip.outputStream as unknown as Readable;
	const size = await new Promise<number>((resolve, reject) => {
		zip.once('error', reject);
		(zip.end as unknown as (options: object, done: (size: number) => void) => void)({}, resolve);
	});
	// Fehler beim Lesen einer Datei (etwa gerade gelöscht) brechen den Download ab, statt ihn hängen zu lassen
	zip.on('error', (err: Error) => stream.destroy(err));
	return { stream, size, files: files.length };
}

/** Dateiname zum Herunterladen: lager-2026-10-13-021500.db → monsipan-sicherung-2026-10-13-021500.zip */
export const zipName = (snapshotFile: string) => snapshotFile.replace(/^lager-/, 'monsipan-sicherung-').replace(/\.db$/, '.zip');
