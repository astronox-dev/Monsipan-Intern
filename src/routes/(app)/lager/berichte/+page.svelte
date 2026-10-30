<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Download from '@lucide/svelte/icons/download';
	import Printer from '@lucide/svelte/icons/printer';
	import FileText from '@lucide/svelte/icons/file-text';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import { printPage } from '$lib/native';
	import BarChart from '$lib/components/BarChart.svelte';
	import ProductAvatar from '$lib/modules/lager/components/ProductAvatar.svelte';
	import { amountLabel, date, int, monthLong, monthShort, packageLabel } from '$lib/format';
	import { withParams } from '$lib/url';

	let { data } = $props();

	const tabs = [
		{ value: 'verbrauch', label: 'Verbrauch pro Monat' },
		{ value: 'bestand', label: 'Bestandsliste' }
	];

	function nav(patch: Record<string, string | number | null>) {
		goto(withParams(page.url, patch), { keepFocus: true, noScroll: true, replaceState: true });
	}

	const chartData = $derived(
		data.view === 'verbrauch'
			? data.totals!.map((c, i, all) => ({
					key: c.month,
					label: monthShort(c.month),
					longLabel: monthLong(c.month),
					value: c.qty,
					partial: i === all.length - 1
				}))
			: []
	);
	const sum = $derived(data.view === 'verbrauch' ? data.totals!.reduce((s, c) => s + c.qty, 0) : 0);
</script>

<svelte:head><title>{pageTitle('Berichte')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="text-[2rem] leading-tight">Berichte</h1>
		<p class="text-ink-2">
			{data.view === 'bestand' ? `Bestand je Lagerort, Stand ${date(data.stand)}` : 'Verbrauch = Ausgaben minus Rückgaben, ohne Stornos'}
		</p>
	</div>
	<div class="no-print flex flex-wrap gap-2">
		<button class="btn btn-secondary" onclick={printPage}><Printer size={18} aria-hidden="true" />Drucken</button>
		<PdfButton href={data.view === 'bestand' ? '/export/bestand.pdf?status=alle' : `/export/verbrauch.pdf${page.url.search}`}>
			<FileText size={18} aria-hidden="true" />Als PDF
		</PdfButton>
		<a
			class="btn btn-primary"
			download
			href={data.view === 'bestand' ? '/export/bestand.csv?status=alle' : `/export/verbrauch.csv${page.url.search}`}
		>
			<Download size={18} aria-hidden="true" />Als CSV
		</a>
	</div>
</div>

<div class="no-print mb-4 inline-flex gap-1 rounded-2xl border border-line bg-surface p-1" role="tablist" aria-label="Bericht">
	{#each tabs as t (t.value)}
		<a
			role="tab"
			aria-selected={data.view === t.value}
			href={withParams(page.url, { ansicht: t.value === 'verbrauch' ? null : t.value, monate: null, kat: null, partie: null })}
			class="flex h-10 items-center rounded-xl px-4 text-[0.9375rem] font-medium transition-colors {data.view === t.value
				? 'bg-ink text-surface'
				: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
		>
			{t.label}
		</a>
	{/each}
</div>

{#if data.view === 'verbrauch'}
	<div class="no-print mb-4 grid gap-2 sm:grid-cols-3">
		<select class="select" aria-label="Zeitraum" value={String(data.months)} onchange={(e) => nav({ monate: e.currentTarget.value === '12' ? null : e.currentTarget.value })}>
			<option value="6">Letzte 6 Monate</option>
			<option value="12">Letzte 12 Monate</option>
			<option value="24">Letzte 24 Monate</option>
		</select>
		<select class="select" aria-label="Materialart" value={data.categoryId ?? ''} onchange={(e) => nav({ kat: e.currentTarget.value || null })}>
			<option value="">Alle Materialarten</option>
			{#each data.categories! as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
		</select>
		<select class="select" aria-label="Partie" value={data.partyId ?? ''} onchange={(e) => nav({ partie: e.currentTarget.value || null })}>
			<option value="">Alle Partien</option>
			{#each data.parties! as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
		</select>
	</div>

	<section class="card p-4 lg:p-6">
		<div class="flex flex-wrap items-start justify-between gap-2">
			<h2 class="text-xl">Verbrauch gesamt</h2>
			<p class="text-sm text-ink-3"><span class="num text-lg font-semibold text-ink">{int(sum)}</span> Stück in {data.months} Monaten</p>
		</div>
		<div class="mt-3"><BarChart data={chartData} title="Verbrauch gesamt" height={240} /></div>
	</section>

	<section class="card mt-4 overflow-hidden">
		<h2 class="px-4 pt-4 pb-3 text-xl lg:px-6">Je Artikel</h2>
		{#if data.matrix!.rows.length === 0}
			<p class="px-6 pb-10 text-center text-ink-3">Kein Verbrauch im gewählten Zeitraum.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="data-table">
					<thead>
						<tr>
							<th class="sticky left-0 z-[2] bg-surface-2">Artikel</th>
							{#each data.matrix!.keys as k (k)}<th class="num text-right">{monthShort(k)}</th>{/each}
							<th class="text-right">Gesamt</th>
						</tr>
					</thead>
					<tbody>
						{#each data.matrix!.rows as r (r.productId)}
							<tr>
								<td class="sticky left-0 z-[1] min-w-[16rem] bg-surface">
									<a href="/lager/artikel/{r.productId}" class="flex items-center gap-3 hover:underline">
										<ProductAvatar colorHex={r.colorHex} category={r.categoryName} size="sm" />
										<span class="min-w-0">
											<span class="block truncate font-medium">{r.name}</span>
											<span class="block text-sm text-ink-3">{packageLabel(r.packageSize, r.unit)}</span>
										</span>
									</a>
								</td>
								{#each data.matrix!.keys as k (k)}
									<td class="num text-right {r.months[k] ? '' : 'text-ink-3'}">{r.months[k] ?? '–'}</td>
								{/each}
								<td class="text-right">
									<span class="num font-semibold">{r.total}</span>
									{#if amountLabel(r.total, r.packageSize, r.unit)}<span class="block text-[0.8125rem] text-ink-3">{amountLabel(r.total, r.packageSize, r.unit)}</span>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
{:else}
	{#if data.groups!.length === 0}
		<div class="card px-6 py-16 text-center text-ink-3">Derzeit liegt nichts auf Lager.</div>
	{/if}
	<div class="space-y-4">
		{#each data.groups! as g (g.locationId)}
			<section class="card overflow-hidden break-inside-avoid" aria-label={g.location}>
				<div class="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-3 lg:px-6">
					<h2 class="text-lg">{g.location}</h2>
					<p class="text-sm text-ink-2"><span class="num font-semibold text-ink">{int(g.total)}</span> Stück, {g.items.length} Artikel</p>
				</div>
				<table class="data-table">
					<thead>
						<tr>
							<th>Artikel</th>
							<th>Artikelnummer</th>
							<th class="text-right">Stück</th>
							<th class="text-right">Menge</th>
						</tr>
					</thead>
					<tbody>
						{#each g.items as r (r.productId)}
							<tr>
								<td>
									<span class="flex items-center gap-3">
										<ProductAvatar colorHex={r.colorHex} category={r.categoryName} size="sm" />
										<span class="font-medium">{r.name}</span>
									</span>
								</td>
								<td class="num text-ink-2">{r.articleNumber ?? '–'}</td>
								<td class="num text-right font-semibold">{r.quantity}</td>
								<td class="text-right text-ink-2">{amountLabel(r.quantity, r.packageSize, r.unit) || '–'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/each}
	</div>
{/if}
