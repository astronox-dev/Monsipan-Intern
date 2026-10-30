<script lang="ts">
	import { pageTitle } from '$lib/app';
	import Download from '@lucide/svelte/icons/download';
	import Printer from '@lucide/svelte/icons/printer';
	import FileText from '@lucide/svelte/icons/file-text';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import { printPage } from '$lib/native';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ProductAvatar from '$lib/modules/lager/components/ProductAvatar.svelte';
	import { amountLabel, date, int, packageLabel } from '$lib/format';

	let { data } = $props();

	// Bestellmengen lassen sich vor dem Export/Druck anpassen
	let qty = $state<Record<number, number>>({});
	let excluded = $state<Record<number, boolean>>({});
	$effect(() => {
		for (const p of data.items) if (qty[p.id] === undefined) qty[p.id] = p.suggested;
	});

	const groups = $derived.by(() => {
		const map = new Map<string, typeof data.items>();
		for (const p of data.items) {
			const k = p.manufacturer || 'Ohne Hersteller';
			map.set(k, [...(map.get(k) ?? []), p]);
		}
		return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'de'));
	});

	/** Die auf der Seite eingestellten Mengen wandern in den Export mit */
	const exportQuery = $derived(
		new URLSearchParams(
			data.items.filter((p) => !excluded[p.id]).map((p) => ['m', `${p.id}:${qty[p.id] ?? p.suggested}`])
		).toString()
	);
	const exportHref = $derived(`/export/bestellliste.csv?${exportQuery}`);
	const pdfHref = $derived(`/export/bestellliste.pdf?${exportQuery}`);
</script>

<svelte:head><title>{pageTitle('Bestellliste')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="text-[2rem] leading-tight">Bestellliste</h1>
		<p class="text-ink-2">
			{data.items.length === 0 ? 'Nichts nachzubestellen' : `${data.items.length} Artikel am Mindestbestand`}<span class="hidden print:inline">, Stand {date(new Date())}</span>
		</p>
	</div>
	{#if data.items.length}
		<div class="no-print flex flex-wrap gap-2">
			<button class="btn btn-secondary" onclick={printPage}><Printer size={18} aria-hidden="true" />Drucken</button>
			<PdfButton href={pdfHref}><FileText size={18} aria-hidden="true" />Als PDF</PdfButton>
			<a href={exportHref} class="btn btn-primary" download><Download size={18} aria-hidden="true" />Als CSV</a>
		</div>
	{/if}
</div>

{#if data.items.length === 0}
	<div class="card flex flex-col items-center px-6 py-16 text-center">
		<span class="grid size-14 place-items-center rounded-2xl bg-ok-soft text-ok"><CircleCheck size={28} aria-hidden="true" /></span>
		<p class="mt-4 text-lg font-medium">Alles ausreichend auf Lager</p>
		<p class="mt-1 max-w-md text-ink-3">Sobald ein Artikel seinen Mindestbestand erreicht, erscheint er hier mit einem Bestellvorschlag.</p>
	</div>
{:else}
	<p class="no-print mb-3 text-sm text-ink-3">Vorschlag = bis zum Sollbestand auffüllen (ohne Sollbestand: doppelter Mindestbestand). Mengen und Auswahl gelten für Druck und Export.</p>
	<div class="space-y-4">
		{#each groups as [manufacturer, items] (manufacturer)}
			<section class="card overflow-hidden" aria-label={manufacturer}>
				<h2 class="border-b border-line bg-surface-2 px-4 py-3 text-lg lg:px-6">{manufacturer}</h2>
				<div class="overflow-x-auto">
					<table class="data-table">
						<thead>
							<tr>
								<th class="no-print w-10"><span class="sr-only">Bestellen</span></th>
								<th>Artikel</th>
								<th class="text-right">Bestand</th>
								<th class="text-right">Mindest</th>
								<th class="text-right">Soll</th>
								<th class="text-right">Bestellen (Stück)</th>
							</tr>
						</thead>
						<tbody>
							{#each items as p (p.id)}
								<tr class={excluded[p.id] ? 'opacity-45 print:hidden' : ''}>
									<td class="no-print">
										<input
											type="checkbox"
											class="size-5 accent-[var(--c-ink)]"
											checked={!excluded[p.id]}
											aria-label="{p.name} bestellen"
											onchange={(e) => (excluded[p.id] = !e.currentTarget.checked)}
										/>
									</td>
									<td>
										<a href="/lager/artikel/{p.id}" class="flex items-center gap-3 hover:underline">
											<ProductAvatar colorHex={p.colorHex} category={p.categoryName} size="sm" />
											<span class="min-w-0">
												<span class="block font-medium">{p.name}</span>
												<span class="block text-sm text-ink-3">{[p.articleNumber && `Art.-Nr. ${p.articleNumber}`, packageLabel(p.packageSize, p.unit)].filter(Boolean).join(', ')}</span>
											</span>
										</a>
									</td>
									<td class="num text-right font-semibold {p.total <= 0 ? 'text-danger' : 'text-warn'}">{int(p.total)}</td>
									<td class="num text-right text-ink-2">{p.minStock}</td>
									<td class="num text-right text-ink-2">{p.targetStock ?? '–'}</td>
									<td class="text-right">
										<input
											class="input num ml-auto w-24 text-right print:border-0 print:p-0"
											inputmode="numeric"
											aria-label="Bestellmenge {p.name}"
											value={qty[p.id] ?? p.suggested}
											oninput={(e) => {
												const n = Number(e.currentTarget.value.replace(/\D/g, ''));
												qty[p.id] = Number.isFinite(n) ? n : 0;
											}}
										/>
										{#if amountLabel(qty[p.id] ?? p.suggested, p.packageSize, p.unit)}
											<span class="mt-1 block text-[0.8125rem] text-ink-3">{amountLabel(qty[p.id] ?? p.suggested, p.packageSize, p.unit)}</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/each}
	</div>
{/if}
