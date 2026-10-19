import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vorgang-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { inquiries, offers, orders, recordPhotos, users } = await import('$lib/server/db/schema');
const { documentFile, KEEP_UNUSED_DAYS, storeDocument, tidyDocuments } = await import('$lib/server/documents');
const { photoFile, tidyPhotos } = await import('$lib/modules/tagesberichte/server/photos');
const { MAX_PHOTO_BYTES, MAX_PHOTOS, PhotoError } = await import('$lib/modules/tagesberichte/photos');
const { addOfferDocuments } = await import('./offer-documents');
const { deleteOrder, findOrderDocument, insertOrderDocument, orderDetail } = await import('./orders');
const {
	addInquiryDocuments,
	addRecordPhoto,
	caseDocuments,
	casePhotos,
	chainOfInquiry,
	chainOfOffer,
	chainOfOrder,
	deleteCasePhoto,
	findCaseDocument,
	getCasePhoto,
	parseRef,
	removeCaseDocument,
	setCaseDocumentForCrew
} = await import('./case-files');

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

/** Anfrage → Angebot → Auftrag */
async function vorgang(number: string) {
	const offer = await db.insert(offers).values({ number, date: '2026-10-19', status: 'angenommen' }).returning({ id: offers.id }).get();
	const inquiry = await db.insert(inquiries).values({ receivedOn: '2026-10-19', subject: `Anfrage ${number}`, offerId: offer.id }).returning({ id: inquiries.id }).get();
	const order = await db.insert(orders).values({ number, offerId: offer.id }).returning({ id: orders.id }).get();
	return { inquiryId: inquiry.id, offerId: offer.id, orderId: order.id };
}

describe('Der Vorgang', () => {
	it('findet von jedem Schritt aus die anderen', async () => {
		const v = await vorgang('26100');
		expect(await chainOfInquiry(v.inquiryId)).toEqual(v);
		expect(await chainOfOffer(v.offerId)).toEqual(v);
		expect(await chainOfOrder(v.orderId)).toEqual(v);
		// Eine Anfrage ohne Angebot steht allein
		const alone = await db.insert(inquiries).values({ receivedOn: '2026-10-19', subject: 'Allein' }).returning({ id: inquiries.id }).get();
		expect(await chainOfInquiry(alone.id)).toEqual({ inquiryId: alone.id, offerId: null, orderId: null });
	});

	it('Adressen der PDFs', () => {
		expect(parseRef('12', 'angebot')).toEqual({ source: 'angebot', id: 12 });
		expect(parseRef('i12', 'auftrag')).toEqual({ source: 'anfrage', id: 12 });
		expect(parseRef('a7', 'anfrage')).toEqual({ source: 'angebot', id: 7 });
		expect(parseRef('o3', 'anfrage')).toEqual({ source: 'auftrag', id: 3 });
		expect(parseRef('x3', 'anfrage')).toBeNull();
		expect(parseRef('', 'anfrage')).toBeNull();
	});
});

describe('Pläne am ganzen Vorgang', () => {
	it('was an der Anfrage hängt, steht auch am Angebot und Auftrag – die Partie sieht, was für sie ist', async () => {
		const v = await vorgang('26101');
		const plan = await storeDocument(pdf('Lageplan'));
		const lv = await storeDocument(pdf('LV mit Preisen'));
		const detail = await storeDocument(pdf('Detailplan'));
		await addInquiryDocuments(v.inquiryId, [{ name: 'Lageplan.pdf', ...plan }], me);
		await addOfferDocuments(v.offerId, [{ name: 'LV mit Preisen.pdf', ...lv }], me, false);
		await insertOrderDocument(v.orderId, 'Detailplan.pdf', detail, me);

		const all = await caseDocuments(await chainOfOffer(v.offerId));
		expect(all.map((d) => [d.ref.replace(/\d+$/, ''), d.title, d.forCrew])).toEqual([
			['i', 'Lageplan', true],
			['a', 'LV mit Preisen', false],
			['o', 'Detailplan', true]
		]);
		// Von der Anfrage aus dieselbe Liste
		expect((await caseDocuments(await chainOfInquiry(v.inquiryId))).map((d) => d.ref)).toEqual(all.map((d) => d.ref));
		// Die Partie: ohne das LV mit Preisen
		const crew = await caseDocuments(await chainOfOrder(v.orderId), { crewOnly: true });
		expect(crew.map((d) => d.title)).toEqual(['Lageplan', 'Detailplan']);

		// Beim Auftrag: das PDF der Anfrage – für die Partie; das LV nur, wer Angebote sieht
		const order = (await orderDetail(v.orderId))!;
		expect(order.inquiryDocuments.map((d) => d.title)).toEqual(['Lageplan']);
		const [lageplan, lvDoc] = all;
		expect(await findOrderDocument(order, lageplan.ref)).toMatchObject({ sha256: plan.sha256, source: 'anfrage' });
		expect(await findOrderDocument(order, lvDoc.ref)).toBeUndefined();
		expect(await findOrderDocument(order, lvDoc.ref, { role: 'buchhaltung' })).toMatchObject({ title: 'LV mit Preisen' });
		expect(await findOrderDocument(order, lvDoc.ref, { role: 'arbeiter' })).toBeUndefined();

		// Ein fremder Vorgang kommt nicht dran
		const other = await vorgang('26102');
		expect(await findCaseDocument(await chainOfOffer(other.offerId), parseRef(lageplan.ref, 'angebot'))).toBeUndefined();
		await removeCaseDocument(await chainOfOffer(other.offerId), parseRef(lageplan.ref, 'angebot'));
		expect(await caseDocuments(await chainOfOffer(v.offerId))).toHaveLength(3);

		// Umschalten und Entfernen geht von jedem Schritt aus
		const fromOrder = await chainOfOrder(v.orderId);
		await setCaseDocumentForCrew(fromOrder, parseRef(lvDoc.ref, 'auftrag'), true);
		await setCaseDocumentForCrew(fromOrder, parseRef(lageplan.ref, 'auftrag'), false);
		expect((await caseDocuments(fromOrder, { crewOnly: true })).map((d) => d.title)).toEqual(['LV mit Preisen', 'Detailplan']);

		// Benutzt – bleibt beim Aufräumen liegen, auch wenn die Datei alt ist
		fs.utimesSync(documentFile(plan.sha256), old(), old());
		await tidyDocuments();
		expect(fs.existsSync(documentFile(plan.sha256))).toBe(true);

		await removeCaseDocument(fromOrder, parseRef(lageplan.ref, 'auftrag'));
		expect((await caseDocuments(await chainOfInquiry(v.inquiryId))).map((d) => d.title)).toEqual(['LV mit Preisen', 'Detailplan']);
	});
});

