/**
 * Fotos am Tagesbericht. Die Datenbank kennt Prüfsumme, Maße und wer es
 * hochgeladen hat; die Dateien liegen unter /data/fotos/<sha256>.jpg – das
 * Foto und seine Vorschau je als eigene Datei.
 *
 * Wie bei den PDFs am Artikel bleiben Dateien gelöschter Fotos noch eine Weile
 * liegen, damit eine eingespielte Sicherung ihre Bilder wiederfindet.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { DATA_DIR, db } from '$lib/server/db';
import { dailyReportPhotos, recordPhotos, users } from '$lib/server/db/schema';
import { tidyFolder } from '$lib/server/documents';
import { jpegSize, MAX_PHOTO_BYTES, MAX_PHOTOS, MAX_THUMB_BYTES, PhotoError } from '../photos';

export const PHOTO_DIR = path.join(DATA_DIR, 'fotos');
const SHA_FILE = /^([0-9a-f]{64})\.jpg$/;

export const photoFile = (sha256: string) => path.join(PHOTO_DIR, `${sha256}.jpg`);

/** Datei prüfen und unter ihrer Prüfsumme ablegen – auch für die Fotos an Anfragen und Angeboten */
export async function storePhoto(upload: File, max: number) {
	if (upload.size === 0) throw new PhotoError('Das Bild ist leer.');
	if (upload.size > max) throw new PhotoError(`Das Bild ist zu groß – erlaubt sind ${Math.round(max / 1024 / 1024)} MB.`);
	const buf = Buffer.from(await upload.arrayBuffer());
	const size = jpegSize(buf);
	if (!size) throw new PhotoError('Das ist kein lesbares JPG-Bild.');
	const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
	await fs.promises.mkdir(PHOTO_DIR, { recursive: true });
	const target = photoFile(sha256);
	if (!fs.existsSync(target)) {
		const temp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
		await fs.promises.writeFile(temp, buf);
		await fs.promises.rename(temp, target);
	}
	return { sha256, bytes: buf.length, ...size };
}

const listFields = {
	id: dailyReportPhotos.id,
	width: dailyReportPhotos.width,
	height: dailyReportPhotos.height,
	createdAt: dailyReportPhotos.createdAt,
	createdBy: sql<string | null>`nullif(trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')), '')`
};

export type ReportPhoto = Awaited<ReturnType<typeof listPhotos>>[number];

/** Fotos eines Berichts in der Reihenfolge, in der sie dazukamen */
export function listPhotos(reportId: number) {
	return db
		.select(listFields)
		.from(dailyReportPhotos)
		.leftJoin(users, eq(users.id, dailyReportPhotos.createdBy))
		.where(eq(dailyReportPhotos.reportId, reportId))
		.orderBy(asc(dailyReportPhotos.createdAt), asc(dailyReportPhotos.id))
		.all();
}

/**
 * Fotos samt Datei zum Drucken und fürs PDF – mit ihrer Nummer im Bericht
 * (Foto 1, 2, …), auch wenn nur eines davon gewünscht ist.
 */
export async function photosWithFiles(reportId: number, only?: number) {
	const rows = await db
		.select({ ...listFields, sha256: dailyReportPhotos.sha256 })
		.from(dailyReportPhotos)
		.leftJoin(users, eq(users.id, dailyReportPhotos.createdBy))
		.where(eq(dailyReportPhotos.reportId, reportId))
		.orderBy(asc(dailyReportPhotos.createdAt), asc(dailyReportPhotos.id))
		.all();
	const numbered = rows.map((r, i) => ({ ...r, number: i + 1 }));
	return only === undefined ? numbered : numbered.filter((r) => r.id === only);
}

export async function addPhoto(reportId: number, userId: number, photo: File, thumb: File): Promise<ReportPhoto> {
	const [{ n }] = await db.select({ n: count() }).from(dailyReportPhotos).where(eq(dailyReportPhotos.reportId, reportId)).all();
	if (n >= MAX_PHOTOS) throw new PhotoError(`Ein Bericht kann höchstens ${MAX_PHOTOS} Fotos haben.`);
	const full = await storePhoto(photo, MAX_PHOTO_BYTES);
	const small = await storePhoto(thumb, MAX_THUMB_BYTES);
	const row = await db
		.insert(dailyReportPhotos)
		.values({
			reportId,
			sha256: full.sha256,
			thumbSha256: small.sha256,
			width: full.width,
			height: full.height,
			size: full.bytes,
			createdBy: userId
		})
		.returning({ id: dailyReportPhotos.id })
		.get();
	const [added] = await db
		.select(listFields)
		.from(dailyReportPhotos)
		.leftJoin(users, eq(users.id, dailyReportPhotos.createdBy))
		.where(eq(dailyReportPhotos.id, row.id))
		.all();
	return added;
}

export function getPhoto(reportId: number, photoId: number) {
	return db
		.select({ id: dailyReportPhotos.id, sha256: dailyReportPhotos.sha256, thumbSha256: dailyReportPhotos.thumbSha256 })
		.from(dailyReportPhotos)
		.where(and(eq(dailyReportPhotos.id, photoId), eq(dailyReportPhotos.reportId, reportId)))
		.get();
}

export async function deletePhoto(reportId: number, photoId: number) {
	await db.delete(dailyReportPhotos).where(and(eq(dailyReportPhotos.id, photoId), eq(dailyReportPhotos.reportId, reportId)));
}

/** Einmal am Tag: benutzte Bilder frisch halten, lange unbenutzte löschen – auch die an Anfragen und Angeboten */
export async function tidyPhotos(now = new Date()): Promise<{ removed: number }> {
	const [reports, records] = await Promise.all([
		db.select({ a: dailyReportPhotos.sha256, b: dailyReportPhotos.thumbSha256 }).from(dailyReportPhotos).all(),
		db.select({ a: recordPhotos.sha256, b: recordPhotos.thumbSha256 }).from(recordPhotos).all()
	]);
	return tidyFolder(PHOTO_DIR, SHA_FILE, new Set([...reports, ...records].flatMap((r) => [r.a, r.b])), now);
}
