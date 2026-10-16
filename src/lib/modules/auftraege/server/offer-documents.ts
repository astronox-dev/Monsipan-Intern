/**
 * Unterlagen am Angebot: PDFs in jedem Stand, auch wenn das Angebot schon
 * beauftragt ist. Je Datei lässt sich wählen, ob sie auch beim Auftrag für die
 * Partie erscheint (`forCrew`) – sonst bleibt sie beim Büro (etwa ein
 * Leistungsverzeichnis mit Preisen). Abgelegt wie die PDFs am Artikel.
 */
import { and, asc, eq } from 'drizzle-orm';
import { titleFromFileName } from '$lib/documents';
import { db } from '$lib/server/db';
import { offerDocuments } from '$lib/server/db/schema';

const columns = {
	id: offerDocuments.id,
	title: offerDocuments.title,
	fileName: offerDocuments.fileName,
	size: offerDocuments.size,
	forCrew: offerDocuments.forCrew,
	createdAt: offerDocuments.createdAt
};

export function listOfferDocuments(offerId: number) {
	return db.select(columns).from(offerDocuments).where(eq(offerDocuments.offerId, offerId)).orderBy(asc(offerDocuments.createdAt), asc(offerDocuments.id)).all();
}

/** Was davon beim Auftrag für die Partie erscheint */
export function crewDocumentsOfOffer(offerId: number) {
	return db
		.select(columns)
		.from(offerDocuments)
		.where(and(eq(offerDocuments.offerId, offerId), eq(offerDocuments.forCrew, true)))
		.orderBy(asc(offerDocuments.createdAt), asc(offerDocuments.id))
		.all();
}

/** Schon abgelegte Dateien ans Angebot hängen; der Titel kommt aus dem Dateinamen */
export async function addOfferDocuments(offerId: number, files: { name: string; sha256: string; size: number }[], userId: number, forCrew: boolean) {
	for (const f of files) {
		const fileName = (f.name || 'unterlage.pdf').slice(0, 200);
		await db.insert(offerDocuments).values({
			offerId,
			title: titleFromFileName(fileName) || 'Unterlage',
			fileName: /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`,
			sha256: f.sha256,
			size: f.size,
			forCrew,
			uploadedBy: userId
		});
	}
}

export function getOfferDocument(offerId: number, documentId: number) {
	if (!Number.isInteger(documentId)) return undefined;
	return db
		.select()
		.from(offerDocuments)
		.where(and(eq(offerDocuments.id, documentId), eq(offerDocuments.offerId, offerId)))
		.get();
}

export async function setOfferDocumentForCrew(offerId: number, documentId: number, forCrew: boolean) {
	await db
		.update(offerDocuments)
		.set({ forCrew })
		.where(and(eq(offerDocuments.id, documentId), eq(offerDocuments.offerId, offerId)));
}

/** Die Datei bleibt noch eine Weile für Sicherungen liegen */
export async function deleteOfferDocument(offerId: number, documentId: number) {
	await db.delete(offerDocuments).where(and(eq(offerDocuments.id, documentId), eq(offerDocuments.offerId, offerId)));
}
