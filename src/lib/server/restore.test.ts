import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lager-restore-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, ensureDatabase } = await import('./db');
const { categories, products } = await import('./db/schema');
const { createBackup, BACKUP_DIR, listBackups, pauseSweep, sweepTempFiles } = await import('./backup');
const { inspectBackup, restoreFromFile, RestoreError } = await import('./restore');

async function addProduct(name: string) {
	const category = await db.insert(categories).values({ name: `Art ${name}` }).returning({ id: categories.id }).get();
	await db
		.insert(products)
		.values({ name, unit: 'Stk', categoryId: category.id, searchText: name.toLowerCase() })
		.run();
}

const productNames = async () => (await db.select({ name: products.name }).from(products).all()).map((p) => p.name).sort();

beforeAll(async () => {
	await ensureDatabase();
});

afterAll(() => {
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		// Windows gibt die geöffnete Datenbankdatei erst nach dem Prozessende frei
	}
});

describe('Sicherung prüfen', () => {
	it('lehnt Dateien ab, die keine SQLite-Datenbank sind', async () => {
		const file = path.join(TMP, 'kaputt.db');
		fs.writeFileSync(file, 'nur Text');
		await expect(inspectBackup(file)).rejects.toThrow(RestoreError);
	});

	it('lehnt fremde SQLite-Datenbanken ab', async () => {
		const { createClient } = await import('@libsql/client');
		const file = path.join(TMP, 'fremd.db');
		const c = createClient({ url: `file:${file}` });
		await c.execute('create table irgendwas (id integer primary key)');
		c.close();
		await expect(inspectBackup(file)).rejects.toThrow(/Monsipan Portal/);
	});

	it('liest die Zahlen einer echten Sicherung', async () => {
		await addProduct('Prüfartikel');
		const name = await createBackup();
		const info = await inspectBackup(path.join(BACKUP_DIR, name));
		expect(info.products).toBe(1);
		expect(info.users).toBe(1);
		expect(info.size).toBeGreaterThan(0);
	});
});

describe('Sicherung einspielen', () => {
	it('stellt den alten Stand wieder her und sichert den jetzigen vorher', async () => {
		// Stand 1: ein Artikel, davon eine Sicherung
		expect(await productNames()).toEqual(['Prüfartikel']);
		const backup = await createBackup();

		// Stand 2: ein zweiter Artikel kommt dazu
		await addProduct('Zweiter Artikel');
		expect(await productNames()).toEqual(['Prüfartikel', 'Zweiter Artikel']);

		const result = await restoreFromFile(path.join(BACKUP_DIR, backup), 'Test');
		expect(result.contents.products).toBe(1);

		// Die laufende Verbindung zeigt auf die eingespielte Datei
		expect(await productNames()).toEqual(['Prüfartikel']);

		// Der Stand von vorher ist als eigene Sicherung erhalten
		const before = listBackups().find((b) => b.file === result.backup);
		expect(before?.kind).toBe('before-restore');
		expect((await inspectBackup(path.join(BACKUP_DIR, result.backup))).products).toBe(2);
	});

	it('lässt sich danach normal weiter benutzen', async () => {
		await addProduct('Nach dem Einspielen');
		expect(await productNames()).toEqual(['Nach dem Einspielen', 'Prüfartikel']);
	});
});

describe('Zwischendateien aufräumen', () => {
	const temp = (name: string) => {
		const file = path.join(TMP, name);
		fs.writeFileSync(file, 'x');
		return file;
	};

	it('verschont die Datei, die gerade eingespielt wird', () => {
		const keep = temp('upload-abc123-def456.db');
		fs.writeFileSync(keep + '-wal', 'x');
		const alt = temp('restore-000000-000000.db');
		sweepTempFiles(keep);
		expect(fs.existsSync(keep)).toBe(true);
		expect(fs.existsSync(keep + '-wal')).toBe(true);
		expect(fs.existsSync(alt)).toBe(false);
		fs.rmSync(keep, { force: true });
		fs.rmSync(keep + '-wal', { force: true });
	});

	it('räumt während einer Wiederherstellung nicht dazwischen', () => {
		const laufend = temp('upload-111111-222222.db');
		const resume = pauseSweep();
		sweepTempFiles();
		expect(fs.existsSync(laufend)).toBe(true);
		resume();
		sweepTempFiles();
		expect(fs.existsSync(laufend)).toBe(false);
	});

	it('spielt eine hochgeladene Datei ein, ohne sie vorher zu löschen', async () => {
		const stand = await productNames();
		const backup = await createBackup();
		await addProduct('Nur kurz da');

		// wie nach dem Hochladen: Kopie im Datenordner, dazu eine Altlast
		const upload = path.join(TMP, 'upload-zzz999-aaa111.db');
		fs.copyFileSync(path.join(BACKUP_DIR, backup), upload);
		const altlast = temp('restore-999999-999999.db');

		await restoreFromFile(upload, 'Hochgeladene Datei');
		expect(await productNames()).toEqual(stand);
		// Die Altlast ist weg; die hochgeladene Datei wird zum Schluss gelöscht,
		// unter Windows erst beim nächsten Aufräumen (die Datei ist noch gesperrt).
		expect(fs.existsSync(altlast)).toBe(false);
	});

	it('spielt Sicherungen mit ausgestellten Rechnungen ein und behält die Sperren', async () => {
		const { invoices } = await import('./db/schema');
		const { client } = await import('./db');
		const { eq } = await import('drizzle-orm');
		const issued = { date: '2026-10-12', dueDate: '2026-11-11', customerName: 'Kunde', stage: 'ausgestellt' as const };
		await db.insert(invoices).values({ ...issued, number: 'R-1' });
		const backup = await createBackup();
		// Danach ausgestellt – beim Einspielen der älteren Sicherung muss sie trotz Sperre weichen
		await db.insert(invoices).values({ ...issued, number: 'R-2' });
		await restoreFromFile(path.join(BACKUP_DIR, backup), 'Test');
		expect((await db.select({ number: invoices.number }).from(invoices).all()).map((i) => i.number)).toEqual(['R-1']);
		const triggers = (await client.execute("select name from sqlite_master where type = 'trigger'")).rows.map((r) => String(r.name));
		expect(triggers).toContain('invoices_issued_locked');
		expect(triggers).toContain('invoice_audit_no_delete');
		await expect(db.delete(invoices).where(eq(invoices.number, 'R-1'))).rejects.toThrow();
	});
});
