import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'angebot-unterlagen-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { offers, orders, users } = await import('$lib/server/db/schema');
const { documentFile, KEEP_UNUSED_DAYS, storeDocument, tidyDocuments } = await import('$lib/server/documents');
const { addOfferDocuments, crewDocumentsOfOffer, deleteOfferDocument, listOfferDocuments, setOfferDocumentForCrew } = await import('./offer-documents');
const { findOrderDocument, orderDetail } = await import('./orders');

const pdf = (text: string) => new File([`%PDF-1.4\n% ${text}\n%%EOF\n`], `${text}.pdf`, { type: 'application/pdf' });

beforeAll(async () => {
	await ensureDatabase();
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Unterlagen am Angebot', () => {
	it('auch beim beauftragten Angebot – beim Auftrag nur, was für die Partie angehakt ist', async () => {
		const me = (await db.select({ id: users.id }).from(users).get())!.id;
		const offer = await db.insert(offers).values({ number: '26001', date: '2026-10-16', status: 'angenommen' }).returning({ id: offers.id }).get();
		const order = await db.insert(orders).values({ number: '26001', offerId: offer.id }).returning({ id: orders.id }).get();

		const lv = await storeDocument(pdf('Leistungsverzeichnis mit Preisen'));
		const plan = await storeDocument(pdf('Polierplan_EG'));
		await addOfferDocuments(offer.id, [{ name: 'Leistungsverzeichnis mit Preisen.pdf', ...lv }], me, false);
		await addOfferDocuments(offer.id, [{ name: 'Polierplan_EG.pdf', ...plan }], me, true);

		const all = await listOfferDocuments(offer.id);
		expect(all.map((d) => [d.title, d.forCrew])).toEqual([
			['Leistungsverzeichnis mit Preisen', false],
			['Polierplan EG', true]
		]);
		const [lvDoc, planDoc] = all;

		// Beim Auftrag: nur der Plan
		expect((await orderDetail(order.id))!.offerDocuments.map((d) => d.title)).toEqual(['Polierplan EG']);
		const o = { id: order.id, offerId: offer.id };
		expect(await findOrderDocument(o, `a${planDoc.id}`)).toMatchObject({ sha256: plan.sha256 });
		expect(await findOrderDocument(o, `a${lvDoc.id}`)).toBeUndefined();
		// Fremder Auftrag sieht die Unterlagen nicht
		expect(await findOrderDocument({ id: order.id, offerId: null }, `a${planDoc.id}`)).toBeUndefined();

		// Umschalten
		await setOfferDocumentForCrew(offer.id, lvDoc.id, true);
		await setOfferDocumentForCrew(offer.id, planDoc.id, false);
		expect((await crewDocumentsOfOffer(offer.id)).map((d) => d.title)).toEqual(['Leistungsverzeichnis mit Preisen']);

		// Die Dateien gelten beim Aufräumen als benutzt – auch alt
		const old = new Date(Date.now() - (KEEP_UNUSED_DAYS + 5) * 86_400_000);
		fs.utimesSync(documentFile(plan.sha256), old, old);
		await tidyDocuments();
		expect(fs.existsSync(documentFile(plan.sha256))).toBe(true);

		await deleteOfferDocument(offer.id, planDoc.id);
		expect((await listOfferDocuments(offer.id)).map((d) => d.title)).toEqual(['Leistungsverzeichnis mit Preisen']);
	});
});
