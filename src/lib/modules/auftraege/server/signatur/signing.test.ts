import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '$lib/server/auth';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rechnung-signatur-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false', SIGNATUR_PASSWORT: 'test-passwort-fuer-das-siegel' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { invoiceAudit, invoiceFiles, invoicePositions, invoices, invoiceSignatures } = await import('$lib/server/db/schema');
const { cancelInvoice, issueInvoice, signIssued } = await import('./signing');
const { publicVerification, verifyInvoice, checkArchive } = await import('./verification');
const { verifyAuditChain } = await import('./audit');
const { saveSignatureSettings, SIGNATURE_DEFAULTS, secrets } = await import('./settings');
const { createSelfSigned, writeKeyFile } = await import('./keys');
const { forgetLoadedKey } = await import('./provider');
const { setFetcher } = await import('./net');
const { makeCert, tsaReply } = await import('./testkit');
const { ARCHIVE_DIR, readArchiveFile } = await import('./archive');
const { inspectPdf } = await import('./verify-pdf');
const { deleteIssuedInvoice } = await import('./removal');

const user: SessionUser = { id: 0, username: 'test', email: null, firstName: 'Test', lastName: 'Büro', role: 'admin', partyId: null, owner: false, mustChangePassword: false };
const ORIGIN = 'https://portal.test';
let counter = 100;

async function draft(lines: { text: string; quantity: number; unitPrice: number }[] = [{ text: 'Leitlinie gelb', quantity: 120, unitPrice: 2.5 }]) {
	const number = String(counter++);
	const row = await db
		.insert(invoices)
		.values({
			number,
			date: '2026-10-12',
			dueDate: '2026-11-11',
			title: 'BV Teststraße',
			location: 'Schwechat',
			customerName: 'Straßenbau GmbH',
			customerStreet: 'Hauptstraße 1',
			customerZip: '1010',
			customerCity: 'Wien',
			intro: 'Wir verrechnen:',
			vatRate: 20
		})
		.returning({ id: invoices.id })
		.get();
	for (const [i, l] of lines.entries()) {
		await db.insert(invoicePositions).values({ invoiceId: row.id, sortOrder: i, number: String(i + 1), kind: 'position', text: l.text, quantity: l.quantity, unit: 'lfm', unitPrice: l.unitPrice });
	}
	return { id: row.id, number };
}

const stageOf = async (id: number) => (await db.select({ stage: invoices.stage }).from(invoices).where(eq(invoices.id, id)).get())?.stage;

/** Fehlermeldung samt Ursache – drizzle verpackt die Meldung des Triggers */
async function failure(p: PromiseLike<unknown>): Promise<string> {
	try {
		await p;
		return '';
	} catch (e) {
		const err = e as Error & { cause?: Error };
		return `${err.message} ${err.cause?.message ?? ''}`;
	}
}

beforeAll(async () => {
	await ensureDatabase();
	const { users } = await import('$lib/server/db/schema');
	user.id = (await db.select({ id: users.id }).from(users).limit(1).get())!.id;
	const key = createSelfSigned({ organization: 'Monsipan Bautenschutz GesmbH', commonName: 'Monsipan Rechnungssiegel (Test)', country: 'AT', years: 2 });
	fs.mkdirSync(path.dirname(secrets.keyFile()), { recursive: true });
	fs.writeFileSync(secrets.keyFile(), writeKeyFile(key, secrets.keyPassword()));
	forgetLoadedKey();
});

afterEach(() => setFetcher());

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* schreibgeschützte Archivdateien unter Windows – bleiben im Temp-Ordner */
	}
});

