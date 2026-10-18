<script lang="ts">
	import { pageTitle } from '$lib/app';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import HardHat from '@lucide/svelte/icons/hard-hat';
	import WorkOrderCreateForm from '$lib/modules/auftraege/components/WorkOrderCreateForm.svelte';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();
</script>

<svelte:head><title>{pageTitle(`Auftrag erstellen – ${spacedNumber(data.offer.number)}`)}</title></svelte:head>

<a href="/angebote/{data.offer.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Angebot {spacedNumber(data.offer.number)}
</a>

<div class="mt-3 mb-5">
	<h1 class="text-[2rem] leading-tight">Auftrag und Arbeitsauftrag erstellen</h1>
	<p class="text-ink-2">Nr. {spacedNumber(data.offer.number)} · {data.offer.title || 'Ohne BV'}</p>
</div>

<p class="card mb-4 flex items-start gap-3 p-4 text-sm text-ink-2">
	<HardHat size={18} class="mt-0.5 shrink-0" aria-hidden="true" />
	<span>
		Der Auftrag bekommt die Nummer {spacedNumber(data.offer.number)}, die Anschrift und alle Positionen – ohne Preise. Gleichzeitig entsteht der
		Arbeitsauftrag: Nur ihn sieht die Partie, sobald sie zugeteilt ist. Beilagen, Evaluierung und Rückseite sind vom letzten Arbeitsauftrag
		übernommen, Art, RAL und MSK aus den Positionen erkannt.
	</span>
</p>

<WorkOrderCreateForm
	content={data.content}
	colors={data.colors}
	me={data.me}
	submitLabel="Auftrag erstellen"
	uploadField="plaene"
	message={form && 'message' in form ? String(form.message ?? '') : ''}
	cancelHref="/angebote/{data.offer.id}"
>
	{#snippet extra(markPlans)}
		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">Auftrag</h2>
			<div class="mt-3 grid gap-3 sm:grid-cols-2">
				<label class="block">
					<span class="field-label">Partie</span>
					<select class="select" name="partie">
						<option value="">Noch keine – später zuteilen</option>
						{#each data.parties as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				</label>
				<label class="block">
					<span class="field-label">Pläne und Unterlagen <span class="font-normal text-ink-3">(PDF, freiwillig)</span></span>
					<input class="input py-2" type="file" name="plaene" accept="application/pdf,.pdf" multiple onchange={(e) => e.currentTarget.files?.length && markPlans()} />
				</label>
				<label class="block sm:col-span-2">
					<span class="field-label">Hinweis für die Partie</span>
					<textarea class="textarea" name="hinweis" rows="2" maxlength="2000" placeholder="z. B. Zufahrt über Tor 3, Ansprechpartner vor Ort …"></textarea>
				</label>
			</div>
		</section>
	{/snippet}
</WorkOrderCreateForm>
