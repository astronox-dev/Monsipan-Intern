import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anhaenge-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { inquiries, offers, users } = await import('$lib/server/db/schema');
const { documentFile, KEEP_UNUSED_DAYS, storeDocument, tidyDocuments } = await import('$lib/server/documents');
const { photoFile, tidyPhotos } = await import('$lib/modules/tagesberichte/server/photos');
const { MAX_PHOTO_BYTES, MAX_PHOTOS, PhotoError } = await import('$lib/modules/tagesberichte/photos');
const { deleteInquiry } = await import('./inquiries');
const { addInquiryDocuments, addRecordPhoto, deleteInquiryDocument, deleteRecordPhoto, getInquiryDocument, getRecordPhoto, listInquiryDocuments, listRecordPhotos } =
	await import('./attachments');

const pdf = (text: string) => new File([`%PDF-1.4\n% ${text}\n%%EOF\n`], `${text}.pdf`, { type: 'application/pdf' });

/** Kleinstes JPEG-Gerüst; `seed` macht jedes Bild zu einer eigenen Datei */
function jpeg(width: number, height: number, seed = 0) {
	const app0 = [0xff, 0xe0, 0x00, 0x10, ...'JFIF\0'.split('').map((c) => c.charCodeAt(0)), 1, 1, 0, 0, 1, 0, 1, seed >> 8, seed & 255];
	const head = [0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
	return new File([new Uint8Array([0xff, 0xd8, ...app0, ...head, 0xff, 0xd9])], 'foto.jpg', { type: 'image/jpeg' });
}

const old = () => new Date(Date.now() - (KEEP_UNUSED_DAYS + 5) * 86_400_000);

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

describe('PDFs an der Anfrage', () => {
	it('anhängen, auflisten, nur an der eigenen Anfrage finden, entfernen', async () => {
		const a = await db.insert(inquiries).values({ receivedOn: '2026-10-19', subject: 'Parkplatz' }).returning({ id: inquiries.id }).get();
		const b = await db.insert(inquiries).values({ receivedOn: '2026-10-19', subject: 'Halle' }).returning({ id: inquiries.id }).get();

		const plan = await storeDocument(pdf('Lageplan_Parkplatz'));
		await addInquiryDocuments(a.id, [{ name: 'Lageplan_Parkplatz.pdf', ...plan }, { name: 'LV', ...(await storeDocument(pdf('LV'))) }], me);

		const docs = await listInquiryDocuments(a.id);
		expect(docs.map((d) => [d.title, d.fileName])).toEqual([
			['Lageplan Parkplatz', 'Lageplan_Parkplatz.pdf'],
			['LV', 'LV.pdf']
		]);
		expect(await getInquiryDocument(a.id, docs[0].id)).toMatchObject({ sha256: plan.sha256 });
		// Über eine andere Anfrage kommt man nicht dran
		expect(await getInquiryDocument(b.id, docs[0].id)).toBeUndefined();
		await deleteInquiryDocument(b.id, docs[0].id);
		expect(await listInquiryDocuments(a.id)).toHaveLength(2);

		// Benutzt – bleibt beim Aufräumen liegen, auch wenn die Datei alt ist
		fs.utimesSync(documentFile(plan.sha256), old(), old());
		await tidyDocuments();
		expect(fs.existsSync(documentFile(plan.sha256))).toBe(true);

		await deleteInquiryDocument(a.id, docs[0].id);
		expect((await listInquiryDocuments(a.id)).map((d) => d.title)).toEqual(['LV']);

		// Mit der Anfrage gehen auch ihre PDFs
		await deleteInquiry(a.id);
		expect(await listInquiryDocuments(a.id)).toEqual([]);
	});
});

describe('Fotos an Anfrage und Angebot', () => {
	it('jedes sieht nur seine eigenen Fotos', async () => {
		const inquiry = await db.insert(inquiries).values({ receivedOn: '2026-10-19', subject: 'Fotos' }).returning({ id: inquiries.id }).get();
		const offer = await db.insert(offers).values({ number: '26900', date: '2026-10-19' }).returning({ id: offers.id }).get();

		const p1 = await addRecordPhoto({ inquiryId: inquiry.id }, me, jpeg(2400, 1800, 1), jpeg(480, 360, 2));
		const p2 = await addRecordPhoto({ offerId: offer.id }, me, jpeg(1800, 2400, 3), jpeg(360, 480, 4));
		expect(p1).toMatchObject({ width: 2400, height: 1800 });

		expect((await listRecordPhotos({ inquiryId: inquiry.id })).map((p) => p.id)).toEqual([p1.id]);
		expect((await listRecordPhotos({ offerId: offer.id })).map((p) => p.id)).toEqual([p2.id]);
		// Das Foto der Anfrage gibt es unter dem Angebot nicht – und umgekehrt
		expect(await getRecordPhoto({ offerId: offer.id }, p1.id)).toBeUndefined();
		expect(await getRecordPhoto({ inquiryId: inquiry.id }, p2.id)).toBeUndefined();
		const stored = (await getRecordPhoto({ inquiryId: inquiry.id }, p1.id))!;
		expect(fs.existsSync(photoFile(stored.sha256))).toBe(true);
		expect(fs.existsSync(photoFile(stored.thumbSha256))).toBe(true);

		// Aufräumen lässt benutzte Bilder liegen
		fs.utimesSync(photoFile(stored.sha256), old(), old());
		await tidyPhotos();
		expect(fs.existsSync(photoFile(stored.sha256))).toBe(true);

		// Löschen über den falschen Datensatz tut nichts
		await deleteRecordPhoto({ offerId: offer.id }, p1.id);
		expect(await listRecordPhotos({ inquiryId: inquiry.id })).toHaveLength(1);
		await deleteRecordPhoto({ inquiryId: inquiry.id }, p1.id);
		expect(await listRecordPhotos({ inquiryId: inquiry.id })).toEqual([]);
	});

	it('nur JPG und nicht mehr als erlaubt', async () => {
		const offer = await db.insert(offers).values({ number: '26901', date: '2026-10-19' }).returning({ id: offers.id }).get();
		const owner = { offerId: offer.id };
		await expect(addRecordPhoto(owner, me, new File(['kein Bild'], 'x.jpg'), jpeg(10, 10))).rejects.toThrow(PhotoError);
		await expect(addRecordPhoto(owner, me, new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], 'x.jpg'), jpeg(10, 10))).rejects.toThrow('zu groß');

		for (let i = 0; i < MAX_PHOTOS; i++) await addRecordPhoto(owner, me, jpeg(100, 100, 100 + i), jpeg(10, 10, 100 + i));
		await expect(addRecordPhoto(owner, me, jpeg(100, 100, 999), jpeg(10, 10, 999))).rejects.toThrow(`Höchstens ${MAX_PHOTOS} Fotos je Angebot.`);
	});
});