describe('Ausstellen ohne Signatur', () => {
	it('archiviert das Original und sperrt die Rechnung', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: false });
		const { id } = await draft();
		const result = await issueInvoice(user, id, ORIGIN);
		expect(result).toEqual({ ok: true, stage: 'ausgestellt' });
		const row = await db.select().from(invoices).where(eq(invoices.id, id)).get();
		expect(row?.verifyToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
		expect(row?.retainUntil).toBe('2033-12-31');
		const files = await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id)).all();
		expect(files.map((f) => f.kind)).toEqual(['original']);
		expect(readArchiveFile(files[0].fileName)?.subarray(0, 8).toString()).toBe('%PDF-1.7');
		const check = await verifyInvoice(id);
		expect(check?.result).toBe('unbekannt');
		expect(check?.archive.ok).toBe(true);
		expect(check?.database.ok).toBe(true);
		// Zweimal ausstellen geht nicht
		expect((await issueInvoice(user, id, ORIGIN)).ok).toBe(false);
	});

	it('lässt Inhalte, Positionen und Archiv in der Datenbank nicht ändern', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: false });
		const { id } = await draft();
		await issueInvoice(user, id, ORIGIN);
		expect(await failure(db.update(invoices).set({ title: 'anders' }).where(eq(invoices.id, id)))).toMatch(/gesperrt/);
		expect(await failure(db.update(invoices).set({ stage: 'entwurf' }).where(eq(invoices.id, id)))).toMatch(/gesperrt/);
		expect(await failure(db.update(invoices).set({ vatRate: 10 }).where(eq(invoices.id, id)))).toMatch(/gesperrt/);
		expect(await failure(db.delete(invoices).where(eq(invoices.id, id)))).toMatch(/nicht löschen/);
		expect(await failure(db.update(invoicePositions).set({ quantity: 1 }).where(eq(invoicePositions.invoiceId, id)))).toMatch(/gesperrt/);
		expect(await failure(db.delete(invoicePositions).where(eq(invoicePositions.invoiceId, id)))).toMatch(/gesperrt/);
		expect(await failure(db.insert(invoicePositions).values({ invoiceId: id, text: 'neu', quantity: 1, unitPrice: 1 }))).toMatch(/gesperrt/);
		expect(await failure(db.update(invoiceFiles).set({ sha256: 'x' }).where(eq(invoiceFiles.invoiceId, id)))).toMatch(/unveränderlich/);
		expect(await failure(db.delete(invoiceAudit))).toMatch(/unveränderlich/);
		// Zahlung bleibt möglich
		await db.update(invoices).set({ status: 'bezahlt', paidOn: '2026-10-20' }).where(eq(invoices.id, id));
		// Entwürfe bleiben frei änderbar
		const other = await draft();
		await db.update(invoices).set({ title: 'geändert' }).where(eq(invoices.id, other.id));
	});
});

describe('Ausstellen mit Signatur', () => {
	it('signiert mit dem eigenen Zertifikat (PAdES-B-B)', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-B' });
		const { id } = await draft();
		const result = await issueInvoice(user, id, ORIGIN);
		expect(result).toMatchObject({ ok: true, stage: 'signiert' });
		const sig = await db.select().from(invoiceSignatures).where(eq(invoiceSignatures.invoiceId, id)).get();
		expect(sig).toMatchObject({ level: 'B-B', provider: 'lokal', qualification: 'selbst', certName: 'Monsipan Rechnungssiegel (Test)' });
		const files = await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id)).all();
		const original = readArchiveFile(files.find((f) => f.kind === 'original')!.fileName)!;
		const signed = readArchiveFile(files.find((f) => f.kind === 'signiert')!.fileName)!;
		// Die signierte Fassung enthält das Original unverändert
		expect(signed.subarray(0, original.length).equals(original)).toBe(true);
		expect(inspectPdf(signed)).toMatchObject({ ok: true, level: 'B-B' });
		const check = await verifyInvoice(id, { user });
		expect(check?.result).toBe('gueltig');
	});

	it('mit Zeitstempel (PAdES-B-T)', async () => {
		const tsa = await makeCert({ cn: 'Test-TSA', tsa: true });
		setFetcher(async (_url, opts) => tsaReply(tsa, opts!.body as Buffer));
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-T', tsaUrl: 'http://tsa.test' });
		const { id } = await draft();
		expect(await issueInvoice(user, id, ORIGIN)).toMatchObject({ ok: true, stage: 'signiert' });
		const sig = await db.select().from(invoiceSignatures).where(eq(invoiceSignatures.invoiceId, id)).get();
		expect(sig?.level).toBe('B-T');
		expect(sig?.tsa).toBe('Test-TSA');
		expect(sig?.timestampAt).toBeInstanceOf(Date);
	});

	it('kennzeichnet eine gescheiterte Signierung nie als signiert und lässt sie wiederholen', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-T', tsaUrl: 'http://tsa.test' });
		setFetcher(async () => {
			throw new Error('ECONNREFUSED');
		});
		const { id } = await draft();
		const result = await issueInvoice(user, id, ORIGIN);
		expect(result).toMatchObject({ ok: true, stage: 'fehlgeschlagen' });
		const row = await db.select().from(invoices).where(eq(invoices.id, id)).get();
		expect(row?.stage).toBe('fehlgeschlagen');
		expect(row?.signError).toMatch(/Zeitstempeldienst nicht erreichbar/);
		expect(await db.select().from(invoiceSignatures).where(eq(invoiceSignatures.invoiceId, id)).get()).toBeUndefined();
		expect((await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id)).all()).map((f) => f.kind)).toEqual(['original']);
		const actions = (await db.select({ action: invoiceAudit.action }).from(invoiceAudit).where(eq(invoiceAudit.invoiceId, id)).all()).map((a) => a.action);
		expect(actions).toEqual(['ausgestellt', 'archiviert', 'signierung', 'fehlgeschlagen']);

		const tsa = await makeCert({ cn: 'Test-TSA', tsa: true });
		setFetcher(async (_url, opts) => tsaReply(tsa, opts!.body as Buffer));
		expect(await signIssued(user, id)).toMatchObject({ ok: true, stage: 'signiert' });
		expect(await stageOf(id)).toBe('signiert');
	});

	it('scheitert sauber ohne Zertifikat', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-B' });
		const file = secrets.keyFile();
		fs.renameSync(file, `${file}.weg`);
		forgetLoadedKey();
		try {
			const { id } = await draft();
			const result = await issueInvoice(user, id, ORIGIN);
			expect(result).toMatchObject({ ok: true, stage: 'fehlgeschlagen' });
			expect((await db.select().from(invoices).where(eq(invoices.id, id)).get())?.signError).toMatch(/kein Zertifikat hinterlegt/);
		} finally {
			fs.renameSync(`${file}.weg`, file);
			forgetLoadedKey();
		}
	});
});

