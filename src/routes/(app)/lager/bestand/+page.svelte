<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Plus from '@lucide/svelte/icons/plus';
	import Download from '@lucide/svelte/icons/download';
	import Printer from '@lucide/svelte/icons/printer';
	import FileText from '@lucide/svelte/icons/file-text';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import Search from '@lucide/svelte/icons/search';
	import ListFilter from '@lucide/svelte/icons/list-filter';
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import ProductAvatar from '$lib/modules/lager/components/ProductAvatar.svelte';
	import StockStatus from '$lib/modules/lager/components/StockStatus.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import { amountLabel, int, packageLabel } from '$lib/format';
	import { can } from '$lib/permissions';
	import { withParams } from '$lib/url';

	let { data } = $props();

	const canManage = $derived(can(data.user.role, 'lager.artikel.erstellen'));
	let q = $state(page.url.searchParams.get('q') ?? '');
	let showFilters = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	const statuses = [
		{ value: 'aktiv', label: 'Alle aktiven' },
		{ value: 'nachbestellen', label: 'Nachbestellen' },
		{ value: 'leer', label: 'Leer' },
		{ value: 'inaktiv', label: 'Inaktiv' }
	] as const;

	const activeFilters = $derived(
		[data.filter.locationId, data.filter.categoryId, data.filter.colorId].filter(Boolean).length
	);

	function nav(patch: Record<string, string | number | null>) {
		goto(withParams(page.url, patch), { keepFocus: true, noScroll: true, replaceState: true });
	}

	function onSearch() {
		clearTimeout(timer);
		timer = setTimeout(() => nav({ q: q.trim() || null }), 220);
	}

	const exportHref = $derived(`/export/bestand.csv${page.url.search}`);

	// Live-Hinweis: Zeilen kurz hervorheben, deren Bestand sich geändert hat
	let previous = new Map<number, number>();
	let flashed = $state(new Set<number>());
	$effect(() => {
		const next = new Map(data.items.map((i) => [i.id, i.total]));
		const changed = new Set<number>();
		for (const [id, t] of next) if (previous.has(id) && previous.get(id) !== t) changed.add(id);
		previous = next;
		if (changed.size) {
			flashed = changed;
			setTimeout(() => (flashed = new Set()), 1700);
		}
	});
</script>

