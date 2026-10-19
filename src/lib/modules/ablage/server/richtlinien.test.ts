import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'richtlinien-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { users } = await import('$lib/server/db/schema');
const { documentFile, KEEP_UNUSED_DAYS, storeDocument, tidyDocuments } = await import('$lib/server/documents');
const {
	addDocuments,
	allFolders,
	cleanName,
	createFolder,
	deleteDocument,
	deleteFolder,
	folderPath,
	getDocument,
	listFolder,
	moveDocument,
	moveFolder,
	renameDocument,
	renameFolder,
	searchPolicies
} = await import('./richtlinien');

const pdf = (text: string) => new File([`%PDF-1.4\n% ${text}\n%%EOF\n`], `${text}.pdf`, { type: 'application/pdf' });

let me: number;

beforeAll(async () => {
	await ensureDatabase();
	me = (await db.select({ id: users.id }).from(users).get())!.id;
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Namen', () => {
	it('ohne Steuerzeichen und doppelten Leerraum, gekürzt', () => {
		expect(cleanName('  ÖNORM\tB 2215 \n ')).toBe('ÖNORM B 2215');
		expect(cleanName('x'.repeat(300))).toHaveLength(120);
		expect(cleanName(null)).toBe('');
	});
});

describe('Ordner', () => {
	it('anlegen, schachteln, umbenennen – Namen je Ordner nur einmal', async () => {
		const bau = await createFolder(null, 'Bau', me);
		const sicherheit = await createFolder(bau, 'Sicherheit', me);
		const pruefung = await createFolder(sicherheit, 'Prüfungen', me);
		await createFolder(null, 'allgemein', me);

		await expect(createFolder(null, 'bau', me)).rejects.toThrow('Einen Ordner „bau“ gibt es hier schon.');
		await expect(createFolder(null, '   ', me)).rejects.toThrow('Bitte einen Namen');
		await expect(createFolder(9999, 'Weg', me)).rejects.toThrow('gibt es nicht mehr');
		// Gleicher Name in einem anderen Ordner geht
		await createFolder(sicherheit, 'Bau', me);

		expect((await folderPath(pruefung)).map((p) => p.name)).toEqual(['Bau', 'Sicherheit', 'Prüfungen']);
		expect((await listFolder(null)).folders.map((f) => f.name)).toEqual(['allgemein', 'Bau']);

		await renameFolder(sicherheit, 'Arbeitssicherheit');
		expect((await allFolders()).map((f) => f.path)).toEqual(['allgemein', 'Bau', 'Bau / Arbeitssicherheit', 'Bau / Arbeitssicherheit / Bau', 'Bau / Arbeitssicherheit / Prüfungen']);
		await expect(renameFolder(sicherheit, 'Prüfungen')).resolves.toBeUndefined();
		await expect(renameFolder(pruefung, 'bau')).rejects.toThrow('gibt es hier schon');
	});

	it('verschieben – nicht in sich selbst oder einen Unterordner', async () => {
		const a = await createFolder(null, 'A', me);
		const b = await createFolder(a, 'B', me);
		const c = await createFolder(b, 'C', me);
		await expect(moveFolder(a, a)).rejects.toThrow('nicht in sich selbst');
		await expect(moveFolder(a, c)).rejects.toThrow('nicht in sich selbst');
		await moveFolder(c, null);
		expect(await folderPath(c)).toEqual([{ id: c, name: 'C' }]);
		// Dort gibt es schon einen gleichnamigen
		await createFolder(a, 'C', me);
		await expect(moveFolder(c, a)).rejects.toThrow('Dort gibt es schon einen Ordner „C“.');
	});
});

describe('PDFs', () => {
	it('mit eigenem Namen ablegen, umbenennen, verschieben, finden, löschen', async () => {
		const folder = await createFolder(null, 'Normen', me);
		const sub = await createFolder(folder, 'Straße', me);
		const rvs = await storeDocument(pdf('RVS_05.02.13'));
		const leer = await storeDocument(pdf('scan_0042'));
		await addDocuments(
			folder,
			[
				{ name: 'RVS_05.02.13.pdf', title: '  RVS 05.02.13 Bodenmarkierungen ', ...rvs },
				{ name: 'scan_0042', title: '', ...leer }
			],
			me
		);
		let list = await listFolder(folder);
		expect(list.documents.map((d) => [d.title, d.fileName])).toEqual([
			['RVS 05.02.13 Bodenmarkierungen', 'RVS_05.02.13.pdf'],
			['scan 0042', 'scan_0042.pdf']
		]);
		expect(list.folders).toMatchObject([{ name: 'Straße', folders: 0, documents: 0 }]);

		const [doc, scan] = list.documents;
		await renameDocument(scan.id, 'Betriebsanweisung Heißplastik');
		await moveDocument(scan.id, sub);
		await expect(moveDocument(scan.id, 9999)).rejects.toThrow('gibt es nicht mehr');
		list = await listFolder(folder);
		expect(list.documents.map((d) => d.title)).toEqual(['RVS 05.02.13 Bodenmarkierungen']);
		expect(list.folders).toMatchObject([{ name: 'Straße', folders: 0, documents: 1 }]);
		// Ganz oben zählt der Ordner alles darunter mit
		expect((await listFolder(null)).folders.find((f) => f.id === folder)).toMatchObject({ folders: 1, documents: 2 });

		const found = await searchPolicies('heiß');
		expect(found.documents.map((d) => [d.title, d.place])).toEqual([['Betriebsanweisung Heißplastik', 'Normen / Straße']]);
		expect((await searchPolicies('RVS_05')).documents.map((d) => d.title)).toEqual(['RVS 05.02.13 Bodenmarkierungen']);
		expect((await searchPolicies('straße')).folders).toEqual([{ id: sub, name: 'Straße', place: 'Normen' }]);

		// Benutzt – bleibt beim Aufräumen liegen, auch wenn die Datei alt ist
		const old = new Date(Date.now() - (KEEP_UNUSED_DAYS + 5) * 86_400_000);
		fs.utimesSync(documentFile(rvs.sha256), old, old);
		await tidyDocuments();
		expect(fs.existsSync(documentFile(rvs.sha256))).toBe(true);

		await deleteDocument(doc.id);
		expect(await getDocument(doc.id)).toBeUndefined();

		// Ordner löschen nimmt Unterordner und PDFs mit
		await deleteFolder(folder);
		expect(await getDocument(scan.id)).toBeUndefined();
		expect((await allFolders()).some((f) => f.path.startsWith('Normen'))).toBe(false);
	});
});
