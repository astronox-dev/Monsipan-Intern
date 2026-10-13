import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import yauzl from 'yauzl';
import yazl from 'yazl';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'komplett-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, ensureDatabase } = await import('./db');
const { categories, products } = await import('./db/schema');
const { BACKUP_DIR, createBackup } = await import('./backup');
const { backupZip, dataFilesSummary, zipName } = await import('./backup-zip');
const { restoreUpload, RestoreError } = await import('./restore');

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

/** Datei in /data anlegen; gibt den vollen Pfad zurück */
function put(rel: string, content: Buffer | string) {
	const full = path.join(TMP, ...rel.split('/'));
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return full;
}

async function entries(zipFile: string) {
	const zip = await yauzl.openPromise(zipFile, { lazyEntries: true, autoClose: false });
	const names: string[] = [];
	for await (const e of zip.eachEntry()) names.push(e.fileName);
	zip.close();
	return names.sort();
}

const productNames = async () => (await db.select({ name: products.name }).from(products).all()).map((p) => p.name).sort();

async function addProduct(name: string) {
	const category = await db.insert(categories).values({ name: `Art ${name}` }).returning({ id: categories.id }).get();
	await db.insert(products).values({ name, unit: 'Stk', categoryId: category.id, searchText: name.toLowerCase() }).run();
}

const plan = pdf('Polierplan EG');
const foto = Buffer.from('JPEG-Testbild');
const rechnung = pdf('Rechnung 26 001');
const PLAN = `dokumente/${sha(plan)}.pdf`;
const FOTO = `fotos/${sha(foto)}.jpg`;
const RECHNUNG = `rechnungen/2026/26_001_rechnung_${sha(rechnung).slice(0, 12)}.pdf`;
const KEY = 'signatur/siegel.pem';
const ZIP = path.join(TMP, 'sicherung.zip');

beforeAll(async () => {
	await ensureDatabase();
});

afterAll(() => {
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		// Windows gibt die geöffnete Datenbank erst nach dem Prozessende frei
	}
});

describe('Komplettsicherung', () => {
	it('packt Datenbank und alle Dateien in die ZIP-Datei – sonst nichts', async () => {
		await addProduct('Markierfarbe weiß');
		put(PLAN, plan);
		put(FOTO, foto);
		put(RECHNUNG, rechnung);
		put(KEY, '-----BEGIN ENCRYPTED PRIVATE KEY----- alt');
		// Gehört nicht dazu: halbe Uploads und Fremdes
		put('dokumente/teil-1-abcdefabcdefabcdef.tmp', 'halb');
		put('fotos/notiz.txt', 'x');

		expect(dataFilesSummary()).toEqual({ count: 4, size: plan.length + foto.length + rechnung.length + 41 });
		const snapshot = await createBackup();
		expect(zipName(snapshot)).toMatch(/^monsipan-sicherung-[\d-]+\.zip$/);

		const zip = await backupZip(path.join(BACKUP_DIR, snapshot));
		await pipeline(zip.stream, fs.createWriteStream(ZIP));
		expect(fs.statSync(ZIP).size).toBe(zip.size);
		expect(zip.files).toBe(4);
		expect(await entries(ZIP)).toEqual([FOTO, PLAN, 'lager.db', 'monsipan-sicherung.json', RECHNUNG, KEY].sort());
	});

	it('bringt verlorene Dateien und den Stand der Datenbank zurück', async () => {
		// Server kaputt: Plan und Rechnung weg, ein anderer Schlüssel, neue Einträge
		fs.rmSync(path.join(TMP, PLAN));
		fs.rmSync(path.join(TMP, RECHNUNG));
		put(KEY, '-----BEGIN ENCRYPTED PRIVATE KEY----- neu');
		await addProduct('Später angelegt');

		const result = await restoreUpload(ZIP, 'sicherung.zip');
		expect(result.files).toEqual({ added: 3, present: 1, skipped: 0 });
		expect(await productNames()).toEqual(['Markierfarbe weiß']);
		expect(fs.readFileSync(path.join(TMP, PLAN))).toEqual(plan);
		expect(fs.readFileSync(path.join(TMP, RECHNUNG))).toEqual(rechnung);
		expect(fs.readFileSync(path.join(TMP, KEY), 'utf8')).toMatch(/alt$/);
		// Der Schlüssel von vorher bleibt daneben liegen
		const old = fs.readdirSync(path.join(TMP, 'signatur')).filter((f) => f.startsWith('siegel-vor-restore-'));
		expect(old).toHaveLength(1);
		expect(fs.readFileSync(path.join(TMP, 'signatur', old[0]), 'utf8')).toMatch(/neu$/);
		// Die ZIP-Datei bleibt, wie sie ist (Zwischendateien räumt sweepTempFiles – unter Windows erst, wenn sie frei sind)
		expect(fs.existsSync(ZIP)).toBe(true);
	});

	it('übernimmt Beschädigtes und Unbekanntes nicht', async () => {
		const snapshot = await createBackup();
		const fake = path.join(TMP, 'manipuliert.zip');
		const zip = new yazl.ZipFile();
		zip.addFile(path.join(BACKUP_DIR, snapshot), 'lager.db');
		// Inhalt passt nicht zur Prüfsumme im Namen
		zip.addBuffer(pdf('anderer Inhalt'), `dokumente/${sha('etwas ganz anderes')}.pdf`);
		zip.addBuffer(Buffer.from('#!/bin/sh'), 'andere/skript.sh');
		zip.addBuffer(Buffer.from('x'), 'dokumente/nicht-erlaubt.exe');
		zip.end();
		await pipeline(zip.outputStream, fs.createWriteStream(fake));

		const result = await restoreUpload(fake, 'manipuliert.zip');
		expect(result.files).toMatchObject({ added: 0, skipped: 3 });
		expect(fs.existsSync(path.join(TMP, 'dokumente', `${sha('etwas ganz anderes')}.pdf`))).toBe(false);
		expect(fs.existsSync(path.join(TMP, 'andere'))).toBe(false);
	});

	it('ohne Datenbank: abgelehnt, nichts verändert', async () => {
		const empty = path.join(TMP, 'ohne-db.zip');
		const zip = new yazl.ZipFile();
		zip.addBuffer(foto, FOTO);
		zip.end();
		await pipeline(zip.outputStream, fs.createWriteStream(empty));
		await expect(restoreUpload(empty, 'ohne-db.zip')).rejects.toThrow(RestoreError);
		await expect(restoreUpload(empty, 'ohne-db.zip')).rejects.toThrow(/fehlt die Datenbank/);
		expect(await productNames()).toEqual(['Markierfarbe weiß']);
	});

	it('nimmt weiterhin reine .db-Dateien', async () => {
		const snapshot = await createBackup();
		await addProduct('Noch einer');
		const copy = path.join(TMP, 'alt.db');
		fs.copyFileSync(path.join(BACKUP_DIR, snapshot), copy);
		const result = await restoreUpload(copy, 'alt.db');
		expect(result.files).toBeNull();
		expect(await productNames()).toEqual(['Markierfarbe weiß']);
	});
});
