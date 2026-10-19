/**
 * Pläne und Fotos zum ganzen Vorgang: Was an der Anfrage hängt, steht auch am
 * Angebot und am Auftrag – und umgekehrt. Jedes PDF und Foto gehört weiter dem
 * Datensatz, an dem es hochgeladen wurde (Anfrage, Angebot oder Auftrag), aber
 * gezeigt und verwaltet wird es an jedem davon.
 *
 * PDFs tragen in der Adresse ihre Herkunft: „i12" von der Anfrage, „a12" vom
 * Angebot, „o12" vom Auftrag; eine bloße Zahl meint den Datensatz der Seite.
 * Die Partie sieht nur, was „für die Partie" ist – PDFs vom Auftrag immer.
 *
 * Die Dateien liegen wie alle anderen unter /data/dokumente bzw. /data/fotos.
 */
import { and, asc, count, eq, or, sql, type SQL } from 'drizzle-orm';
import { titleFromFileName } from '$lib/documents';
import { db } from '$lib/server/db';
import { inquiries, inquiryDocuments, offerDocuments, orderDocuments, orders, recordPhotos, users } from '$lib/server/db/schema';
import { storePhoto } from '$lib/modules/tagesberichte/server/photos';
import { MAX_PHOTO_BYTES, MAX_PHOTOS, MAX_THUMB_BYTES, PhotoError } from '$lib/modules/tagesberichte/photos';

/** Ein Vorgang: Anfrage → Angebot → Auftrag; was es (noch) nicht gibt, ist null */
export interface CaseChain {
	inquiryId: number | null;
	offerId: number | null;
	orderId: number | null;
}

export type CaseSource = 'anfrage' | 'angebot' | 'auftrag';

export const SOURCE_LABELS: Record<CaseSource, string> = {
	anfrage: 'aus der Anfrage',
	angebot: 'vom Angebot',
	auftrag: 'vom Auftrag'
};

const inquiryOfOffer = (offerId: number) => db.select({ id: inquiries.id }).from(inquiries).where(eq(inquiries.offerId, offerId)).orderBy(asc(inquiries.id)).get();
const orderOfOffer = (offerId: number) => db.select({ id: orders.id }).from(orders).where(eq(orders.offerId, offerId)).orderBy(asc(orders.id)).get();

export async function chainOfInquiry(inquiryId: number): Promise<CaseChain> {
	const row = await db.select({ offerId: inquiries.offerId }).from(inquiries).where(eq(inquiries.id, inquiryId)).get();
	const offerId = row?.offerId ?? null;
	return { inquiryId, offerId, orderId: offerId ? ((await orderOfOffer(offerId))?.id ?? null) : null };
}

export async function chainOfOffer(offerId: number): Promise<CaseChain> {
	const [inquiry, order] = await Promise.all([inquiryOfOffer(offerId), orderOfOffer(offerId)]);
	return { inquiryId: inquiry?.id ?? null, offerId, orderId: order?.id ?? null };
}

/** Vorgang zu einem Auftrag, wie er vorliegt (mit seinem Angebot) */
export async function chainFor(order: { id: number; offerId: number | null }): Promise<CaseChain> {
	return { inquiryId: order.offerId ? ((await inquiryOfOffer(order.offerId))?.id ?? null) : null, offerId: order.offerId, orderId: order.id };
}

export async function chainOfOrder(orderId: number): Promise<CaseChain> {
	const row = await db.select({ offerId: orders.offerId }).from(orders).where(eq(orders.id, orderId)).get();
	const offerId = row?.offerId ?? null;
	return { inquiryId: offerId ? ((await inquiryOfOffer(offerId))?.id ?? null) : null, offerId, orderId };
}

/* ----------------------------------------------------------------- PDFs */

export interface CaseDocument {
	/** Für die Adresse: „i12", „a12" oder „o12" */
	ref: string;
	source: CaseSource;
	id: number;
	title: string;
	fileName: string;
	size: number;
	forCrew: boolean;
	createdAt: Date;
}

const SOURCE_ORDER: CaseSource[] = ['anfrage', 'angebot', 'auftrag'];

