<script lang="ts">
	/**
	 * PDFs an einem Datensatz (z. B. der Anfrage): hochladen ohne Größengrenze
	 * (in Teilen vorab, siehe $lib/upload), ansehen, entfernen. Die Seite braucht
	 * dafür die Aktionen ?/docUpload (Feld „uploads“) und ?/docDelete (Feld „dokument“).
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

	interface Props {
		documents: { id: number; title: string; fileName: string; size: number }[];
		/** Adresse der Unterlagen, z. B. /anfragen/12/unterlagen */
		hrefBase: string;
		canManage: boolean;
		title?: string;
		hint?: string;
		/** Fehler aus der letzten Aktion */
		message?: string;
	}
	let { documents, hrefBase, canManage, title = 'Unterlagen', hint = '', message = '' }: Props = $props();

	let uploading = $state(false);
	let share = $state(0);
	let uploadError = $state('');
	let remove = $state<{ id: number; title: string } | null>(null);
</script>

<section class="card mt-4 p-4 lg:p-5">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<h2 class="flex items-center gap-2 text-lg"><FileText size={18} aria-hidden="true" />{title}</h2>
			{#if hint}<p class="text-sm text-ink-2">{hint}</p>{/if}
		</div>
		{#if canManage}
			<form
				method="POST"
				action="?/docUpload"
				enctype="multipart/form-data"
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
			{#each documents as d (d.id)}
				<li class="flex items-center gap-2">
					<a href="{hrefBase}/{d.id}" class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
						<FileText size={20} class="shrink-0 text-ink-3" aria-hidden="true" />
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{d.title}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">{d.fileName} · {fileSizeLabel(d.size)}</span>
						</span>
						<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
					</a>
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
		<p class="mt-2 text-sm text-ink-3">{canManage ? 'Noch keine PDFs – auch große Pläne gehen.' : 'Keine PDFs.'}</p>
	{/if}
</section>

<Dialog open={remove !== null} title="„{remove?.title}“ entfernen?" onclose={() => (remove = null)}>
	<p class="text-ink-2">Das PDF wird entfernt.</p>
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
		<input type="hidden" name="dokument" value={remove?.id ?? ''} />
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
