/**
 * Anhänge an Anfrage und Angebot: Fotos (an beiden) und PDFs an der Anfrage –
 * die PDFs am Angebot stehen in offer-documents.ts. Fotos liegen wie die der
 * Tagesberichte unter /data/fotos, PDFs wie alle anderen unter /data/dokumente.
 */
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { titleFromFileName } from '$lib/documents';
import { db } from '$lib/server/db';
import { inquiryDocuments, recordPhotos, users } from '$lib/server/db/schema';
import { storePhoto } from '$lib/modules/tagesberichte/server/photos';
import { MAX_PHOTO_BYTES, MAX_PHOTOS, MAX_THUMB_BYTES, PhotoError } from '$lib/modules/tagesberichte/photos';

/** Wem die Fotos gehören: einer Anfrage oder einem Angebot */
export type PhotoOwner = { inquiryId: number } | { offerId: number };

const ownerWhere = (owner: PhotoOwner) => ('inquiryId' in owner ? eq(recordPhotos.inquiryId, owner.inquiryId) : eq(recordPhotos.offerId, owner.offerId));

const photoFields = {
	id: recordPhotos.id,
	width: recordPhotos.width,
	height: recordPhotos.height,
	createdAt: recordPhotos.createdAt,
	createdBy: sql<string | null>`nullif(trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')), '')`
};

export function listRecordPhotos(owner: PhotoOwner) {
	return db
		.select(photoFields)
		.from(recordPhotos)
		.leftJoin(users, eq(users.id, recordPhotos.createdBy))
		.where(ownerWhere(owner))
		.orderBy(asc(recordPhotos.createdAt), asc(recordPhotos.id))
		.all();
}

/** Foto ablegen – das Gerät schickt es schon verkleinert, dazu die Vorschau */
export async function addRecordPhoto(owner: PhotoOwner, userId: number, photo: File, thumb: File) {
	const [{ n }] = await db.select({ n: count() }).from(recordPhotos).where(ownerWhere(owner)).all();
	if (n >= MAX_PHOTOS) throw new PhotoError(`Höchstens ${MAX_PHOTOS} Fotos je ${'inquiryId' in owner ? 'Anfrage' : 'Angebot'}.`);
	const full = await storePhoto(photo, MAX_PHOTO_BYTES);
	const small = await storePhoto(thumb, MAX_THUMB_BYTES);
	const row = await db
		.insert(recordPhotos)
		.values({
			...('inquiryId' in owner ? { inquiryId: owner.inquiryId } : { offerId: owner.offerId }),
			sha256: full.sha256,
			thumbSha256: small.sha256,
			width: full.width,
			height: full.height,
			size: full.bytes,
			createdBy: userId
		})
		.returning({ id: recordPhotos.id })
		.get();
	const [added] = await db.select(photoFields).from(recordPhotos).leftJoin(users, eq(users.id, recordPhotos.createdBy)).where(eq(recordPhotos.id, row.id)).all();
	return added;
}

export function getRecordPhoto(owner: PhotoOwner, photoId: number) {
	if (!Number.isInteger(photoId)) return undefined;
	return db
		.select({ id: recordPhotos.id, sha256: recordPhotos.sha256, thumbSha256: recordPhotos.thumbSha256 })
		.from(recordPhotos)
		.where(and(eq(recordPhotos.id, photoId), ownerWhere(owner)))
		.get();
}

/** Die Datei bleibt noch eine Weile für Sicherungen liegen */
export async function deleteRecordPhoto(owner: PhotoOwner, photoId: number) {
	await db.delete(recordPhotos).where(and(eq(recordPhotos.id, photoId), ownerWhere(owner)));
}

/* ------------------------------------------------ PDFs an der Anfrage */

const docColumns = {
	id: inquiryDocuments.id,
	title: inquiryDocuments.title,
	fileName: inquiryDocuments.fileName,
	size: inquiryDocuments.size,
	createdAt: inquiryDocuments.createdAt
};

export function listInquiryDocuments(inquiryId: number) {
	return db
		.select(docColumns)
		.from(inquiryDocuments)
		.where(eq(inquiryDocuments.inquiryId, inquiryId))
		.orderBy(asc(inquiryDocuments.createdAt), asc(inquiryDocuments.id))
		.all();
}

/** Schon abgelegte Dateien an die Anfrage hängen; der Titel kommt aus dem Dateinamen */
export async function addInquiryDocuments(inquiryId: number, files: { name: string; sha256: string; size: number }[], userId: number) {
	for (const f of files) {
		const fileName = (f.name || 'unterlage.pdf').slice(0, 200);
		await db.insert(inquiryDocuments).values({
			inquiryId,
			title: titleFromFileName(fileName) || 'Unterlage',
			fileName: /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`,
			sha256: f.sha256,
			size: f.size,
			uploadedBy: userId
		});
	}
}

export function getInquiryDocument(inquiryId: number, documentId: number) {
	if (!Number.isInteger(documentId)) return undefined;
	return db
		.select()
		.from(inquiryDocuments)
		.where(and(eq(inquiryDocuments.id, documentId), eq(inquiryDocuments.inquiryId, inquiryId)))
		.get();
}

export async function deleteInquiryDocument(inquiryId: number, documentId: number) {
	await db.delete(inquiryDocuments).where(and(eq(inquiryDocuments.id, documentId), eq(inquiryDocuments.inquiryId, inquiryId)));
}