<svelte:head><title>{pageTitle('Bestand')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="text-[2rem] leading-tight">Bestand</h1>
		<p class="text-ink-2"><span class="num">{data.count}</span> {data.count === 1 ? 'Artikel' : 'Artikel'}</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<a href="/lager/bestand/druck{page.url.search}" class="btn btn-secondary"><Printer size={18} aria-hidden="true" /><span class="hidden sm:inline">Drucken</span></a>
		<PdfButton href="/export/bestand.pdf{page.url.search}" title="Bestand" compact><FileText size={18} aria-hidden="true" /><span class="hidden sm:inline">PDF</span></PdfButton>
		<a href={exportHref} class="btn btn-secondary" download><Download size={18} aria-hidden="true" /><span class="hidden sm:inline">CSV</span></a>
		{#if canManage}
			<a href="/lager/artikel/neu" class="btn btn-primary"><Plus size={18} aria-hidden="true" />Neuer Artikel</a>
		{/if}
	</div>
</div>

<section class="card overflow-visible">
	<!-- Filter -->
	<div class="space-y-3 border-b border-line p-3 lg:p-4">
		<div class="flex gap-2">
			<div class="relative flex-1">
				<label for="stock-q" class="sr-only">Bestand durchsuchen</label>
				<Search size={18} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden="true" />
				<input
					id="stock-q"
					type="search"
					class="input pl-10"
					placeholder="Name, Artikelnummer, EAN, Farbe …"
					autocomplete="off"
					bind:value={q}
					oninput={onSearch}
				/>
			</div>
			<button
				class="btn btn-secondary relative lg:hidden"
				aria-expanded={showFilters}
				aria-controls="stock-filters"
				onclick={() => (showFilters = !showFilters)}
			>
				<ListFilter size={18} aria-hidden="true" />Filter
				{#if activeFilters > 0}<span class="badge badge-brand num h-5 px-1.5 text-xs">{activeFilters}</span>{/if}
			</button>
		</div>

		<div id="stock-filters" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 {showFilters ? '' : 'hidden lg:grid'}">
			<div>
				<label class="sr-only" for="f-ort">Lagerort</label>
				<select id="f-ort" class="select" value={data.filter.locationId ?? ''} onchange={(e) => nav({ ort: e.currentTarget.value || null })}>
					<option value="">Alle Lagerorte</option>
					{#each data.locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
				</select>
			</div>
			<div>
				<label class="sr-only" for="f-kat">Materialart</label>
				<select id="f-kat" class="select" value={data.filter.categoryId ?? ''} onchange={(e) => nav({ kat: e.currentTarget.value || null })}>
					<option value="">Alle Materialarten</option>
					{#each data.categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
			</div>
			<div>
				<label class="sr-only" for="f-farbe">Farbe</label>
				<select id="f-farbe" class="select" value={data.filter.colorId ?? ''} onchange={(e) => nav({ farbe: e.currentTarget.value || null })}>
					<option value="">Alle Farben</option>
					{#each data.colors as c (c.id)}<option value={c.id}>{c.name}{c.ral ? ` (RAL ${c.ral})` : ''}</option>{/each}
				</select>
			</div>
			<div>
				<label class="sr-only" for="f-sort">Sortierung</label>
				<select id="f-sort" class="select" value={data.filter.sort} onchange={(e) => nav({ sort: e.currentTarget.value === 'name' ? null : e.currentTarget.value })}>
					<option value="name">Sortiert nach Name</option>
					<option value="bestand">Wenigster Bestand zuerst</option>
					<option value="bestand-ab">Meister Bestand zuerst</option>
					<option value="nummer">Sortiert nach Artikelnummer</option>
				</select>
			</div>
		</div>

		<div class="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Status">
			{#each statuses as s (s.value)}
				{@const active = data.filter.status === s.value}
				<button
					class="h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors {active
						? 'border-ink bg-ink text-surface'
						: 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink'}"
					aria-pressed={active}
					onclick={() => nav({ status: s.value === 'aktiv' ? null : s.value })}
				>
					{s.label}
				</button>
			{/each}
		</div>
	</div>

	{#if data.items.length === 0}
		<div class="flex flex-col items-center px-6 py-16 text-center">
			<span class="grid size-14 place-items-center rounded-2xl bg-surface-3 text-ink-3"><PackageOpen size={28} aria-hidden="true" /></span>
			<p class="mt-4 text-lg font-medium">Keine Artikel gefunden</p>
			<p class="mt-1 max-w-sm text-ink-3">
				{data.filter.q || activeFilters ? 'Andere Suchbegriffe oder weniger Filter probieren.' : 'Lege den ersten Artikel an oder scanne einen Code.'}
			</p>
			{#if canManage && !data.filter.q}<a href="/lager/artikel/neu" class="btn btn-primary mt-5"><Plus size={18} aria-hidden="true" />Neuer Artikel</a>{/if}
		</div>
	{:else}
		<!-- Tabelle (Desktop) -->
		<div class="hidden lg:block">
			<table class="data-table">
				<thead>
					<tr>
						<th>Artikel</th>
						<th>Inhalt je Stück</th>
						<th>Lagerorte</th>
						<th class="text-right">Bestand</th>
						<th class="text-right">Mindestbestand</th>
						<th><span class="sr-only">Status</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as p (p.id)}
						<tr class="row-link {flashed.has(p.id) ? 'animate-flash' : ''}" onclick={() => goto(`/lager/artikel/${p.id}`)}>
							<td class="max-w-[26rem]">
								<a href="/lager/artikel/{p.id}" class="flex items-center gap-3" onclick={(e) => e.stopPropagation()}>
									<ProductAvatar colorHex={p.colorHex} category={p.categoryName} />
									<span class="min-w-0">
										<span class="block truncate font-medium">{p.name}</span>
										<span class="block truncate text-sm text-ink-3">
											{[p.articleNumber && `Art.-Nr. ${p.articleNumber}`, p.categoryName, p.manufacturer].filter(Boolean).join(', ')}
										</span>
									</span>
								</a>
							</td>
							<td class="whitespace-nowrap text-ink-2">{packageLabel(p.packageSize, p.unit) || '–'}</td>
							<td>
								<div class="flex max-w-xs flex-wrap gap-1">
									{#each p.locations as l (l.locationId)}
										<span
											class="rounded-md px-1.5 py-0.5 text-[0.8125rem] {data.filter.locationId === l.locationId
												? 'bg-brand-soft font-medium text-ink'
												: 'bg-surface-3 text-ink-2'}"
										>
											{l.name} <span class="num font-semibold text-ink">{l.quantity}</span>
										</span>
									{:else}
										<span class="text-sm text-ink-3">–</span>
									{/each}
								</div>
							</td>
							<td class="text-right">
								<span class="num font-display text-xl font-semibold {p.total <= 0 ? 'text-ink-3' : ''}">{int(p.total)}</span>
								{#if amountLabel(p.total, p.packageSize, p.unit)}
									<span class="block text-[0.8125rem] text-ink-3">{amountLabel(p.total, p.packageSize, p.unit)}</span>
								{/if}
							</td>
							<td class="num text-right text-ink-2">{p.minStock ?? '–'}</td>
							<td class="text-right"><StockStatus total={p.total} minStock={p.minStock} active={p.active} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Karten (Handy/Tablet) -->
		<ul class="divide-y divide-line lg:hidden">
			{#each data.items as p (p.id)}
				<li class={flashed.has(p.id) ? 'animate-flash' : ''}>
					<a href="/lager/artikel/{p.id}" class="flex items-start gap-3 px-4 py-3 active:bg-surface-2">
						<ProductAvatar colorHex={p.colorHex} category={p.categoryName} />
						<div class="min-w-0 flex-1">
							<p class="font-medium leading-snug">{p.name}</p>
							<p class="text-sm text-ink-3">{[p.articleNumber, packageLabel(p.packageSize, p.unit)].filter(Boolean).join(', ')}</p>
							{#if p.locations.length}
								<p class="mt-1 text-[0.8125rem] text-ink-2">
									{p.locations.map((l) => `${l.name}: ${l.quantity}`).join(', ')}
								</p>
							{/if}
							<div class="mt-1.5 empty:hidden"><StockStatus total={p.total} minStock={p.minStock} active={p.active} /></div>
						</div>
						<div class="text-right">
							<p class="num font-display text-2xl leading-tight font-semibold {p.total <= 0 ? 'text-ink-3' : ''}">{int(p.total)}</p>
							{#if p.minStock}<p class="num text-[0.8125rem] text-ink-3">min. {p.minStock}</p>{/if}
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<Pagination page={data.page} pageSize={data.pageSize} count={data.count} />
</section>