describe('Manipulation erkennen', () => {
	it('an der Archivdatei', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-B' });
		const { id } = await draft();
		await issueInvoice(user, id, ORIGIN);
		const file = (await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id)).all()).find((f) => f.kind === 'signiert')!;
		const full = path.join(ARCHIVE_DIR, file.fileName);
		const data = fs.readFileSync(full);
		fs.chmodSync(full, 0o644);
		const changed = Buffer.from(data);
		changed[200] ^= 1;
		fs.writeFileSync(full, changed);
		const check = await verifyInvoice(id);
		expect(check?.result).toBe('ungueltig');
		expect(check?.problems.join(' ')).toMatch(/verändert/);
		const archive = await checkArchive();
		expect(archive.problems.map((p) => p.id)).toContain(id);
		fs.writeFileSync(full, data);
		expect((await verifyInvoice(id))?.result).toBe('gueltig');
	});

	it('an der Datenbank vorbei', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: false });
		const { id } = await draft();
		await issueInvoice(user, id, ORIGIN);
		// Die Sperre, wie sie nach allen Migrationen gilt – danach wieder anlegen
		const trigger = String((await client.execute("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'invoices_issued_locked'")).rows[0].sql);
		await client.execute('DROP TRIGGER invoices_issued_locked');
		try {
			await client.execute({ sql: 'UPDATE invoices SET customer_name = ? WHERE id = ?', args: ['Jemand anderer', id] });
			const check = await verifyInvoice(id);
			expect(check?.result).toBe('ungueltig');
			expect(check?.database.ok).toBe(false);
		} finally {
			await client.execute({ sql: 'UPDATE invoices SET customer_name = ? WHERE id = ?', args: ['Straßenbau GmbH', id] });
			await client.execute(trigger);
		}
		expect((await verifyInvoice(id))?.database.ok).toBe(true);
	});

	it('im Protokoll', async () => {
		expect((await verifyAuditChain()).ok).toBe(true);
		await client.execute('DROP TRIGGER invoice_audit_no_update');
		const last = await db.select().from(invoiceAudit).all();
		const victim = last[Math.floor(last.length / 2)];
		await client.execute({ sql: 'UPDATE invoice_audit SET user_name = ? WHERE id = ?', args: ['Fremd', victim.id] });
		const chain = await verifyAuditChain();
		expect(chain.ok).toBe(false);
		expect(chain.brokenAt).toBe(victim.id);
		await client.execute({ sql: 'UPDATE invoice_audit SET user_name = ? WHERE id = ?', args: [victim.userName, victim.id] });
		await client.execute("CREATE TRIGGER `invoice_audit_no_update` BEFORE UPDATE ON `invoice_audit` BEGIN SELECT RAISE(ABORT, 'Das Protokoll ist unveränderlich.'); END;");
		expect((await verifyAuditChain()).ok).toBe(true);
	});
});

describe('Storno', () => {
	it('stellt eine Stornorechnung aus und kennzeichnet die Rechnung', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-B' });
		const { id, number } = await draft([
			{ text: 'Leitlinie', quantity: 100, unitPrice: 2 },
			{ text: 'Pfeil', quantity: 4, unitPrice: 30 }
		]);
		expect((await cancelInvoice(user, id, 'x', ORIGIN)).ok).toBe(false);
		expect((await cancelInvoice(user, id, 'Falsche Menge', ORIGIN)).ok).toBe(false); // Entwurf
		await issueInvoice(user, id, ORIGIN);
		const result = await cancelInvoice(user, id, 'Falsche Menge', ORIGIN);
		expect(result).toMatchObject({ ok: true, stage: 'signiert' });
		if (!result.ok) return;
		const original = await db.select().from(invoices).where(eq(invoices.id, id)).get();
		expect(original).toMatchObject({ stage: 'storniert', cancelReason: 'Falsche Menge', stornoId: result.stornoId });
		const storno = await db.select().from(invoices).where(eq(invoices.id, result.stornoId)).get();
		expect(storno).toMatchObject({ kind: 'storno', cancelsId: id, number: `${number}-2` });
		const lines = await db.select().from(invoicePositions).where(eq(invoicePositions.invoiceId, result.stornoId)).all();
		expect(lines.map((l) => l.quantity)).toEqual([-100, -4]);
		expect((await verifyInvoice(id))?.result).toBe('storniert');
		expect((await cancelInvoice(user, id, 'Nochmal', ORIGIN)).ok).toBe(false);
		expect((await cancelInvoice(user, result.stornoId, 'Storno vom Storno', ORIGIN)).ok).toBe(false);
	});
});

