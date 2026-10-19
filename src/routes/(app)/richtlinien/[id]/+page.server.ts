import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { folderPath, getDocument } from '$lib/modules/ablage/server/richtlinien';
import type { PageServerLoad } from './$types';

/** Ein PDF der Richtlinien & Vorschriften – wer den Bereich sieht */
export const load: PageServerLoad = async ({ params, locals }) => {
	requirePermission(locals, 'richtlinien.sehen');
	const document = await getDocument(Number(params.id));
	if (!document) error(404, 'Dokument nicht gefunden');
	const path = await folderPath(document.folderId);
	return {
		document: { id: document.id, title: document.title, fileName: document.fileName, size: document.size },
		folder: path.at(-1) ?? null,
		place: path.map((p) => p.name).join(' / ')
	};
};
