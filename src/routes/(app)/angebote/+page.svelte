<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import FilePen from '@lucide/svelte/icons/file-pen-line';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchInput from '$lib/components/SearchInput.svelte';
	import { liveSubmit } from '$lib/live-search';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import HardHat from '@lucide/svelte/icons/hard-hat';
	import Dialog from '$lib/components/Dialog.svelte';
	import ListBar from '$lib/components/ListBar.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import YearTabs from '$lib/components/YearTabs.svelte';
	import { date as dateLabel } from '$lib/format';
	import { money, OFFER_STATUS_LABELS, OFFER_TITLE_DEFAULT, offerState, round2, spacedNumber, titleToEnd } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();

	let newOpen = $state(false);
	let busy = $state(false);

	const FILTERS = [
		['', 'Alle'],
		['offen', 'Offen (noch nicht angenommen)'],
		['entwurf', 'In Arbeit'],
		['freigegeben', 'Ausstehend'],
		['aenderung', 'Änderung gewünscht'],
		['angenommen', 'Angenommen'],
		['abgerechnet', 'Abgerechnet']
	];

	/** Überschrift, wo ein neues Jahr beginnt */
	const yearOf = (o: { date: string }) => o.date.slice(0, 4);
	const newYear = (n: number) => n === 0 || yearOf(data.offers[n - 1]) !== yearOf(data.offers[n]);
	const yearCount = (y: string) => data.years.find((x) => x.year === y)?.n ?? 0;
</script>

<svelte:head><title>{pageTitle('Angebote')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><FilePen size={26} aria-hidden="true" />Angebote</h1>
		<p class="text-ink-2">Schreiben, freigeben, dem Kunden schicken – angenommen wird daraus der Auftrag.</p>
	</div>
	{#if data.canCreate}
		<button class="btn btn-primary" onclick={() => (newOpen = true)}><Plus size={18} aria-hidden="true" />Neues Angebot</button>
	{/if}
</div>

<ListBar>
	<form method="GET" class="card flex flex-wrap items-end gap-3 p-3">
		{#if data.filter.year}<input type="hidden" name="jahr" value={data.filter.year} />{/if}
		<label class="min-w-[12rem] flex-1">
			<span class="field-label">Suche</span>
			<SearchInput value={data.filter.q} placeholder="Nummer, BV, Kunde" />
		</label>
		<label>
			<span class="field-label">Stand</span>
			<select class="select" name="status" value={data.filter.status} onchange={(e) => liveSubmit(e.currentTarget.form)}>
				{#each FILTERS as [key, label] (key)}<option value={key}>{label}</option>{/each}
			</select>
		</label>
		{#if data.filter.q || data.filter.status || data.filter.year}<a href="/angebote" class="btn btn-ghost">Zurücksetzen</a>{/if}
	</form>
	<YearTabs years={data.years} current={data.filter.year} />
</ListBar>

<div class="card overflow-hidden">
	<ul>
		{#each data.offers as o, n (o.id)}
			{@const st = OFFER_STATUS_LABELS[offerState(o)] ?? OFFER_STATUS_LABELS.entwurf}
			{#if newYear(n)}
				<li class="flex items-baseline gap-2 border-b border-line bg-surface-2 px-4 py-2">
					<span class="num font-display text-base font-semibold">{yearOf(o)}</span>
					<span class="text-[0.8125rem] text-ink-3">{yearCount(yearOf(o)) === 1 ? '1 Angebot' : `${yearCount(yearOf(o))} Angebote`}</span>
				</li>
			{/if}
			<li class="border-b border-line last:border-0">
				<a href="/angebote/{o.id}" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
					<span class="num w-20 shrink-0 font-display text-lg font-semibold">{spacedNumber(o.number)}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{o.title || 'Ohne BV'}</span>
						<span class="block truncate text-[0.8125rem] text-ink-3">
							{[o.customerName || 'Ohne Kunde', o.customerCity, dateLabel(o.date)].filter(Boolean).join(' · ')}
						</span>
					</span>
					<span class="num hidden shrink-0 text-right text-sm sm:block">
						{money(o.net)}<span class="block text-[0.75rem] text-ink-3">netto · {money(round2(o.net * (1 + (o.reverseCharge ? 0 : o.vatRate) / 100)))} brutto</span>
					</span>
					<span class="badge {st.tone}">{st.label}</span>
					{#if o.orderId}<span class="badge badge-ok" title="Auftrag erstellt"><HardHat size={13} aria-hidden="true" />Auftrag</span>{/if}
					<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
				</a>
			</li>
		{:else}
			<li class="p-10 text-center">
				<p class="font-medium">{data.filter.q || data.filter.status || data.filter.year ? 'Kein Angebot gefunden' : 'Noch kein Angebot'}</p>
				{#if data.canCreate}<p class="mt-1 text-sm text-ink-3">Mit „Neues Angebot" das erste schreiben.</p>{/if}
			</li>
		{/each}
	</ul>
	<Pagination page={data.page} pageSize={data.pageSize} count={data.count} />
</div>

{#if data.suggestion}
	<Dialog bind:open={newOpen} title="Neues Angebot">
		<form
			method="POST"
			action="?/create"
			class="space-y-4"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					busy = false;
					await update({ reset: false });
				};
			}}
		>
			<label class="block">
				<span class="field-label">Kunde</span>
				<select class="select" name="kunde">
					<option value="">Später auswählen bzw. neu anlegen</option>
					{#each data.customers as c (c.id)}<option value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>{/each}
				</select>
			</label>
			<label class="block">
				<span class="field-label">Bauvorhaben (BV)</span>
				<input class="input" name="titel" maxlength="300" value={OFFER_TITLE_DEFAULT} onfocus={titleToEnd} />
			</label>
			<div class="grid grid-cols-2 gap-4">
				<label class="block">
					<span class="field-label">Angebotsnummer *</span>
					<input class="input num" name="nummer" required maxlength="30" />
				</label>
				<label class="block">
					<span class="field-label">Datum *</span>
					<input class="input num" type="date" name="datum" required value={data.suggestion.date} />
				</label>
			</div>
			<p class="field-hint">Die Angebotsnummer selbst eintragen – jede gibt es nur einmal.</p>
			{#if form?.message}<p class="field-error" role="alert">{form.message}</p>{/if}
			<div class="flex justify-end gap-2 pt-1">
				<button type="button" class="btn btn-ghost" onclick={() => (newOpen = false)}>Abbrechen</button>
				<button class="btn btn-primary" disabled={busy}>Anlegen</button>
			</div>
		</form>
	</Dialog>
{/if}
