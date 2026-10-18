<script lang="ts">
	/**
	 * Vorab-Formular des Arbeitsauftrags – am Angebot zusammen mit dem Auftrag,
	 * am Auftrag allein. Was oben dazukommt (Partie, Hinweis, Pläne), reicht die
	 * Seite als `extra` herein; Pläne werden vorab in Teilen hochgeladen.
	 */
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Signature from '@lucide/svelte/icons/signature';
	import Dialog from '$lib/components/Dialog.svelte';
	import SignaturePad from '$lib/modules/stunden/components/SignaturePad.svelte';
	import { uploadFormPdfs, UploadError } from '$lib/upload';
	import WorkOrderHead from './WorkOrderHead.svelte';
	import WorkOrderBack from './WorkOrderBack.svelte';
	import { quantityLabel } from '../offer';
	import { MARKING_KINDS, type WorkOrderContent } from '../work-order';

	interface Props {
		content: WorkOrderContent;
		colors: { ral: string; name: string }[];
		/** Name für die Unterschrift BL */
		me: string;
		submitLabel: string;
		/** Feld mit Plänen, die vorab hochgeladen werden */
		uploadField?: string;
		message?: string;
		/** Weitere Felder oben im Formular; markPlans hakt „Pläne" bei den Beilagen an */
		extra?: Snippet<[() => void]>;
		cancelHref: string;
	}
	let { content, colors, me, submitLabel, uploadField, message = '', extra, cancelHref }: Props = $props();

	// Vorbelegt – das Formular gehört ab jetzt der Seite
	// svelte-ignore state_referenced_locally
	const { signatures: _s, briefings: _b, foil: _f, ...start } = structuredClone(content);
	let f = $state(start);

	let busy = $state(false);
	let share = $state<number | null>(null);
	let uploadError = $state('');
	let signOpen = $state(false);
	let signName = $state('');
	let signPath = $state('');

	function openSign() {
		signName = me;
		signPath = '';
		signOpen = true;
	}

	/** Eine Folien-Leistung verlangt das 3M-Protokoll – solange noch niemand entschieden hat */
	function kindChanged(kind: string) {
		if (/folie/i.test(kind) && f.foilProtocol === '') f.foilProtocol = 'ja';
	}
</script>

