import { error, fail } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { DocumentError, takeUploads } from '$lib/server/documents';
import {
	addDocuments,
	allFolders,
	createFolder,
	deleteDocument,
	deleteFolder,
	folderPath,
	getDocument,
	getFolder,
	listFolder,
	moveDocument,
	moveFolder,
	PolicyError,
	renameDocument,
	renameFolder,
	searchPolicies
} from '$lib/modules/ablage/server/richtlinien';
import type { Actions, PageServerLoad } from './$types';

/** Ordner aus Formular oder Adresse: leer heißt ganz oben */
const folderParam = (raw: FormDataEntryValue | string | null): number | null => {
	const n = Number(raw);
	return raw != null && raw !== '' && Number.isInteger(n) && n > 0 ? n : null;
};

export const load: PageServerLoad = async ({ url, locals }) => {
	const user = requirePermission(locals, 'richtlinien.sehen');
	const folderId = folderParam(url.searchParams.get('ordner'));
	const folder = folderId == null ? null : await getFolder(folderId);
	if (folderId != null && !folder) error(404, 'Ordner nicht gefunden');
	const q = (url.searchParams.get('suche') ?? '').trim().slice(0, 100);
	const canEdit = can(user.role, 'richtlinien.bearbeiten');
	return {
		folder: folder ? { id: folder.id, name: folder.name, parentId: folder.parentId } : null,
		path: await folderPath(folderId),
		...(await listFolder(folderId)),
		search: q ? { q, ...(await searchPolicies(q)) } : null,
		// Ziele zum Verschieben – nur, wer verschieben darf
		targets: canEdit ? await allFolders() : [],
		canCreate: can(user.role, 'richtlinien.erstellen'),
		canEdit,
		canDelete: can(user.role, 'richtlinien.loeschen')
	};
};

/** Ordner oder PDF aus dem Formular */
function target(form: FormData) {
	const kind = form.get('art') === 'ordner' ? ('ordner' as const) : ('pdf' as const);
	const id = Number(form.get('id'));
	return { kind, id: Number.isInteger(id) ? id : NaN };
}

async function attempt<T>(fn: () => Promise<T>) {
	try {
		return { ok: true as const, value: await fn() };
	} catch (err) {
		if (err instanceof PolicyError || err instanceof DocumentError) return { ok: false as const, message: err.message };
		throw err;
	}
}

export const actions: Actions = {
	newFolder: async ({ request, locals }) => {
		const user = requirePermission(locals, 'richtlinien.erstellen');
		const form = await request.formData();
		const r = await attempt(() => createFolder(folderParam(form.get('ordner')), form.get('name'), user.id));
		if (!r.ok) return fail(400, { folderError: r.message });
		return { folderCreated: r.value };
	},

	/** PDFs – der Browser lädt sie vorher in Teilen hoch und schickt Kennungen und Namen */
	upload: async ({ request, locals }) => {
		const user = requirePermission(locals, 'richtlinien.erstellen');
		const form = await request.formData();
		const titles = form.getAll('titel').map(String);
		const r = await attempt(async () => {
			const files = takeUploads(user.id, form.getAll('uploads').map(String));
			if (!files.length) throw new PolicyError('Bitte eine oder mehrere PDF-Dateien auswählen.');
			await addDocuments(
				folderParam(form.get('ordner')),
				files.map((f, i) => ({ ...f, title: titles[i] ?? '' })),
				user.id
			);
			return files.length;
		});
		if (!r.ok) return fail(400, { uploadError: r.message });
		return { added: r.value };
	},

	rename: async ({ request, locals }) => {
		requirePermission(locals, 'richtlinien.bearbeiten');
		const form = await request.formData();
		const { kind, id } = target(form);
		const r = await attempt(async () => {
			if (kind === 'ordner') await renameFolder(id, form.get('name'));
			else {
				if (!(await getDocument(id))) throw new PolicyError('Das PDF gibt es nicht mehr.');
				await renameDocument(id, form.get('name'));
			}
		});
		if (!r.ok) return fail(400, { message: r.message });
		return { renamed: true };
	},

	move: async ({ request, locals }) => {
		requirePermission(locals, 'richtlinien.bearbeiten');
		const form = await request.formData();
		const { kind, id } = target(form);
		const to = folderParam(form.get('ziel'));
		const r = await attempt(async () => {
			if (kind === 'ordner') await moveFolder(id, to);
			else {
				if (!(await getDocument(id))) throw new PolicyError('Das PDF gibt es nicht mehr.');
				await moveDocument(id, to);
			}
		});
		if (!r.ok) return fail(400, { message: r.message });
		return { moved: (await folderPath(to)).at(-1)?.name ?? null };
	},

	delete: async ({ request, locals }) => {
		requirePermission(locals, 'richtlinien.loeschen');
		const { kind, id } = target(await request.formData());
		if (!Number.isInteger(id)) return fail(400, { message: 'Was soll gelöscht werden?' });
		if (kind === 'ordner') await deleteFolder(id);
		else await deleteDocument(id);
		return { deleted: kind };
	}
};