/** Alle PDFs des Vorgangs, die ältesten zuerst; mit `crewOnly` nur, was die Partie sieht */
export async function caseDocuments(chain: CaseChain, opts: { crewOnly?: boolean } = {}): Promise<CaseDocument[]> {
	const [fromInquiry, fromOffer, fromOrder] = await Promise.all([
		chain.inquiryId
			? db
					.select({ id: inquiryDocuments.id, title: inquiryDocuments.title, fileName: inquiryDocuments.fileName, size: inquiryDocuments.size, forCrew: inquiryDocuments.forCrew, createdAt: inquiryDocuments.createdAt })
					.from(inquiryDocuments)
					.where(eq(inquiryDocuments.inquiryId, chain.inquiryId))
					.all()
			: [],
		chain.offerId
			? db
					.select({ id: offerDocuments.id, title: offerDocuments.title, fileName: offerDocuments.fileName, size: offerDocuments.size, forCrew: offerDocuments.forCrew, createdAt: offerDocuments.createdAt })
					.from(offerDocuments)
					.where(eq(offerDocuments.offerId, chain.offerId))
					.all()
			: [],
		chain.orderId
			? db
					.select({ id: orderDocuments.id, title: orderDocuments.title, fileName: orderDocuments.fileName, size: orderDocuments.size, createdAt: orderDocuments.createdAt })
					.from(orderDocuments)
					.where(eq(orderDocuments.orderId, chain.orderId))
					.all()
			: []
	]);
	const all: CaseDocument[] = [
		...fromInquiry.map((d) => ({ ...d, ref: `i${d.id}`, source: 'anfrage' as const })),
		...fromOffer.map((d) => ({ ...d, ref: `a${d.id}`, source: 'angebot' as const })),
		...fromOrder.map((d) => ({ ...d, ref: `o${d.id}`, source: 'auftrag' as const, forCrew: true }))
	];
	return all
		.filter((d) => !opts.crewOnly || d.forCrew)
		.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || +a.createdAt - +b.createdAt || a.id - b.id);
}

/** „i12", „a12", „o12" – eine bloße Zahl gehört zum Datensatz der Seite (`here`) */
export function parseRef(param: string, here: CaseSource): { source: CaseSource; id: number } | null {
	if (/^\d+$/.test(param)) return { source: here, id: Number(param) };
	const m = /^([iao])(\d+)$/.exec(param);
	if (!m) return null;
	return { source: m[1] === 'i' ? 'anfrage' : m[1] === 'a' ? 'angebot' : 'auftrag', id: Number(m[2]) };
}

/** Ein PDF des Vorgangs – nur, wenn es wirklich dazugehört (und mit `crewOnly` für die Partie ist) */
export async function findCaseDocument(chain: CaseChain, ref: { source: CaseSource; id: number } | null, opts: { crewOnly?: boolean } = {}) {
	if (!ref) return undefined;
	let doc: { id: number; title: string; fileName: string; size: number; sha256: string; forCrew: boolean } | undefined;
	if (ref.source === 'anfrage' && chain.inquiryId) {
		doc = await db
			.select({ id: inquiryDocuments.id, title: inquiryDocuments.title, fileName: inquiryDocuments.fileName, size: inquiryDocuments.size, sha256: inquiryDocuments.sha256, forCrew: inquiryDocuments.forCrew })
			.from(inquiryDocuments)
			.where(and(eq(inquiryDocuments.id, ref.id), eq(inquiryDocuments.inquiryId, chain.inquiryId)))
			.get();
	} else if (ref.source === 'angebot' && chain.offerId) {
		doc = await db
			.select({ id: offerDocuments.id, title: offerDocuments.title, fileName: offerDocuments.fileName, size: offerDocuments.size, sha256: offerDocuments.sha256, forCrew: offerDocuments.forCrew })
			.from(offerDocuments)
			.where(and(eq(offerDocuments.id, ref.id), eq(offerDocuments.offerId, chain.offerId)))
			.get();
	} else if (ref.source === 'auftrag' && chain.orderId) {
		const row = await db
			.select({ id: orderDocuments.id, title: orderDocuments.title, fileName: orderDocuments.fileName, size: orderDocuments.size, sha256: orderDocuments.sha256 })
			.from(orderDocuments)
			.where(and(eq(orderDocuments.id, ref.id), eq(orderDocuments.orderId, chain.orderId)))
			.get();
		doc = row && { ...row, forCrew: true };
	}
	if (!doc || (opts.crewOnly && !doc.forCrew)) return undefined;
	return { ...doc, source: ref.source };
}

/** Aus dem Vorgang entfernen – die Datei bleibt noch eine Weile für Sicherungen liegen */
export async function removeCaseDocument(chain: CaseChain, ref: { source: CaseSource; id: number } | null) {
	if (!ref) return;
	if (ref.source === 'anfrage' && chain.inquiryId) {
		await db.delete(inquiryDocuments).where(and(eq(inquiryDocuments.id, ref.id), eq(inquiryDocuments.inquiryId, chain.inquiryId)));
	} else if (ref.source === 'angebot' && chain.offerId) {
		await db.delete(offerDocuments).where(and(eq(offerDocuments.id, ref.id), eq(offerDocuments.offerId, chain.offerId)));
	} else if (ref.source === 'auftrag' && chain.orderId) {
		await db.delete(orderDocuments).where(and(eq(orderDocuments.id, ref.id), eq(orderDocuments.orderId, chain.orderId)));
	}
}

