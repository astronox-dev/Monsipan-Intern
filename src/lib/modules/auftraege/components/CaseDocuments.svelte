<script lang="ts">
	/**
	 * Pläne und Unterlagen zum ganzen Vorgang – an Anfrage, Angebot und Auftrag
	 * dieselbe Liste (siehe server/case-files.ts). Jedes PDF zeigt, woher es
	 * kommt, und ob es die Partie beim Auftrag sieht. Die Seite braucht die
	 * Aktionen ?/docUpload (Felder „uploads", „partie"), ?/docDelete und ?/docCrew
	 * (Feld „dokument" = „i12", „a12" oder „o12", bei docCrew dazu „an").
	 */
	import { enhance } from '$app/forms';
	import FileText from '@lucide/svelte/icons/file-text';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Upload from '@lucide/svelte/icons/upload';
	import X from '@lucide/svelte/icons/x';
	import Dialog from '$lib/components/Dialog.svelte';
	import { fileSizeLabel } from '$lib/documents';
	import { uploadFormPdfs, UploadError } from '$lib/upload';
	import { toast } from '$lib/stores/toast.svelte';

	type Source = 'anfrage' | 'angebot' | 'auftrag';
	const FROM: Record<Source, string> = { anfrage: 'aus der Anfrage', angebot: 'vom Angebot', auftrag: 'vom Auftrag' };

	interface Props {
		documents: { ref: string; source: Source; title: string; fileName: string; size: number; forCrew: boolean }[];
		/** Die Seite, auf der die Liste steht – ihre eigenen PDFs bekommen keinen Herkunftshinweis */
		here: Source;
		/** Adresse der Unterlagen, z. B. /angebote/12/unterlagen */
		hrefBase: string;
		canManage: boolean;
		/** „Partie" / „Nur Büro" zeigen und umschalten */
		crew?: boolean;
		/** Vorauswahl beim Hochladen: auch für die Partie */
		crewDefault?: boolean;
		title?: string;
		/** Zeile unter der Überschrift – ohne Angabe der Hinweis auf den ganzen Vorgang */
		hint?: string;
		/** Fehler aus der letzten Aktion */
		message?: string;
	}
	let { documents, here, hrefBase, canManage, crew = true, crewDefault = false, title = 'Pläne und Unterlagen', hint, message = '' }: Props = $props();

	let uploading = $state(false);
	let share = $state(0);
	let uploadError = $state('');
	let remove = $state<{ ref: string; title: string } | null>(null);
</script>