describe('Löschen zum Testen', () => {
	const triggerCount = async () => Number((await client.execute("select count(*) n from sqlite_master where type = 'trigger'")).rows[0].n);

	it('löscht eine signierte Rechnung samt Archiv und lässt die Sperren stehen', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-B' });
		const { id, number } = await draft();
		await issueInvoice(user, id, ORIGIN);
		const files = await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id)).all();
		const before = await triggerCount();
		expect((await deleteIssuedInvoice(user, id, '')).ok).toBe(false);
		expect(await deleteIssuedInvoice(user, id, 'Testrechnung')).toEqual({ ok: true, deleted: [number], restoredId: null });
		expect(await db.select().from(invoices).where(eq(invoices.id, id)).get()).toBeUndefined();
		expect(await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id)).all()).toEqual([]);
		expect(await db.select().from(invoiceSignatures).where(eq(invoiceSignatures.invoiceId, id)).all()).toEqual([]);
		for (const f of files) expect(readArchiveFile(f.fileName)).toBeNull();
		expect(await triggerCount()).toBe(before);
		const last = await db.select().from(invoiceAudit).where(eq(invoiceAudit.invoiceId, id)).all();
		expect(last.at(-1)?.action).toBe('geloescht_ausgestellt');
		expect((await verifyAuditChain()).ok).toBe(true);
		// Andere ausgestellte bleiben gesperrt
		const other = await draft();
		await issueInvoice(user, other.id, ORIGIN);
		expect(await failure(db.delete(invoices).where(eq(invoices.id, other.id)))).toMatch(/nicht löschen/);
	});

	it('hebt beim Löschen der Stornorechnung das Storno auf', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-B' });
		const { id } = await draft();
		await issueInvoice(user, id, ORIGIN);
		const cancelled = await cancelInvoice(user, id, 'Versehen', ORIGIN);
		if (!cancelled.ok) throw new Error(cancelled.message);
		const result = await deleteIssuedInvoice(user, cancelled.stornoId, 'Storno war ein Test');
		expect(result).toMatchObject({ ok: true, restoredId: id });
		expect(await db.select().from(invoices).where(eq(invoices.id, id)).get()).toMatchObject({ stage: 'signiert', stornoId: null, cancelledAt: null, cancelReason: null });
		expect((await verifyInvoice(id))?.result).toBe('gueltig');
	});

	it('nimmt mit der Rechnung ihre Stornorechnung mit', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: false });
		const { id } = await draft();
		await issueInvoice(user, id, ORIGIN);
		const cancelled = await cancelInvoice(user, id, 'Versehen', ORIGIN);
		if (!cancelled.ok) throw new Error(cancelled.message);
		const result = await deleteIssuedInvoice(user, id, 'Alles nur Test');
		expect(result.ok && result.deleted).toHaveLength(2);
		expect(await db.select().from(invoices).where(eq(invoices.id, cancelled.stornoId)).get()).toBeUndefined();
	});
});

describe('Prüfseite', () => {
	it('zeigt nichts Vertrauliches und kennt nur echte Schlüssel', async () => {
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, level: 'B-B' });
		const { id } = await draft();
		await issueInvoice(user, id, ORIGIN);
		const token = (await db.select({ t: invoices.verifyToken }).from(invoices).where(eq(invoices.id, id)).get())!.t!;
		const found = await publicVerification(token);
		expect(found).not.toBeNull();
		expect(found).not.toBe('aus');
		if (!found || found === 'aus') return;
		expect(found.result).toBe('gueltig');
		expect(found.signed).toBe(true);
		// Prüfsummen und Zeitstempel sind zufällig – „300" kann darin vorkommen, ohne der Betrag zu sein
		const { hashes, ...rest } = found;
		for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
		const text = JSON.stringify(rest).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '');
		for (const secret of ['Straßenbau', 'Leitlinie', '300', 'Hauptstraße']) expect(text).not.toContain(secret);
		expect(await publicVerification('A'.repeat(24))).toBeNull();
		expect(await publicVerification('../../etc')).toBeNull();
		await saveSignatureSettings({ ...SIGNATURE_DEFAULTS, enabled: true, verifyEnabled: false });
		expect(await publicVerification(token)).toBe('aus');
	});
});
