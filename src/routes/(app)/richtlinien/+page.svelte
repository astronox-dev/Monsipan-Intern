<script lang="ts">
	/**
	 * Richtlinien & Vorschriften als Dateibrowser: Ordner öffnen, oben der Weg
	 * zurück. PDFs hochladen (Knopf oder Dateien auf die Seite ziehen) und dabei
	 * benennen; mit ⋯ umbenennen, verschieben, löschen – oder Einträge auf einen
	 * Ordner bzw. den Weg oben ziehen. Die Suche geht über alle Ordner.
	 */
	import { pageTitle } from '$lib/app';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Scale from '@lucide/svelte/icons/scale';
	import Folder from '@lucide/svelte/icons/folder';
	import FolderPlus from '@lucide/svelte/icons/folder-plus';
	import FolderUp from '@lucide/svelte/icons/folder-up';
	import FileText from '@lucide/svelte/icons/file-text';
	import Upload from '@lucide/svelte/icons/upload';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Trash from '@lucide/svelte/icons/trash';
	import X from '@lucide/svelte/icons/x';
	import Dialog from '$lib/components/Dialog.svelte';
	import SearchInput from '$lib/components/SearchInput.svelte';
	import { draggable, dropzone, type DragItem } from '$lib/dnd';
	import { fileSizeLabel, titleFromFileName } from '$lib/documents';
	import { date as dateLabel } from '$lib/format';
	import { toast } from '$lib/stores/toast.svelte';
	import { uploadPdf, UploadError } from '$lib/upload';

	let { data, form } = $props();

	const here = $derived(data.folder?.id ?? null);
	const hereName = $derived(data.folder?.name ?? 'Richtlinien & Vorschriften');
	const manage = $derived(data.canEdit || data.canDelete);

	const contentsLabel = (c: { folders: number; documents: number }) =>
		[c.folders ? (c.folders === 1 ? '1 Ordner' : `${c.folders} Ordner`) : '', c.documents ? (c.documents === 1 ? '1 PDF' : `${c.documents} PDFs`) : '']
			.filter(Boolean)
			.join(' · ') || 'leer';

	/* ------------------------------------------------------------ Aktionen */

	async function post(action: string, fields: Record<string, string | number | null>, ok?: string) {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) body.append(key, value == null ? '' : String(value));
		const res = await fetch(`?/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		if (result.type === 'failure') toast.error(String(result.data?.message ?? 'Das hat nicht geklappt.'));
		else if (result.type === 'error') toast.error('Das hat nicht geklappt – bitte noch einmal versuchen.');
		else if (ok) toast.success(ok);
		await invalidateAll();
		return result.type === 'success';
	}

	/* -------------------------------------------- Ziehen auf einen Ordner */

	interface Entry {
		kind: 'ordner' | 'pdf';
		id: number;
		name: string;
	}

	const dropInto = (folderId: number | null, folderName: string) => (item: DragItem) => {
		const e = item.data as Entry;
		if (e.kind === 'ordner' && e.id === folderId) return;
		post('move', { art: e.kind, id: e.id, ziel: folderId }, `„${e.name}“ liegt jetzt in „${folderName}“`);
	};

	/* ---------------------------------------------------------- Hochladen */

	let picked = $state<{ key: number; file: File; title: string }[]>([]);
	let uploading = $state(false);
	let share = $state(0);
	let uploadError = $state('');
	let nextKey = 0;

	function pick(files: FileList | File[] | null | undefined) {
		const list = [...(files ?? [])];
		const pdfs = list.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
		const others = list.length - pdfs.length;
		if (others) toast.error(others === 1 ? 'Eine Datei ist keine PDF – sie bleibt weg.' : `${others} Dateien sind keine PDFs – sie bleiben weg.`);
		if (!pdfs.length) return;
		uploadError = '';
		picked = [...picked, ...pdfs.map((file) => ({ key: nextKey++, file, title: titleFromFileName(file.name) || file.name }))];
	}

	function closeUpload() {
		if (uploading) return;
		picked = [];
		uploadError = '';
	}

	/* Dateien vom Computer auf die Seite ziehen */
	let fileDrag = $state(0);
	const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
	function ondragenter(e: DragEvent) {
		if (!data.canCreate || !hasFiles(e)) return;
		e.preventDefault();
		fileDrag++;
	}
	function ondragover(e: DragEvent) {
		if (!data.canCreate || !hasFiles(e)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}
	function ondragleave(e: DragEvent) {
		if (!data.canCreate || !hasFiles(e)) return;
		fileDrag = Math.max(0, fileDrag - 1);
	}
	function ondrop(e: DragEvent) {
		if (!data.canCreate || !hasFiles(e)) return;
		e.preventDefault();
		fileDrag = 0;
		pick(e.dataTransfer?.files);
	}

	/* ------------------------------------------------------- Neuer Ordner */

	let folderOpen = $state(false);
	let folderBusy = $state(false);

	/* ------------------------------------------ ⋯: umbenennen, verschieben */

	let item = $state<(Entry & { contents?: { folders: number; documents: number } }) | null>(null);
	let confirmDelete = $state(false);
	let busy = $state(false);

	function openItem(e: Entry & { contents?: { folders: number; documents: number } }) {
		item = e;
		confirmDelete = false;
	}

	/** Wohin verschoben werden kann: ein Ordner nicht in sich selbst oder seine Unterordner */
	const targets = $derived.by(() => {
		if (!item) return [];
		if (item.kind === 'pdf') return data.targets;
		const own = data.targets.find((t) => t.id === item!.id)?.path;
		return data.targets.filter((t) => t.id !== item!.id && !(own && t.path.startsWith(`${own} / `)));
	});
	/** Wo der Eintrag gerade liegt – vorausgewählt */
	const currentPlace = $derived(data.search ? null : here);

	const itemSubmit = (ok: (data: Record<string, unknown> | undefined) => string) => () => {
		busy = true;
		return async ({ result, update }: { result: import('@sveltejs/kit').ActionResult; update: (o?: { reset?: boolean }) => Promise<void> }) => {
			busy = false;
			if (result.type === 'success') {
				toast.success(ok(result.data));
				item = null;
			} else if (result.type === 'failure') toast.error(String(result.data?.message ?? 'Das hat nicht geklappt.'));
			await update({ reset: false });
		};
	};
</script>

<svelte:head><title>{pageTitle(data.folder ? data.folder.name : 'Richtlinien & Vorschriften')}</title></svelte:head>
<svelte:window {ondragenter} {ondragover} {ondragleave} {ondrop} />

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Scale size={26} aria-hidden="true" />Richtlinien & Vorschriften</h1>
		<p class="text-ink-2">Vorschriften, Normen und Anweisungen als PDF – zum Nachschlagen, auch auf der Baustelle.</p>
	</div>
	{#if data.canCreate}
		<div class="flex flex-wrap gap-2">
			<button type="button" class="btn btn-secondary" onclick={() => (folderOpen = true)}><FolderPlus size={18} aria-hidden="true" />Neuer Ordner</button>
			<label class="upload btn btn-primary">
				<Upload size={18} aria-hidden="true" />PDF hochladen
				<input
					type="file"
					accept="application/pdf,.pdf"
					multiple
					class="sr-only"
					onchange={(e) => {
						pick(e.currentTarget.files);
						e.currentTarget.value = '';
					}}
				/>
			</label>
		</div>
	{/if}
</div>

<!-- Weg zum Ordner und Suche über alles -->
<div class="card mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 p-2 pl-3">
	<nav aria-label="Ordner" class="min-w-0 flex-1">
		<ol class="flex flex-wrap items-center gap-0.5 text-[0.9375rem]">
			<li>
				{#if data.path.length || data.search}
					<a href="/richtlinien" class="crumb" use:dropzone={{ accepts: ['eintrag'], onDrop: dropInto(null, 'Richtlinien & Vorschriften') }}>
						<Scale size={16} aria-hidden="true" />Alle
					</a>
				{:else}
					<span class="crumb font-semibold" aria-current="page"><Scale size={16} aria-hidden="true" />Alle</span>
				{/if}
			</li>
			{#each data.path as p, i (p.id)}
				<li class="flex min-w-0 items-center gap-0.5">
					<ChevronRight size={16} class="shrink-0 text-ink-3" aria-hidden="true" />
					{#if i === data.path.length - 1 && !data.search}
						<span class="crumb min-w-0 font-semibold" aria-current="page"><span class="truncate">{p.name}</span></span>
					{:else}
						<a href="/richtlinien?ordner={p.id}" class="crumb min-w-0" use:dropzone={{ accepts: ['eintrag'], onDrop: dropInto(p.id, p.name) }}>
							<span class="truncate">{p.name}</span>
						</a>
					{/if}
				</li>
			{/each}
			{#if data.search}
				<li class="flex items-center gap-0.5">
					<ChevronRight size={16} class="shrink-0 text-ink-3" aria-hidden="true" />
					<span class="crumb font-semibold" aria-current="page">Suche</span>
				</li>
			{/if}
		</ol>
	</nav>
	<form method="GET" class="w-full sm:w-80" role="search">
		{#if data.folder}<input type="hidden" name="ordner" value={data.folder.id} />{/if}
		<SearchInput value={data.search?.q ?? ''} name="suche" placeholder="In allen Ordnern suchen" label="Richtlinien durchsuchen" />
	</form>
</div>

{#snippet more(e: Entry & { contents?: { folders: number; documents: number } })}
	{#if manage}
		<button
			type="button"
			class="mr-1.5 grid size-10 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink"
			aria-label="{e.name}: umbenennen, verschieben, löschen"
			onclick={() => openItem(e)}
		>
			<Ellipsis size={18} />
		</button>
	{/if}
{/snippet}

{#snippet folderIcon()}
	<Folder size={22} class="shrink-0 text-ink" fill="var(--c-brand)" aria-hidden="true" />
{/snippet}

{#snippet pdfIcon()}
	<FileText size={22} class="shrink-0 text-danger" aria-hidden="true" />
{/snippet}

<div class="card overflow-hidden">
	<div class="hidden border-b border-line py-2 pl-4 text-[0.8125rem] text-ink-3 sm:flex {manage ? 'pr-[3.25rem]' : 'pr-4'}">
		<span class="flex-1">Name</span>
		<span class="w-32">Hinzugefügt</span>
		<span class="w-24 text-right">Größe</span>
	</div>

	{#if data.search}
		<!-- Treffer aus allen Ordnern, jeweils mit ihrem Ort -->
		<ul>
			{#each data.search.folders as f (f.id)}
				<li class="row">
					<a href="/richtlinien?ordner={f.id}" class="row-link" draggable="false">
						{@render folderIcon()}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{f.name}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">in {f.place || 'Alle'}</span>
						</span>
					</a>
					{@render more({ kind: 'ordner', id: f.id, name: f.name })}
				</li>
			{/each}
			{#each data.search.documents as d (d.id)}
				<li class="row">
					<a href="/richtlinien/{d.id}" class="row-link" draggable="false">
						{@render pdfIcon()}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{d.title}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">in {d.place || 'Alle'} · {d.fileName}</span>
						</span>
						<span class="hidden w-32 shrink-0 text-sm text-ink-2 sm:block">{dateLabel(d.createdAt)}</span>
						<span class="num hidden w-24 shrink-0 text-right text-sm text-ink-2 sm:block">{fileSizeLabel(d.size)}</span>
					</a>
					{@render more({ kind: 'pdf', id: d.id, name: d.title })}
				</li>
			{/each}
		</ul>
		{#if !data.search.folders.length && !data.search.documents.length}
			<div class="p-10 text-center">
				<p class="font-medium">Nichts gefunden zu „{data.search.q}“</p>
				<p class="mt-1 text-sm text-ink-3">Gesucht wird in den Namen der Ordner und PDFs und in den Dateinamen.</p>
			</div>
		{/if}
	{:else}
		<ul>
			{#if data.folder}
				{@const parent = data.path.at(-2) ?? null}
				<li class="row" use:dropzone={{ accepts: ['eintrag'], onDrop: dropInto(parent?.id ?? null, parent?.name ?? 'Richtlinien & Vorschriften') }}>
					<a href={parent ? `/richtlinien?ordner=${parent.id}` : '/richtlinien'} class="row-link text-ink-2" draggable="false">
						<FolderUp size={22} class="shrink-0 text-ink-3" aria-hidden="true" />
						<span class="flex-1">Zurück zu „{parent?.name ?? 'Alle'}“</span>
					</a>
				</li>
			{/if}
			{#each data.folders as f (f.id)}
				{@const entry = { kind: 'ordner' as const, id: f.id, name: f.name }}
				<li
					class="row"
					use:draggable={{ kind: 'eintrag', data: entry, disabled: !data.canEdit }}
					use:dropzone={{ accepts: ['eintrag'], onDrop: dropInto(f.id, f.name) }}
				>
					<a href="/richtlinien?ordner={f.id}" class="row-link" draggable="false">
						{@render folderIcon()}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{f.name}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">{contentsLabel(f)}</span>
						</span>
						<span class="hidden w-32 shrink-0 text-sm text-ink-2 sm:block">{dateLabel(f.createdAt)}</span>
						<span class="hidden w-24 shrink-0 sm:block"></span>
					</a>
					{@render more({ ...entry, contents: { folders: f.folders, documents: f.documents } })}
				</li>
			{/each}
			{#each data.documents as d (d.id)}
				{@const entry = { kind: 'pdf' as const, id: d.id, name: d.title }}
				<li class="row" use:draggable={{ kind: 'eintrag', data: entry, disabled: !data.canEdit }}>
					<a href="/richtlinien/{d.id}" class="row-link" draggable="false">
						{@render pdfIcon()}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{d.title}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">
								{d.fileName}<span class="sm:hidden">{` · ${fileSizeLabel(d.size)} · ${dateLabel(d.createdAt)}`}</span>
							</span>
						</span>
						<span class="hidden w-32 shrink-0 text-sm text-ink-2 sm:block" title={d.uploadedBy ? `von ${d.uploadedBy}` : undefined}>{dateLabel(d.createdAt)}</span>
						<span class="num hidden w-24 shrink-0 text-right text-sm text-ink-2 sm:block">{fileSizeLabel(d.size)}</span>
					</a>
					{@render more(entry)}
				</li>
			{/each}
		</ul>
		{#if !data.folders.length && !data.documents.length}
			<div class="p-10 text-center">
				<p class="font-medium">{data.folder ? 'Der Ordner ist leer' : 'Noch keine Richtlinien'}</p>
				<p class="mt-1 text-sm text-ink-3">
					{#if data.canCreate}
						PDFs mit <span class="font-medium text-ink-2">PDF hochladen</span> hinzufügen oder einfach hierher ziehen{data.folder ? '' : ' – zum Ordnen vorher Ordner anlegen'}.
					{:else}
						Hier stehen bald Vorschriften und Anweisungen zum Nachlesen.
					{/if}
				</p>
			</div>
		{/if}
	{/if}
</div>

{#if data.canEdit && !data.search && (data.folders.length || data.documents.length)}
	<p class="mt-3 hidden text-sm text-ink-3 lg:block">Tipp: Ordner und PDFs lassen sich auf einen Ordner oder den Weg oben ziehen.</p>
{/if}

<!-- Beim Ziehen von Dateien über die Seite -->
{#if fileDrag > 0}
	<div class="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
		<div class="card flex flex-col items-center gap-2 border-2 border-dashed border-ink px-10 py-8 text-center">
			<Upload size={32} aria-hidden="true" />
			<p class="font-display text-lg font-semibold">PDFs hier ablegen</p>
			<p class="text-sm text-ink-2">Sie kommen in „{hereName}“ – den Namen legst du gleich fest.</p>
		</div>
	</div>
{/if}

<!-- Hochladen: jedem PDF einen Namen geben -->
<Dialog open={picked.length > 0} title={picked.length === 1 ? 'PDF hochladen' : `${picked.length} PDFs hochladen`} description="Nach „{hereName}“" wide onclose={closeUpload}>
	<form
		method="POST"
		action="?/upload"
		use:enhance={async ({ formData, cancel }) => {
			uploading = true;
			share = 0;
			uploadError = '';
			const total = picked.reduce((sum, p) => sum + p.file.size, 0) || 1;
			let done = 0;
			// Erst die Dateien in Teilen – ins Formular kommen nur die Kennungen
			try {
				for (const p of picked) {
					formData.append('uploads', await uploadPdf(p.file, (bytes) => (share = (done + bytes) / total)));
					done += p.file.size;
				}
			} catch (err) {
				uploading = false;
				uploadError = err instanceof UploadError ? err.message : 'Das Hochladen hat nicht geklappt – bitte noch einmal versuchen.';
				cancel();
				return;
			}
			return async ({ result, update }) => {
				uploading = false;
				if (result.type === 'success') {
					const n = Number(result.data?.added);
					toast.success(n === 1 ? 'PDF hochgeladen' : `${n} PDFs hochgeladen`);
					picked = [];
				}
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="ordner" value={here ?? ''} />
		<ul class="space-y-3">
			{#each picked as p, i (p.key)}
				<li class="rounded-xl border border-line p-3">
					<div class="flex items-end gap-2">
						<label class="min-w-0 flex-1">
							<span class="field-label">Name</span>
							<input class="input" name="titel" bind:value={p.title} required maxlength="120" disabled={uploading} />
						</label>
						{#if picked.length > 1}
							<button
								type="button"
								class="grid size-11 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-danger"
								aria-label="{p.file.name} weglassen"
								disabled={uploading}
								onclick={() => (picked = picked.filter((_, j) => j !== i))}
							>
								<X size={18} />
							</button>
						{/if}
					</div>
					<p class="mt-1.5 flex items-center gap-1.5 text-[0.8125rem] text-ink-3">
						<FileText size={14} class="shrink-0" aria-hidden="true" /><span class="truncate">{p.file.name}</span><span class="shrink-0">· {fileSizeLabel(p.file.size)}</span>
					</p>
				</li>
			{/each}
		</ul>
		{#if uploadError || (form && 'uploadError' in form && form.uploadError)}
			<p class="field-error mt-3" role="alert">{uploadError || form?.uploadError}</p>
		{/if}
		<div class="mt-5 flex flex-wrap items-center justify-between gap-2">
			<label class="btn btn-ghost btn-sm {uploading ? 'pointer-events-none opacity-50' : ''}">
				<Upload size={16} aria-hidden="true" />Weitere PDFs
				<input
					type="file"
					accept="application/pdf,.pdf"
					multiple
					class="sr-only"
					onchange={(e) => {
						pick(e.currentTarget.files);
						e.currentTarget.value = '';
					}}
				/>
			</label>
			<div class="flex gap-2">
				<button type="button" class="btn btn-ghost" disabled={uploading} onclick={closeUpload}>Abbrechen</button>
				<button class="btn btn-primary" disabled={uploading}>
					<Upload size={18} aria-hidden="true" />{uploading ? `Wird hochgeladen … ${Math.floor(share * 100)} %` : 'Hochladen'}
				</button>
			</div>
		</div>
	</form>
</Dialog>

<!-- Neuer Ordner im aktuellen Ordner -->
<Dialog bind:open={folderOpen} title="Neuer Ordner" description="In „{hereName}“">
	<form
		method="POST"
		action="?/newFolder"
		use:enhance={({ formElement }) => {
			folderBusy = true;
			return async ({ result, update }) => {
				folderBusy = false;
				if (result.type === 'success') {
					toast.success('Ordner angelegt');
					folderOpen = false;
					formElement.reset();
				}
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="ordner" value={here ?? ''} />
		<label class="block">
			<span class="field-label">Name</span>
			<input class="input" name="name" required maxlength="120" placeholder="z. B. Arbeitssicherheit" autocomplete="off" />
		</label>
		{#if form && 'folderError' in form && form.folderError}<p class="field-error mt-2" role="alert">{form.folderError}</p>{/if}
		<div class="mt-5 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (folderOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary" disabled={folderBusy}><FolderPlus size={18} aria-hidden="true" />Anlegen</button>
		</div>
	</form>
</Dialog>

<!-- ⋯ an einem Eintrag -->
<Dialog open={item !== null} title={item?.name ?? ''} description={item?.kind === 'ordner' ? 'Ordner' : 'PDF'} onclose={() => (item = null)}>
	{#if item}
		{#if !confirmDelete}
			{#if data.canEdit}
				<form method="POST" action="?/rename" use:enhance={itemSubmit(() => 'Umbenannt')}>
					<input type="hidden" name="art" value={item.kind} />
					<input type="hidden" name="id" value={item.id} />
					<label class="block">
						<span class="field-label">Name</span>
						<span class="flex gap-2">
							<input class="input min-w-0 flex-1" name="name" value={item.name} required maxlength="120" autocomplete="off" />
							<button class="btn btn-secondary shrink-0" disabled={busy}>Umbenennen</button>
						</span>
					</label>
				</form>
				<form method="POST" action="?/move" class="mt-4" use:enhance={itemSubmit((d) => (d?.moved ? `Verschoben nach „${d.moved}“` : 'Verschoben nach ganz oben'))}>
					<input type="hidden" name="art" value={item.kind} />
					<input type="hidden" name="id" value={item.id} />
					<label class="block">
						<span class="field-label">Verschieben nach</span>
						<span class="flex gap-2">
							<select class="input min-w-0 flex-1" name="ziel">
								<option value="" selected={currentPlace == null}>Ganz oben (Alle)</option>
								{#each targets as t (t.id)}
									<option value={t.id} selected={t.id === currentPlace}>{t.path}</option>
								{/each}
							</select>
							<button class="btn btn-secondary shrink-0" disabled={busy}>Verschieben</button>
						</span>
					</label>
				</form>
			{/if}
			{#if data.canDelete}
				<div class="mt-5 flex justify-end border-t border-line pt-4">
					<button type="button" class="btn btn-ghost text-danger" onclick={() => (confirmDelete = true)}>
						<Trash size={18} aria-hidden="true" />{item.kind === 'ordner' ? 'Ordner löschen' : 'PDF löschen'}
					</button>
				</div>
			{/if}
		{:else}
			<p class="text-ink-2">
				{#if item.kind === 'ordner'}
					Der Ordner „{item.name}“ wird gelöscht{item.contents && (item.contents.folders || item.contents.documents)
						? ` – samt allem, was darin liegt (${contentsLabel(item.contents)})`
						: ''}.
				{:else}
					„{item.name}“ wird gelöscht.
				{/if}
			</p>
			<form
				method="POST"
				action="?/delete"
				class="mt-5 flex justify-end gap-2"
				use:enhance={itemSubmit((d) => (d?.deleted === 'ordner' ? 'Ordner gelöscht' : 'PDF gelöscht'))}
			>
				<input type="hidden" name="art" value={item.kind} />
				<input type="hidden" name="id" value={item.id} />
				<button type="button" class="btn btn-ghost" onclick={() => (confirmDelete = false)}>Zurück</button>
				<button class="btn btn-danger" disabled={busy}><Trash size={18} aria-hidden="true" />Löschen</button>
			</form>
		{/if}
	{/if}
</Dialog>

<style>
	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		max-width: 16rem;
		border-radius: 0.5rem;
		padding: 0.375rem 0.5rem;
	}
	a.crumb {
		color: var(--c-ink-2);
	}
	a.crumb:hover {
		background: var(--c-surface-2);
		color: var(--c-ink);
	}
	.row {
		display: flex;
		align-items: center;
		border-bottom: 1px solid var(--c-line);
		-webkit-touch-callout: none;
	}
	.row:last-child {
		border-bottom: 0;
	}
	.row-link {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 1rem;
		min-height: 3.5rem;
	}
	.row:hover {
		background: var(--c-surface-2);
	}
	/* Der Knopf ist ein Label um das Dateifeld – den Fokus zeigt er selbst */
	.upload:has(input:focus-visible) {
		outline: 2px solid var(--c-focus);
		outline-offset: 2px;
	}
</style>
