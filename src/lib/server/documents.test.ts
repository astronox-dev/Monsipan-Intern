import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lager-dokumente-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, ensureDatabase } = await import('./db');
const { products, productDocuments } = await import('./db/schema');
const { appendUploadPart, DOC_DIR, DocumentError, documentFile, finishUpload, KEEP_UNUSED_DAYS, storeDocument, takeUploads, tidyDocuments } = await import(
	'./documents'
);
const { MAX_DOCUMENT_BYTES } = await import('$lib/documents');

const PDF = '%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n';
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
const upload = (content: string | Uint8Array<ArrayBuffer>, name = 'merkblatt.pdf') => new File([content], name, { type: 'application/pdf' });
const tmpFiles = () => (fs.existsSync(DOC_DIR) ? fs.readdirSync(DOC_DIR).filter((f) => f.endsWith('.tmp')) : []);

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

describe('PDF ablegen', () => {
	it('legt ein PDF unter seiner Prüfsumme ab', async () => {
		const stored = await storeDocument(upload(PDF));
		expect(stored.sha256).toBe(sha(PDF));
		expect(stored.size).toBe(Buffer.byteLength(PDF));
		expect(fs.readFileSync(documentFile(stored.sha256), 'utf8')).toBe(PDF);
	});

	it('speichert dieselbe Datei nur einmal', async () => {
		const a = await storeDocument(upload(PDF, 'a.pdf'));
		const b = await storeDocument(upload(PDF, 'b.pdf'));
		expect(a.sha256).toBe(b.sha256);
		expect(fs.readdirSync(DOC_DIR).filter((f) => f.endsWith('.pdf'))).toHaveLength(1);
	});

	it('erkennt die PDF-Kennung auch nach Vorspann', async () => {
		const withJunk = '\n\n' + PDF;
		await expect(storeDocument(upload(withJunk))).resolves.toMatchObject({ sha256: sha(withJunk) });
	});

	it('lehnt andere Dateien ab und hinterlässt nichts', async () => {
		await expect(storeDocument(upload('Nur Text, kein PDF', 'notiz.pdf'))).rejects.toThrow(DocumentError);
		await expect(storeDocument(upload('', 'leer.pdf'))).rejects.toThrow(/leer/);
		expect(tmpFiles()).toEqual([]);
	});

	it('lehnt zu große Dateien ab', async () => {
		const big = new Uint8Array(new ArrayBuffer(MAX_DOCUMENT_BYTES + 1));
		big.set(Buffer.from('%PDF-1.4'));
		await expect(storeDocument(upload(big))).rejects.toThrow(/zu groß/);
		expect(tmpFiles()).toEqual([]);
		// Pläne am Auftrag: ohne Grenze
		await expect(storeDocument(upload(big), null)).resolves.toMatchObject({ size: MAX_DOCUMENT_BYTES + 1 });
	});
});

