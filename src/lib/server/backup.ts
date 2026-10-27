import fs from 'node:fs';
import path from 'node:path';
import { client, DATA_DIR } from './db';
import { purgeExpired } from './auth';
import { tidyDocuments } from './documents';
import { purgeOldNotifications } from './notifications';
import { purgeOldPositions } from '$lib/modules/fuhrpark/server/vehicles';
import { sweepParts } from './parts';
import { notifyOverdueInvoices } from '$lib/modules/auftraege/server/invoices';
import { checkArchive } from '$lib/modules/auftraege/server/signatur/verification';
import { tidyPhotos } from '$lib/modules/tagesberichte/server/photos';
import { backfillWorkOrderPlans } from '$lib/modules/planung/server/plan';
import { tidyBelege } from '$lib/modules/planung/server/belege';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/** Art der Sicherung – steht im Dateinamen und entscheidet, wie lange sie bleibt */
export const BACKUP_SUFFIX = {
	regular: '',
	'before-reset': '-vor-reset',
	'before-restore': '-vor-restore'
} as const;
export type BackupKind = keyof typeof BACKUP_SUFFIX;

const KEEP: Record<BackupKind, number> = { regular: 14, 'before-reset': 10, 'before-restore': 10 };

export const BACKUP_LABELS: Record<BackupKind, string> = {
	regular: '',
	'before-reset': 'vor dem Zurücksetzen',
	'before-restore': 'vor dem Wiederherstellen'
};

/** Gültige Dateinamen – auch zum Absichern des Downloads */
export const BACKUP_FILE_RE = /^lager-[\d-]+(-vor-reset|-vor-restore)?\.db$/;

function kindOf(file: string): BackupKind {
	if (file.includes(BACKUP_SUFFIX['before-reset'])) return 'before-reset';
	if (file.includes(BACKUP_SUFFIX['before-restore'])) return 'before-restore';
	return 'regular';
}

export interface BackupFile {
	file: string;
	size: number;
	createdAt: Date;
	kind: BackupKind;
	label: string;
}

export function listBackups(): BackupFile[] {
	if (!fs.existsSync(BACKUP_DIR)) return [];
	return fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => BACKUP_FILE_RE.test(f))
		.map((f) => {
			const stat = fs.statSync(path.join(BACKUP_DIR, f));
			const kind = kindOf(f);
			return { file: f, size: stat.size, createdAt: stat.mtime, kind, label: BACKUP_LABELS[kind] };
		})
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Konsistente Kopie der laufenden Datenbank (VACUUM INTO). Vorhandene Sicherungen
 * werden nie überschrieben; alte Stände werden getrennt nach Art aufgeräumt.
 */
export async function createBackup(kind: BackupKind = 'regular'): Promise<string> {
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	const suffix = BACKUP_SUFFIX[kind];
	let name = `lager-${stamp}${suffix}.db`;
	for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, name)); i++) name = `lager-${stamp}-${i}${suffix}.db`;
	await client.execute({ sql: 'VACUUM INTO ?', args: [path.join(BACKUP_DIR, name)] });

	const all = listBackups();
	for (const k of Object.keys(KEEP) as BackupKind[]) {
		for (const old of all.filter((b) => b.kind === k).slice(KEEP[k])) {
			fs.rmSync(path.join(BACKUP_DIR, old.file), { force: true });
		}
	}
	return name;
}

const TEMP_FILE_RE = /^(restore|upload)-[0-9a-z]+-[0-9a-z]+\.db(-wal|-shm)?$/;

let sweepPaused = 0;

/** Während einer Wiederherstellung nichts aufräumen – die Zwischendateien sind in Benutzung */
export function pauseSweep(): () => void {
	sweepPaused++;
	let done = false;
	return () => {
		if (done) return;
		done = true;
		sweepPaused--;
	};
}

/**
 * Zwischendateien vom Wiederherstellen aufräumen. Unter Windows bleibt eine
 * gerade benutzte Datenbankdatei gesperrt – dann klappt es beim nächsten Start.
 * `keep` schützt die Datei, die gerade eingespielt wird (samt -wal und -shm).
 */
export function sweepTempFiles(keep?: string) {
	if (sweepPaused > 0 && !keep) return;
	const keepName = keep ? path.basename(keep) : null;
	try {
		for (const name of fs.readdirSync(DATA_DIR)) {
			if (!TEMP_FILE_RE.test(name)) continue;
			if (keepName && (name === keepName || name.startsWith(`${keepName}-`))) continue;
			try {
				fs.rmSync(path.join(DATA_DIR, name), { force: true });
			} catch {
				/* noch gesperrt */
			}
		}
	} catch {
		/* Ordner nicht lesbar */
	}
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastTidy = '';

/** Stündlich prüfen: einmal pro Nacht (ab 2 Uhr) sichern und Altlasten löschen */
export function scheduleMaintenance() {
	if (timer) return;
	const tick = async () => {
		try {
			const now = new Date();
			const today = now.toDateString();
			const latest = listBackups().find((b) => b.kind === 'regular');
			if (now.getHours() >= 2 && (!latest || latest.createdAt.toDateString() !== today)) {
				const name = await createBackup();
				console.info(`[backup] ${name} erstellt`);
			}
			await purgeExpired();
			sweepTempFiles();
			// Hochgeladene Sicherungen, die nie eingespielt wurden
			sweepParts(BACKUP_DIR);
			// PDFs und Fotos einmal am Tag: benutzte markieren, lange unbenutzte löschen
			if (lastTidy !== today) {
				lastTidy = today;
				const { removed } = await tidyDocuments(now);
				if (removed) console.info(`[dokumente] ${removed} unbenutzte PDF-Dateien gelöscht`);
				const photos = await tidyPhotos(now);
				if (photos.removed) console.info(`[fotos] ${photos.removed} unbenutzte Bilddateien gelöscht`);
				const belege = await tidyBelege(now);
				if (belege.removed) console.info(`[krankmeldungen] ${belege.removed} unbenutzte Belege gelöscht`);
				await purgeOldNotifications(now);
				const positions = await purgeOldPositions(now);
				if (positions) console.info(`[fahrzeuge] ${positions} Standorte älter als 90 Tage gelöscht`);
				// Ausgestellte Rechnungen: Dateien, Prüfsummen, Daten, Signaturen und die Protokoll-Kette
				const archive = await checkArchive();
				if (archive.problems.length || !archive.audit.ok) console.warn(`[rechnungen] Archivprüfung: ${archive.problems.length} mit Fehlern, Protokoll ${archive.audit.ok ? 'in Ordnung' : 'unterbrochen'}`);
			}
			// Einmalig: Arbeitsaufträge mit Termin und Partie von vor dem Update in die Wochenplanung
			const planned = await backfillWorkOrderPlans();
			if (planned) console.info(`[planung] ${planned} Arbeitsaufträge mit Termin in die Wochenplanung eingetragen`);
			// Überfällige Rechnungen melden – ab 7 Uhr, damit es nicht nachts summt
			if (now.getHours() >= 7) await notifyOverdueInvoices();
		} catch (err) {
			console.error('[backup]', err);
		}
	};
	timer = setInterval(tick, 60 * 60_000);
	timer.unref?.();
	setTimeout(tick, 30_000).unref?.();
}