<section class="card mt-4 p-4 lg:p-5">
	<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
		<div class="min-w-0 flex-1">
			<h2 class="flex items-center gap-2 text-lg">
				<FileText size={18} aria-hidden="true" />{title}{#if documents.length}<span class="num text-sm font-normal text-ink-3">{documents.length}</span>{/if}
			</h2>
			<p class="text-sm text-ink-2">
				{#if hint}{hint}{:else}
					Gehören zum ganzen Vorgang – an Anfrage, Angebot und Auftrag stehen dieselben.{#if crew}{' '}Mit
						<span class="font-medium text-ink">Partie</span> sieht sie auch die Partie beim Auftrag.{/if}
				{/if}
			</p>
		</div>
		{#if canManage}
			<form
				method="POST"
				action="?/docUpload"
				enctype="multipart/form-data"
				class="flex flex-wrap items-center gap-3"
				use:enhance={async ({ formData, formElement, cancel }) => {
					uploading = true;
					share = 0;
					uploadError = '';
					// Große PDFs in Teilen vorab – ins Formular kommen nur noch die Kennungen
					try {
						await uploadFormPdfs(formData, 'dateien', (s) => (share = s));
					} catch (err) {
						uploading = false;
						uploadError = err instanceof UploadError ? err.message : 'Das Hochladen hat nicht geklappt – bitte noch einmal versuchen.';
						formElement.reset();
						cancel();
						return;
					}
					return async ({ result, update }) => {
						uploading = false;
						if (result.type === 'success') toast.success(Number(result.data?.added) === 1 ? 'PDF hochgeladen' : `${result.data?.added} PDFs hochgeladen`);
						await update();
					};
				}}
			>
				{#if crew && here !== 'auftrag'}
					<label class="flex items-center gap-2 text-sm" title="Erscheint auch beim Auftrag – die Partie sieht es">
						<input type="checkbox" name="partie" class="size-4 accent-current" checked={crewDefault} />
						für die Partie
					</label>
				{/if}
				<label class="upload btn btn-secondary btn-sm {uploading ? 'pointer-events-none opacity-50' : ''}">
					<Upload size={16} aria-hidden="true" />{uploading ? `Wird hochgeladen … ${Math.floor(share * 100)} %` : 'PDF hochladen'}
					<input
						type="file"
						name="dateien"
						accept="application/pdf,.pdf"
						multiple
						class="sr-only"
						onchange={(e) => e.currentTarget.files?.length && e.currentTarget.form?.requestSubmit()}
					/>
				</label>
			</form>
		{/if}
	</div>
	{#if uploadError || message}<p class="field-error mt-2" role="alert">{uploadError || message}</p>{/if}
	{#if documents.length}
		<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
			{#each documents as d (d.ref)}
				<li class="flex items-center gap-2">
					<a href="{hrefBase}/{d.ref}" class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
						<FileText size={20} class="shrink-0 text-ink-3" aria-hidden="true" />
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{d.title}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">
								{d.fileName} · {fileSizeLabel(d.size)}{#if d.source !== here}<span class="font-medium text-ink-2">{` · ${FROM[d.source]}`}</span>{/if}
							</span>
						</span>
						<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
					</a>
					{#if crew}
						{#if canManage && d.source !== 'auftrag'}
							<form
								method="POST"
								action="?/docCrew"
								use:enhance={() => async ({ result, update }) => {
									if (result.type === 'success') toast.success(result.data?.forCrew ? 'Die Partie sieht es jetzt beim Auftrag' : 'Nur noch fürs Büro');
									await update({ reset: false });
								}}
							>
								<input type="hidden" name="dokument" value={d.ref} />
								<input type="hidden" name="an" value={d.forCrew ? '0' : '1'} />
								<button
									class="badge {d.forCrew ? 'badge-info' : ''} cursor-pointer"
									title={d.forCrew ? 'Die Partie sieht es beim Auftrag – klicken für nur Büro' : 'Nur fürs Büro – klicken, damit es die Partie beim Auftrag sieht'}
								>
									{d.forCrew ? 'Partie' : 'Nur Büro'}
								</button>
							</form>
						{:else}
							<span class="badge {canManage ? '' : 'mr-3'} {d.forCrew ? 'badge-info' : ''}">{d.forCrew ? 'Partie' : 'Nur Büro'}</span>
						{/if}
					{/if}
					{#if canManage}
						<button
							type="button"
							class="mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-danger"
							aria-label="{d.title} entfernen"
							onclick={() => (remove = d)}
						>
							<X size={16} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-ink-3">{canManage ? 'Noch keine PDFs – Pläne, Leistungsverzeichnis, Ausschreibung; auch große gehen.' : 'Keine Unterlagen.'}</p>
	{/if}
</section>

<Dialog open={remove !== null} title="„{remove?.title}“ entfernen?" onclose={() => (remove = null)}>
	<p class="text-ink-2">Das PDF wird aus dem ganzen Vorgang entfernt – an Anfrage, Angebot und Auftrag.</p>
	<form
		method="POST"
		action="?/docDelete"
		class="mt-5 flex justify-end gap-2"
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') {
				toast.info('PDF entfernt');
				remove = null;
			}
			await update({ reset: false });
		}}
	>
		<input type="hidden" name="dokument" value={remove?.ref ?? ''} />
		<button type="button" class="btn btn-ghost" onclick={() => (remove = null)}>Abbrechen</button>
		<button class="btn btn-primary">Entfernen</button>
	</form>
</Dialog>

<style>
	/* Der Knopf ist ein Label um das Dateifeld – den Fokus zeigt er selbst */
	.upload:has(input:focus-visible) {
		outline: 2px solid var(--c-focus);
		outline-offset: 2px;
	}
</style>
