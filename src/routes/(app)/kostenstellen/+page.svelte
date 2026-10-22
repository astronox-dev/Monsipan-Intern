<script lang="ts">
	/**
	 * Kostenstellen: wie lange auf welcher Kostenstelle gearbeitet wurde – alle
	 * Partien zusammen, aus den Stundenzetteln (Norm + Überstunden). Die
	 * Kostenstellen kommen aus dem, was eingetragen ist. Je Zeile aufklappbar:
	 * die Stunden je Partie. Dazu Zeitraum, Stand der Zettel und Excel/CSV.
	 */
	import { pageTitle } from '$lib/app';
	import Tags from '@lucide/svelte/icons/tags';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { num } from '$lib/format';
	import { addDays } from '$lib/modules/stunden/week';

	let { data } = $props();

	const hours = (h: number) => `${num(h)} Std.`;
	const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

	let sortBy = $state<'kostenstelle' | 'stunden'>('kostenstelle');
	const rows = $derived(sortBy === 'stunden' ? [...data.rows].sort((a, b) => b.total - a.total) : data.rows);
	const total = $derived(data.rows.reduce((s, r) => s + r.total, 0));
	const most = $derived(Math.max(0, ...data.rows.map((r) => r.total)));
	const named = $derived(data.rows.filter((r) => r.key).length);
	const missing = $derived(data.rows.find((r) => !r.key));

	/** Schnellwahl: dieses Jahr, letztes Jahr, dieser und letzter Monat */
	const presets = $derived.by(() => {
		const y = Number(data.today.slice(0, 4));
		const monthStart = `${data.today.slice(0, 7)}-01`;
		const lastMonthEnd = addDays(monthStart, -1);
		return [
			{ label: 'Dieses Jahr', from: `${y}-01-01`, to: data.today },
			{ label: 'Letztes Jahr', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
			{ label: 'Dieser Monat', from: monthStart, to: data.today },
			{ label: 'Letzter Monat', from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd }
		];
	});
	const query = (from: string, to: string) => `?von=${from}&bis=${to}${data.scope !== 'alle' ? `&stand=${data.scope}` : ''}`;
	const exportUrl = (format: 'xlsx' | 'csv') => `/kostenstellen/export${query(data.from, data.to)}&format=${format}`;
</script>

<svelte:head><title>{pageTitle('Kostenstellen')}</title></svelte:head>

<div class="mt-1 mb-5">
	<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Tags size={26} aria-hidden="true" />Kostenstellen</h1>
	<p class="text-ink-2">
		Wie lange auf welcher Kostenstelle gearbeitet wurde – alle Partien zusammen, aus den Stundenzetteln (Norm und Überstunden; Urlaub, Feiertag, Regen und Krankenstand
		zählen nicht). Die Kostenstellen kommen aus dem, was dort eingetragen ist.
	</p>
</div>

<form method="GET" class="card mb-4 flex flex-wrap items-end gap-3 p-4 lg:p-5">
	<label class="block">
		<span class="field-label">Von</span>
		<input class="input num" type="date" name="von" value={data.from} required />
	</label>
	<label class="block">
		<span class="field-label">Bis</span>
		<input class="input num" type="date" name="bis" value={data.to} required />
	</label>
	<label class="block">
		<span class="field-label">Stundenzettel</span>
		<select class="select" name="stand" value={data.scope}>
			<option value="alle">Alle, auch in Arbeit</option>
			<option value="freigegeben">Freigegeben und geprüft</option>
			<option value="geprueft">Nur geprüft</option>
		</select>
	</label>
	<button class="btn btn-primary">Anzeigen</button>
	<div class="flex basis-full flex-wrap items-center gap-2">
		{#each presets as p (p.label)}
			<a href={query(p.from, p.to)} class="btn btn-sm {p.from === data.from && p.to === data.to ? 'btn-secondary' : 'btn-ghost'}">{p.label}</a>
		{/each}
		<span class="ml-auto flex gap-2">
			<a href={exportUrl('xlsx')} class="btn btn-secondary btn-sm" download><FileSpreadsheet size={16} aria-hidden="true" />Excel</a>
			<a href={exportUrl('csv')} class="btn btn-ghost btn-sm" download>CSV</a>
		</span>
	</div>
</form>

<section class="card overflow-hidden">
	<div class="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 lg:px-5">
		<p class="num">
			<span class="font-semibold">{hours(total)}</span> gearbeitet · {named}
			{named === 1 ? 'Kostenstelle' : 'Kostenstellen'} · {short(data.from)} – {short(data.to)}
		</p>
		<div class="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm" role="group" aria-label="Sortieren">
			<button type="button" class="rounded-lg px-3 py-1 {sortBy === 'kostenstelle' ? 'bg-surface font-medium shadow-sm' : 'text-ink-2'}" onclick={() => (sortBy = 'kostenstelle')}>
				Nach Kostenstelle
			</button>
			<button type="button" class="rounded-lg px-3 py-1 {sortBy === 'stunden' ? 'bg-surface font-medium shadow-sm' : 'text-ink-2'}" onclick={() => (sortBy = 'stunden')}>
				Nach Stunden
			</button>
		</div>
	</div>
	{#if missing}
		<p class="mx-4 mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm lg:mx-5">
			<span class="num font-semibold">{hours(missing.total)}</span> ohne Kostenstelle – im Stundenzettel nachtragen, damit sie hier zählen.
		</p>
	{/if}

	<div class="mt-3 hidden gap-3 px-4 text-[0.8125rem] text-ink-3 md:grid md:grid-cols-[minmax(0,1fr)_7rem_6rem_6rem_6rem_4rem_5rem_1.25rem] lg:px-5">
		<span>Kostenstelle</span><span class="text-right">Gesamt</span><span class="text-right">Norm</span><span class="text-right">Ü 50 %</span><span class="text-right">Ü 100 %</span><span
			class="text-right">Tage</span
		><span class="text-right">Personen</span><span></span>
	</div>
	{#if rows.length}
		<ul class="mt-1 divide-y divide-line">
			{#each rows as r (r.key)}
				<li>
					<details class="group">
						<summary
							class="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-2 md:grid-cols-[minmax(0,1fr)_7rem_6rem_6rem_6rem_4rem_5rem_1.25rem] lg:px-5"
						>
							<span class="min-w-0">
								<span class="block truncate font-medium {r.key ? '' : 'text-warn'}">{r.key ? r.label : 'Ohne Kostenstelle'}</span>
								<span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
									<span class="block h-full rounded-full bg-brand" style:width="{most ? (r.total / most) * 100 : 0}%"></span>
								</span>
							</span>
							<span class="num text-right font-semibold">{hours(r.total)}</span>
							<span class="num col-span-2 text-sm text-ink-2 md:col-span-1 md:text-right">
								<span class="md:hidden">Norm</span> {num(r.normal)}
								<span class="md:hidden">· Ü 50 % {num(r.o50)} · Ü 100 % {num(r.o100)} · {r.days} Tage · {r.people} Pers.</span>
							</span>
							<span class="num hidden text-right text-sm text-ink-2 md:block">{num(r.o50)}</span>
							<span class="num hidden text-right text-sm text-ink-2 md:block">{num(r.o100)}</span>
							<span class="num hidden text-right text-sm text-ink-2 md:block">{r.days}</span>
							<span class="num hidden text-right text-sm text-ink-2 md:block">{r.people}</span>
							<ChevronDown size={16} class="hidden text-ink-3 transition-transform group-open:rotate-180 md:block" aria-hidden="true" />
						</summary>
						<div class="bg-surface-2 px-4 py-3 text-sm lg:px-5">
							<p class="text-ink-3">{short(r.first)} – {short(r.last)}</p>
							<ul class="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
								{#each r.parties as p (p.name)}
									<li class="flex justify-between gap-3 border-b border-line py-1">
										<span>{p.name || 'Ohne Partie'}</span><span class="num">{hours(p.hours)}</span>
									</li>
								{/each}
							</ul>
						</div>
					</details>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="px-4 pt-2 pb-5 text-sm text-ink-3 lg:px-5">In diesem Zeitraum sind keine gearbeiteten Stunden eingetragen.</p>
	{/if}
</section>