describe('Fotos am ganzen Vorgang', () => {
	it('alle Schritte sehen alle Fotos – fremde nicht', async () => {
		const v = await vorgang('26110');
		const p1 = await addRecordPhoto({ inquiryId: v.inquiryId }, me, jpeg(2400, 1800, 1), jpeg(480, 360, 2));
		const p2 = await addRecordPhoto({ offerId: v.offerId }, me, jpeg(1800, 2400, 3), jpeg(360, 480, 4));
		const p3 = await addRecordPhoto({ orderId: v.orderId }, me, jpeg(1200, 900, 5), jpeg(240, 180, 6));
		expect(p1).toMatchObject({ width: 2400, height: 1800, source: 'anfrage' });

		const fromOffer = await casePhotos(await chainOfOffer(v.offerId), 'angebot');
		expect(fromOffer.map((p) => [p.id, p.source, p.from])).toEqual([
			[p1.id, 'anfrage', 'aus der Anfrage'],
			[p2.id, 'angebot', undefined],
			[p3.id, 'auftrag', 'vom Auftrag']
		]);
		expect((await casePhotos(await chainOfInquiry(v.inquiryId))).map((p) => p.id)).toEqual([p1.id, p2.id, p3.id]);

		const other = await chainOfOffer((await vorgang('26111')).offerId);
		expect(await getCasePhoto(other, p1.id)).toBeUndefined();
		const stored = (await getCasePhoto(await chainOfOrder(v.orderId), p1.id))!;
		expect(fs.existsSync(photoFile(stored.sha256))).toBe(true);

		// Aufräumen lässt benutzte Bilder liegen
		fs.utimesSync(photoFile(stored.sha256), old(), old());
		await tidyPhotos();
		expect(fs.existsSync(photoFile(stored.sha256))).toBe(true);

		// Löschen über einen fremden Vorgang tut nichts, über den eigenen auch vom Auftrag aus
		await deleteCasePhoto(other, p1.id);
		await deleteCasePhoto(await chainOfOrder(v.orderId), p1.id);
		expect((await casePhotos(await chainOfOffer(v.offerId))).map((p) => p.id)).toEqual([p2.id, p3.id]);

		// Mit dem Auftrag gehen seine Fotos; die vom Angebot bleiben
		await deleteOrder(v.orderId);
		expect((await db.select({ id: recordPhotos.id }).from(recordPhotos).all()).map((r) => r.id)).toEqual([p2.id]);
	});

	it('nur JPG und nicht mehr als erlaubt', async () => {
		const owner = { orderId: (await vorgang('26112')).orderId };
		await expect(addRecordPhoto(owner, me, new File(['kein Bild'], 'x.jpg'), jpeg(10, 10))).rejects.toThrow(PhotoError);
		await expect(addRecordPhoto(owner, me, new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], 'x.jpg'), jpeg(10, 10))).rejects.toThrow('zu groß');
		for (let i = 0; i < MAX_PHOTOS; i++) await addRecordPhoto(owner, me, jpeg(100, 100, 100 + i), jpeg(10, 10, 100 + i));
		await expect(addRecordPhoto(owner, me, jpeg(100, 100, 999), jpeg(10, 10, 999))).rejects.toThrow(`Höchstens ${MAX_PHOTOS} Fotos je Auftrag.`);
	});
});