/** „Für die Partie" umschalten – PDFs vom Auftrag sind es immer */
export async function setCaseDocumentForCrew(chain: CaseChain, ref: { source: CaseSource; id: number } | null, forCrew: boolean) {
	if (!ref) return;
	if (ref.source === 'anfrage' && chain.inquiryId) {
		await db.update(inquiryDocuments).set({ forCrew }).where(and(eq(inquiryDocuments.id, ref.id), eq(inquiryDocuments.inquiryId, chain.inquiryId)));
	} else if (ref.source === 'angebot' && chain.offerId) {
		await db.update(offerDocuments).set({ forCrew }).where(and(eq(offerDocuments.id, ref.id), eq(offerDocuments.offerId, chain.offerId)));
	}
}

/** Schon abgelegte Dateien an die Anfrage hängen; der Titel kommt aus dem Dateinamen */
export async function addInquiryDocuments(inquiryId: number, files: { name: string; sha256: string; size: number }[], userId: number, forCrew = true) {
	for (const f of files) {
		const fileName = (f.name || 'unterlage.pdf').slice(0, 200);
		await db.insert(inquiryDocuments).values({
			inquiryId,
			title: titleFromFileName(fileName) || 'Unterlage',
			fileName: /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`,
			sha256: f.sha256,
			size: f.size,
			forCrew,
			uploadedBy: userId
		});
	}
}

/* ---------------------------------------------------------------- Fotos */

/** Wem ein neues Foto gehört: der Anfrage, dem Angebot oder dem Auftrag */
export type PhotoOwner = { inquiryId: number } | { offerId: number } | { orderId: number };

const ownerWhere = (owner: PhotoOwner) =>
	'inquiryId' in owner ? eq(recordPhotos.inquiryId, owner.inquiryId) : 'offerId' in owner ? eq(recordPhotos.offerId, owner.offerId) : eq(recordPhotos.orderId, owner.orderId);

/** Alle Fotos des Vorgangs */
function chainWhere(chain: CaseChain): SQL {
	const parts: SQL[] = [];
	if (chain.inquiryId) parts.push(eq(recordPhotos.inquiryId, chain.inquiryId));
	if (chain.offerId) parts.push(eq(recordPhotos.offerId, chain.offerId));
	if (chain.orderId) parts.push(eq(recordPhotos.orderId, chain.orderId));
	return parts.length ? or(...parts)! : sql`0`;
}

const photoFields = {
	id: recordPhotos.id,
	width: recordPhotos.width,
	height: recordPhotos.height,
	createdAt: recordPhotos.createdAt,
	createdBy: sql<string | null>`nullif(trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')), '')`,
	inquiryId: recordPhotos.inquiryId,
	offerId: recordPhotos.offerId
};

const withSource = <T extends { inquiryId: number | null; offerId: number | null }>({ inquiryId, offerId, ...p }: T) => ({
	...p,
	source: (inquiryId ? 'anfrage' : offerId ? 'angebot' : 'auftrag') as CaseSource
});

/** Fotos des ganzen Vorgangs in der Reihenfolge, in der sie dazukamen – mit `here` steht bei fremden dabei, woher */
export async function casePhotos(chain: CaseChain, here?: CaseSource) {
	const rows = await db
		.select(photoFields)
		.from(recordPhotos)
		.leftJoin(users, eq(users.id, recordPhotos.createdBy))
		.where(chainWhere(chain))
		.orderBy(asc(recordPhotos.createdAt), asc(recordPhotos.id))
		.all();
	return rows.map(withSource).map((p) => ({ ...p, from: here && p.source !== here ? SOURCE_LABELS[p.source] : undefined }));
}

/** Foto ablegen – das Gerät schickt es schon verkleinert, dazu die Vorschau */
export async function addRecordPhoto(owner: PhotoOwner, userId: number, photo: File, thumb: File) {
	const [{ n }] = await db.select({ n: count() }).from(recordPhotos).where(ownerWhere(owner)).all();
	if (n >= MAX_PHOTOS) throw new PhotoError(`Höchstens ${MAX_PHOTOS} Fotos je ${'inquiryId' in owner ? 'Anfrage' : 'offerId' in owner ? 'Angebot' : 'Auftrag'}.`);
	const full = await storePhoto(photo, MAX_PHOTO_BYTES);
	const small = await storePhoto(thumb, MAX_THUMB_BYTES);
	const row = await db
		.insert(recordPhotos)
		.values({
			...owner,
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
	return withSource(added);
}

/** Ein Foto des Vorgangs – nur, wenn es wirklich dazugehört */
export function getCasePhoto(chain: CaseChain, photoId: number) {
	if (!Number.isInteger(photoId)) return undefined;
	return db
		.select({ id: recordPhotos.id, sha256: recordPhotos.sha256, thumbSha256: recordPhotos.thumbSha256 })
		.from(recordPhotos)
		.where(and(eq(recordPhotos.id, photoId), chainWhere(chain)))
		.get();
}

/** Die Datei bleibt noch eine Weile für Sicherungen liegen */
export async function deleteCasePhoto(chain: CaseChain, photoId: number) {
	if (!Number.isInteger(photoId)) return;
	await db.delete(recordPhotos).where(and(eq(recordPhotos.id, photoId), chainWhere(chain)));
}