{#if uploadError}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{uploadError}</p>
{:else if message}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{message}</p>{/if}

<form
	id="aa-neu"
	method="POST"
	enctype="multipart/form-data"
	use:enhance={async ({ formData, cancel }) => {
		busy = true;
		uploadError = '';
		if (uploadField) {
			// Pläne in Teilen vorab – ohne Größengrenze; ist eine kein PDF, entsteht nichts
			try {
				share = 0;
				await uploadFormPdfs(formData, uploadField, (s) => (share = s));
			} catch (err) {
				uploadError = err instanceof UploadError ? err.message : 'Das Hochladen hat nicht geklappt – bitte noch einmal versuchen.';
				busy = false;
				signOpen = false;
				cancel();
				return;
			} finally {
				share = null;
			}
		}
		return async ({ update }) => {
			busy = false;
			await update({ reset: false });
		};
	}}
>
	<input type="hidden" name="inhalt" value={JSON.stringify(f)} />
	{#if signOpen}
		<input type="hidden" name="bl_name" value={signName} />
		<input type="hidden" name="bl_unterschrift" value={signPath} />
	{/if}

	<div class="space-y-4">
		{@render extra?.(() => (f.attachments.plans = true))}

		<WorkOrderHead bind:form={f} />

		<section class="card overflow-hidden">
			<div class="px-4 pt-4 lg:px-5">
				<h2 class="text-lg">Beschreibung der Leistung</h2>
				<p class="mt-0.5 text-sm text-ink-3">Aus den Positionen – Art, RAL-Farbton und MSK sind aus dem Text erkannt, bitte prüfen.</p>
			</div>
			<div class="mt-3 lg:overflow-x-auto">
				<div class="hidden min-w-[46rem] gap-1.5 border-y border-line px-4 py-2 text-[0.75rem] text-ink-3 lg:grid lg:grid-cols-[minmax(12rem,1fr)_7rem_9rem_9rem_6rem] lg:px-5">
					<span>Leistung</span><span class="text-right">Ca. Menge</span><span>Art der Markierung</span><span>RAL Farbton</span><span>MSK</span>
				</div>
				{#each f.lines as l, i (i)}
					<div class="grid grid-cols-3 gap-2 border-b border-line px-4 py-3 last:border-0 lg:min-w-[46rem] lg:grid-cols-[minmax(12rem,1fr)_7rem_9rem_9rem_6rem] lg:items-center lg:gap-1.5 lg:px-5 lg:py-2">
						<p class="col-span-2 font-medium lg:col-span-1">{l.text}</p>
						<p class="num text-right text-ink-2">{quantityLabel(l.quantity)} {l.unit}</p>
						<label class="block">
							<span class="field-label lg:sr-only">Art der Markierung</span>
							<input class="input input-sm" maxlength="60" list="aa-arten" bind:value={l.kind} oninput={() => kindChanged(l.kind)} />
						</label>
						<label class="block">
							<span class="field-label lg:sr-only">RAL Farbton</span>
							<input class="input input-sm" maxlength="40" list="aa-ral" bind:value={l.ral} />
						</label>
						<label class="block">
							<span class="field-label lg:sr-only">MSK</span>
							<input class="input input-sm" maxlength="30" bind:value={l.msk} />
						</label>
					</div>
				{:else}
					<p class="px-4 pb-4 text-sm text-ink-3 lg:px-5">Keine Positionen.</p>
				{/each}
			</div>
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">Folienverlegeprotokoll</h2>
			<p class="mt-0.5 text-sm text-ink-3">Mit „ja“ füllt die Partie im Arbeitsauftrag das 3M-Verlegeprotokoll aus – bei Folie steht es schon auf „ja“.</p>
			<div class="mt-3 flex gap-5">
				<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="ja" bind:group={f.foilProtocol} />ja</label>
				<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="nein" bind:group={f.foilProtocol} />nein</label>
				<label class="flex items-center gap-2 text-ink-3"><input type="radio" class="accent-[var(--c-ink)]" value="" bind:group={f.foilProtocol} />offen</label>
			</div>
		</section>

		<WorkOrderBack bind:form={f} />
	</div>

	<div class="card sticky bottom-24 mt-4 flex flex-wrap items-center gap-2 p-3 lg:bottom-6">
		<button class="btn btn-primary" disabled={busy}>
			<ClipboardList size={18} aria-hidden="true" />{share !== null ? `Pläne hochladen … ${Math.floor(share * 100)} %` : busy ? 'Wird erstellt …' : submitLabel}
		</button>
		<button type="button" class="btn btn-secondary" disabled={busy} onclick={openSign}>
			<Signature size={18} aria-hidden="true" />… und als BL unterschreiben
		</button>
		<a href={cancelHref} class="btn btn-ghost">Abbrechen</a>
	</div>
</form>

<datalist id="aa-ral">{#each colors as c (`${c.ral} ${c.name}`)}<option value={c.ral}>{c.name}</option>{/each}</datalist>
<datalist id="aa-arten">{#each MARKING_KINDS as a (a)}<option value={a}></option>{/each}</datalist>

<Dialog bind:open={signOpen} title="Erstellen und als BL unterschreiben">
	<p class="text-ink-2">Die Unterschrift steht im Arbeitsauftrag bei „Unterschrift BL“, mit dem heutigen Datum.</p>
	<label class="mt-4 block">
		<span class="field-label">Name</span>
		<input class="input" maxlength="120" autocomplete="off" bind:value={signName} />
	</label>
	<div class="mt-3"><SignaturePad bind:path={signPath} /></div>
	<div class="mt-4 flex flex-wrap justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (signOpen = false)}>Abbrechen</button>
		<button type="submit" form="aa-neu" class="btn btn-primary" disabled={busy || !signPath || signName.trim().length < 2}>
			<Signature size={18} aria-hidden="true" />{submitLabel} und unterschreiben
		</button>
	</div>
</Dialog>
