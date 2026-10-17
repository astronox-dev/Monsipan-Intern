<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import WorkOrderHead from '$lib/modules/auftraege/components/WorkOrderHead.svelte';
	import WorkOrderBack from '$lib/modules/auftraege/components/WorkOrderBack.svelte';
	import { quantityLabel, spacedNumber } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();

	// Vorbelegt aus dem Auftrag – das Formular gehört ab jetzt der Seite
	// svelte-ignore state_referenced_locally
	const { signatures: _s, briefings: _b, foil: _f, ...start } = structuredClone(data.content);
	let f = $state(start);
	let busy = $state(false);
</script>

<svelte:head><title>{pageTitle(`Arbeitsauftrag erstellen – ${spacedNumber(data.order.number)}`)}</title></svelte:head>

<a href="/auftraege/{data.order.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Auftrag {spacedNumber(data.order.number)}
</a>

<div class="mt-3 mb-5">
	<h1 class="text-[2rem] leading-tight">Arbeitsauftrag erstellen</h1>
	<p class="text-ink-2">Nr. {spacedNumber(data.order.number)} · {data.order.title || 'Ohne BV'}{data.order.partyName ? ` · ${data.order.partyName}` : ''}</p>
</div>

<p class="card mb-4 flex items-start gap-3 p-4 text-sm text-ink-2">
	<ClipboardList size={18} class="mt-0.5 shrink-0" aria-hidden="true" />
	<span>
		Vor dem Erstellen ausfüllen – danach stehen die Leistungen fest. Die Partie sieht dann nicht den ganzen Auftrag, sondern nur diesen
		Arbeitsauftrag{data.order.partyName ? '' : ', sobald der Auftrag einer Partie zugeteilt ist'}.
	</span>
</p>

{#if form && 'message' in form && form.message}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>{/if}

<form
	method="POST"
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			busy = false;
			await update({ reset: false });
		};
	}}
>
	<input type="hidden" name="inhalt" value={JSON.stringify(f)} />
	<div class="space-y-4">
		<WorkOrderHead bind:form={f} />

		<section class="card overflow-hidden">
			<div class="px-4 pt-4 lg:px-5">
				<h2 class="text-lg">Beschreibung der Leistung</h2>
				<p class="mt-0.5 text-sm text-ink-3">Aus den Positionen des Auftrags – dazu Art der Markierung, RAL-Farbton und MSK.</p>
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
							<input class="input input-sm" maxlength="60" list="aa-arten" bind:value={l.kind} />
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
					<p class="px-4 pb-4 text-sm text-ink-3 lg:px-5">Der Auftrag hat keine Positionen.</p>
				{/each}
			</div>
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">Folienverlegeprotokoll</h2>
			<p class="mt-0.5 text-sm text-ink-3">Mit „ja“ füllt die Partie das 3M-Verlegeprotokoll aus.</p>
			<div class="mt-3 flex gap-5">
				<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="ja" bind:group={f.foilProtocol} />ja</label>
				<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="nein" bind:group={f.foilProtocol} />nein</label>
				<label class="flex items-center gap-2 text-ink-3"><input type="radio" class="accent-[var(--c-ink)]" value="" bind:group={f.foilProtocol} />offen</label>
			</div>
		</section>

		<WorkOrderBack bind:form={f} />
	</div>

	<div class="card sticky bottom-24 mt-4 flex flex-wrap items-center gap-2 p-3 lg:bottom-6">
		<button class="btn btn-primary" disabled={busy}><ClipboardList size={18} aria-hidden="true" />{busy ? 'Wird erstellt …' : 'Arbeitsauftrag erstellen'}</button>
		<a href="/auftraege/{data.order.id}" class="btn btn-ghost">Abbrechen</a>
	</div>
</form>

<datalist id="aa-ral">{#each data.colors as c (`${c.ral} ${c.name}`)}<option value={c.ral}>{c.name}</option>{/each}</datalist>
<datalist id="aa-arten">
	{#each ['Farbe', 'Kaltplastik', 'Heißplastik', 'Folie', 'Agglomerat'] as a (a)}<option value={a}></option>{/each}
</datalist>