describe('Upload in Teilen', () => {
	const part = (s: string | Buffer) => new Blob([typeof s === 'string' ? s : new Uint8Array(s)]).stream();
	const ID = 'plan-0123456789abcdef';

	it('setzt die Teile der Reihe nach zusammen – auch über die Grenze für Artikel hinaus', async () => {
		const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 10, 0x20);
		big.write('%PDF-1.7\n');
		const half = Math.floor(big.length / 2);
		expect(await appendUploadPart(1, ID, 0, part(big.subarray(0, half)))).toEqual({ ok: true, received: half });
		// Wiederholung des ersten Teils (Antwort ging verloren): bleibt, wie es ist
		expect(await appendUploadPart(1, ID, 0, part(big.subarray(0, half)))).toEqual({ ok: false, received: half });
		expect(await appendUploadPart(1, ID, half, part(big.subarray(half)))).toEqual({ ok: true, received: big.length });

		const stored = await finishUpload(1, ID, 'Polierplan EG.pdf');
		expect(stored).toEqual({ sha256: sha(big), size: big.length });
		expect(fs.statSync(documentFile(stored.sha256)).size).toBe(big.length);
		// Nochmal „fertig" (Antwort verloren) liefert dasselbe
		expect(await finishUpload(1, ID, 'Polierplan EG.pdf')).toEqual(stored);

		// Einlösen nur durch dieselbe Person – und nur einmal
		expect(() => takeUploads(2, [ID])).toThrow(DocumentError);
		expect(takeUploads(1, [ID])).toEqual([{ name: 'Polierplan EG.pdf', ...stored }]);
		expect(() => takeUploads(1, [ID])).toThrow(/nicht vollständig/);
		expect(tmpFiles()).toEqual([]);
	});

	it('lehnt andere Dateien ab und hinterlässt nichts', async () => {
		const id = 'kein-pdf-0123456789ab';
		await appendUploadPart(1, id, 0, part('Nur Text, kein PDF'));
		await expect(finishUpload(1, id, 'notiz.pdf')).rejects.toThrow(/keine PDF/);
		await expect(finishUpload(1, 'nie-angefangen-0123456', 'leer.pdf')).rejects.toThrow(/leer/);
		expect(tmpFiles()).toEqual([]);
	});

	it('hält die Teile verschiedener Personen auseinander', async () => {
		const id = 'gleiche-kennung-012345';
		await appendUploadPart(1, id, 0, part('%PDF-1.4 von eins'));
		expect(await appendUploadPart(2, id, 0, part('%PDF-1.4 von zwei'))).toMatchObject({ ok: true });
		expect((await finishUpload(2, id, 'b.pdf')).sha256).toBe(sha('%PDF-1.4 von zwei'));
		expect((await finishUpload(1, id, 'a.pdf')).sha256).toBe(sha('%PDF-1.4 von eins'));
		expect(takeUploads(1, [id])).toMatchObject([{ name: 'a.pdf', sha256: sha('%PDF-1.4 von eins') }]);
		expect(takeUploads(2, [id])).toMatchObject([{ name: 'b.pdf', sha256: sha('%PDF-1.4 von zwei') }]);
	});
});

describe('Aufräumen', () => {
	const DAY = 86_400_000;

	it('behält benutzte Dateien und löscht lange unbenutzte', async () => {
		const product = await db.insert(products).values({ name: 'Testartikel', unit: 'Stk', searchText: 'testartikel' }).returning({ id: products.id }).get();

		// Benutzt, aber alt: bleibt und wird aufgefrischt
		const used = await storeDocument(upload(PDF + '% benutzt\n'));
		await db.insert(productDocuments).values({ productId: product.id, title: 'Merkblatt', fileName: 'm.pdf', sha256: used.sha256, size: used.size });

		// Unbenutzt seit langem: wird gelöscht
		const old = await storeDocument(upload(PDF + '% alt\n'));
		// Unbenutzt, aber erst kürzlich: bleibt – eine Sicherung könnte sie noch brauchen
		const recent = await storeDocument(upload(PDF + '% neu\n'));
		// Abgebrochener Upload von vorgestern
		const stale = path.join(DOC_DIR, 'upload-abc-123.tmp');
		fs.writeFileSync(stale, 'x');

		const now = new Date();
		const long = new Date(now.getTime() - (KEEP_UNUSED_DAYS + 1) * DAY);
		fs.utimesSync(documentFile(used.sha256), long, long);
		fs.utimesSync(documentFile(old.sha256), long, long);
		fs.utimesSync(stale, new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - 2 * DAY));

		const { removed } = await tidyDocuments(now);
		expect(removed).toBeGreaterThanOrEqual(1);
		expect(fs.existsSync(documentFile(used.sha256))).toBe(true);
		expect(fs.statSync(documentFile(used.sha256)).mtimeMs).toBeGreaterThan(now.getTime() - DAY);
		expect(fs.existsSync(documentFile(old.sha256))).toBe(false);
		expect(fs.existsSync(documentFile(recent.sha256))).toBe(true);
		expect(fs.existsSync(stale)).toBe(false);
	});
});
