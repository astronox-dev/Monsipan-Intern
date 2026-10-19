/**
 * Richtlinien & Vorschriften: PDFs in Ordnern, wie in einem Dateibrowser.
 * Ordner lassen sich schachteln, umbenennen, verschieben und samt Inhalt
 * löschen; PDFs bekommen beim Hochladen einen eigenen Namen. Die Dateien
 * liegen wie alle PDFs unter /data/dokumente (siehe $lib/server/documents).
 */
import { asc, eq, isNull, or, sql, type AnyColumn } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { policyDocuments, policyFolders, users } from '$lib/server/db/schema';

export const MAX_NAME = 120;

export class PolicyError extends Error {}

/** Name für Ordner und PDF: ohne Steuerzeichen, Leerraum zusammengezogen */
export function cleanName(raw: unknown): string {
	return String(raw ?? '')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_NAME);
}

const byName = (a: string, b: string) => a.localeCompare(b, 'de-AT', { numeric: true, sensitivity: 'base' });
const folderWhere = (folderId: number | null) => (folderId == null ? isNull(policyFolders.parentId) : eq(policyFolders.parentId, folderId));
const docWhere = (folderId: number | null) => (folderId == null ? isNull(policyDocuments.folderId) : eq(policyDocuments.folderId, folderId));
const uploader = sql<string | null>`nullif(trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')), '')`;

export function getFolder(id: number) {
	if (!Number.isInteger(id)) return undefined;
	return db.select({ id: policyFolders.id, name: policyFolders.name, parentId: policyFolders.parentId }).from(policyFolders).where(eq(policyFolders.id, id)).get();
}

/**
 * Alle Ordner auf einmal – es sind wenige; Wege und Unterordner rechnet der
 * Server daraus, statt Ebene für Ebene abzufragen.
 */
async function folderTree() {
	const rows = await db.select({ id: policyFolders.id, name: policyFolders.name, parentId: policyFolders.parentId }).from(policyFolders).all();
	const byId = new Map(rows.map((r) => [r.id, r]));
	/** Von oben bis zu diesem Ordner, er selbst zuletzt */
	const pathOf = (id: number) => {
		const out: { id: number; name: string }[] = [];
		const seen = new Set<number>();
		for (let f = byId.get(id); f && !seen.has(f.id); f = f.parentId == null ? undefined : byId.get(f.parentId)) {
			seen.add(f.id);
			out.unshift({ id: f.id, name: f.name });
		}
		return out;
	};
	/** Alle Ordner darunter, ohne ihn selbst */
	const below = (id: number) => {
		const out = new Set<number>();
		const queue = [id];
		while (queue.length) {
			const current = queue.shift()!;
			for (const r of rows) {
				if (r.parentId === current && !out.has(r.id) && r.id !== id) {
					out.add(r.id);
					queue.push(r.id);
				}
			}
		}
		return out;
	};
	return { rows, pathOf, below };
}

/** Der Weg von oben bis zu diesem Ordner (er selbst zuletzt) */
export async function folderPath(id: number | null): Promise<{ id: number; name: string }[]> {
	if (id == null) return [];
	return (await folderTree()).pathOf(id);
}

/**
 * Inhalt eines Ordners (ohne Angabe: ganz oben) – Ordner zuerst, je nach Name.
 * Bei den Ordnern steht, wie viel samt Unterordnern darin liegt.
 */
export async function listFolder(folderId: number | null) {
	const [tree, perFolder, folders, documents] = await Promise.all([
		folderTree(),
		db.select({ folderId: policyDocuments.folderId, n: sql<number>`count(*)` }).from(policyDocuments).groupBy(policyDocuments.folderId).all(),
		db.select({ id: policyFolders.id, name: policyFolders.name, createdAt: policyFolders.createdAt }).from(policyFolders).where(folderWhere(folderId)).all(),
		db
			.select({
				id: policyDocuments.id,
				title: policyDocuments.title,
				fileName: policyDocuments.fileName,
				size: policyDocuments.size,
				createdAt: policyDocuments.createdAt,
				uploadedBy: uploader
			})
			.from(policyDocuments)
			.leftJoin(users, eq(users.id, policyDocuments.uploadedBy))
			.where(docWhere(folderId))
			.all()
	]);
	const docsIn = new Map(perFolder.map((r) => [r.folderId, Number(r.n)]));
	const contents = (id: number) => {
		const inside = tree.below(id);
		let docs = docsIn.get(id) ?? 0;
		for (const i of inside) docs += docsIn.get(i) ?? 0;
		return { folders: inside.size, documents: docs };
	};
	return {
		folders: folders.map((f) => ({ ...f, ...contents(f.id) })).sort((a, b) => byName(a.name, b.name)),
		documents: documents.sort((a, b) => byName(a.title, b.title) || a.id - b.id)
	};
}

/** Alle Ordner mit ihrem Weg („Bau / Sicherheit") – zum Verschieben */
export async function allFolders(): Promise<{ id: number; path: string }[]> {
	const { rows, pathOf } = await folderTree();
	return rows
		.map((r) => ({ id: r.id, parts: pathOf(r.id).map((p) => p.name) }))
		.sort((a, b) => {
			for (let i = 0; i < Math.min(a.parts.length, b.parts.length); i++) {
				const c = byName(a.parts[i], b.parts[i]);
				if (c) return c;
			}
			return a.parts.length - b.parts.length;
		})
		.map((r) => ({ id: r.id, path: r.parts.join(' / ') }));
}

/** Gibt es im Ordner schon einen Unterordner mit diesem Namen (Groß-/Kleinschreibung egal)? */
async function nameTaken(parentId: number | null, name: string, except?: number) {
	const rows = await db.select({ id: policyFolders.id, name: policyFolders.name }).from(policyFolders).where(folderWhere(parentId)).all();
	return rows.some((r) => r.id !== except && byName(r.name, name) === 0);
}

async function checkParent(parentId: number | null) {
	if (parentId != null && !(await getFolder(parentId))) throw new PolicyError('Den Ordner gibt es nicht mehr.');
}

export async function createFolder(parentId: number | null, rawName: unknown, userId: number): Promise<number> {
	const name = cleanName(rawName);
	if (!name) throw new PolicyError('Bitte einen Namen für den Ordner eingeben.');
	await checkParent(parentId);
	if (await nameTaken(parentId, name)) throw new PolicyError(`Einen Ordner „${name}“ gibt es hier schon.`);
	const row = await db.insert(policyFolders).values({ parentId, name, createdBy: userId }).returning({ id: policyFolders.id }).get();
	return row.id;
}

export async function renameFolder(id: number, rawName: unknown) {
	const folder = await getFolder(id);
	if (!folder) throw new PolicyError('Den Ordner gibt es nicht mehr.');
	const name = cleanName(rawName);
	if (!name) throw new PolicyError('Bitte einen Namen für den Ordner eingeben.');
	if (await nameTaken(folder.parentId, name, id)) throw new PolicyError(`Einen Ordner „${name}“ gibt es hier schon.`);
	await db.update(policyFolders).set({ name }).where(eq(policyFolders.id, id));
}

export async function moveFolder(id: number, parentId: number | null) {
	const folder = await getFolder(id);
	if (!folder) throw new PolicyError('Den Ordner gibt es nicht mehr.');
	if (folder.parentId === parentId) return;
	if (parentId === id || (parentId != null && (await folderTree()).below(id).has(parentId))) {
		throw new PolicyError('Ein Ordner kann nicht in sich selbst liegen.');
	}
	await checkParent(parentId);
	if (await nameTaken(parentId, folder.name, id)) throw new PolicyError(`Dort gibt es schon einen Ordner „${folder.name}“.`);
	await db.update(policyFolders).set({ parentId }).where(eq(policyFolders.id, id));
}

/** Samt Unterordnern und PDFs; die Dateien bleiben noch eine Weile für Sicherungen liegen */
export async function deleteFolder(id: number) {
	await db.delete(policyFolders).where(eq(policyFolders.id, id));
}

/* ------------------------------------------------------------------ PDFs */

/** Schon abgelegte Dateien in den Ordner legen – mit dem Namen aus dem Formular, sonst aus dem Dateinamen */
export async function addDocuments(folderId: number | null, files: { name: string; title: string; sha256: string; size: number }[], userId: number) {
	await checkParent(folderId);
	for (const f of files) {
		const fileName = cleanName(f.name).slice(0, 200) || 'dokument.pdf';
		await db.insert(policyDocuments).values({
			folderId,
			title: cleanName(f.title) || cleanName(fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ')) || 'Dokument',
			fileName: /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`,
			sha256: f.sha256,
			size: f.size,
			uploadedBy: userId
		});
	}
}

export function getDocument(id: number) {
	if (!Number.isInteger(id)) return undefined;
	return db.select().from(policyDocuments).where(eq(policyDocuments.id, id)).get();
}

export async function renameDocument(id: number, rawTitle: unknown) {
	const title = cleanName(rawTitle);
	if (!title) throw new PolicyError('Bitte einen Namen eingeben.');
	await db.update(policyDocuments).set({ title }).where(eq(policyDocuments.id, id));
}

export async function moveDocument(id: number, folderId: number | null) {
	await checkParent(folderId);
	await db.update(policyDocuments).set({ folderId }).where(eq(policyDocuments.id, id));
}

/** Die Datei bleibt noch eine Weile für Sicherungen liegen */
export async function deleteDocument(id: number) {
	await db.delete(policyDocuments).where(eq(policyDocuments.id, id));
}

/* ----------------------------------------------------------------- Suche */

/** Enthält den Text – % und _ gelten als Zeichen, nicht als Platzhalter */
const contains = (column: AnyColumn, pattern: string) => sql`${column} like ${pattern} escape '\\'`;

/** Ordner und PDFs im ganzen Bereich, mit ihrem Ort */
export async function searchPolicies(raw: string, limit = 100) {
	const q = raw.trim();
	if (!q) return { folders: [], documents: [] };
	const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	const [folders, documents, paths] = await Promise.all([
		db.select({ id: policyFolders.id, name: policyFolders.name, parentId: policyFolders.parentId }).from(policyFolders).where(contains(policyFolders.name, pattern)).limit(limit).all(),
		db
			.select({
				id: policyDocuments.id,
				title: policyDocuments.title,
				fileName: policyDocuments.fileName,
				size: policyDocuments.size,
				createdAt: policyDocuments.createdAt,
				folderId: policyDocuments.folderId,
				uploadedBy: uploader
			})
			.from(policyDocuments)
			.leftJoin(users, eq(users.id, policyDocuments.uploadedBy))
			.where(or(contains(policyDocuments.title, pattern), contains(policyDocuments.fileName, pattern)))
			.orderBy(asc(policyDocuments.title))
			.limit(limit)
			.all(),
		allFolders()
	]);
	const where = new Map(paths.map((p) => [p.id, p.path]));
	const place = (id: number | null) => (id == null ? '' : (where.get(id) ?? ''));
	return {
		folders: folders.map((f) => ({ id: f.id, name: f.name, place: place(f.parentId) })).sort((a, b) => byName(a.name, b.name)),
		documents: documents.map((d) => ({ ...d, place: place(d.folderId) })).sort((a, b) => byName(a.title, b.title))
	};
}
