<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchInput from '$lib/components/SearchInput.svelte';
	import { liveSubmit } from '$lib/live-search';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Dialog from '$lib/components/Dialog.svelte';
	import { dayLabel } from '$lib/modules/stunden/week';
	import { reportDateLabel } from '$lib/modules/tagesberichte/sheet';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();

	// Vom Auftrag aus kommt man mit ?auftrag=… – dann gleich mit diesem Auftrag anlegen
	// svelte-ignore state_referenced_locally
	let newOpen = $state(!!data.suggestion.orderId);
	// svelte-ignore state_referenced_locally
	let orderId = $state(data.suggestion.orderId ? String(data.suggestion.orderId) : '');
	// svelte-ignore state_referenced_locally
	let number = $state(data.suggestion.number);
	// svelte-ignore state_referenced_locally
	let date = $state(data.suggestion.date);
	let dateTo = $state('');
	let road = $state('');
	// svelte-ignore state_referenced_locally
	let site = $state(siteOf(data.suggestion.orderId ? String(data.suggestion.orderId) : ''));

	/** Ausführungsort (sonst BV) des Auftrags als Vorschlag für die Baustelle */
	function siteOf(id: string): string {
		const o = data.orders.find((x) => String(x.id) === id);
		return o ? o.location || o.title : '';
	}
	function pickOrder() {
		const proposal = siteOf(orderId);
		if (proposal && (!site.trim() || data.orders.some((o) => (o.location || o.title) === site))) site = proposal;
	}

	/** Ablauf: in Arbeit → freigegeben → geprüft → vom Kunden unterschrieben */
	const STATUS: Record<string, { label: string; tone: string }> = {
		entwurf: { label: 'In Arbeit', tone: '' },
		freigegeben: { label: 'Freigegeben', tone: 'badge-info' },
		geprueft: { label: 'Geprüft', tone: 'badge-warn' },
		abgeschlossen: { label: 'Abgeschlossen', tone: 'badge-ok' }
	};

	function openNew() {
		number = data.suggestion.number;
		date = data.suggestion.date;
		dateTo = '';
		road = '';
		site = '';
		orderId = '';
		newOpen = true;
	}
</script>

<svelte:head><title>{pageTitle('Tagesberichte')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><NotebookPen size={26} aria-hidden="true" />Tagesberichte</h1>
		<p class="text-ink-2">Leistung je Tag und Baustelle – freigeben, prüfen und vom Kunden unterschreiben lassen.</p>
	</div>
	{#if data.canCreate}
		<button class="btn btn-primary" onclick={openNew}><Plus size={18} aria-hidden="true" />Neuer Bericht</button>
	{/if}
</div>

<form method="GET" class="card mb-4 flex flex-wrap items-end gap-3 p-3">
	<label class="min-w-[12rem] flex-1">
		<span class="field-label">Suche</span>
		<SearchInput value={data.filter.q} placeholder="Nummer, Straße, Baustelle, LV-Position" />
	</label>
	<label>
		<span class="field-label">von</span>
		<input class="input num" type="date" name="von" value={data.filter.from} onchange={(e) => liveSubmit(e.currentTarget.form)} />
	</label>
	<label>
		<span class="field-label">bis</span>
		<input class="input num" type="date" name="bis" value={data.filter.to} onchange={(e) => liveSubmit(e.currentTarget.form)} />
	</label>
	<label>
		<span class="field-label">Stand</span>
		<select class="select" name="stand" value={data.filter.status} onchange={(e) => liveSubmit(e.currentTarget.form)}>
			<option value="">Alle</option>
			{#each Object.entries(STATUS) as [key, s] (key)}<option value={key}>{s.label}</option>{/each}
		</select>
	</label>
	{#if data.filter.q || data.filter.from || data.filter.to || data.filter.status}
		<a href="/tagesberichte" class="btn btn-ghost">Zurücksetzen</a>
	{/if}
</form>

<div class="card overflow-hidden">
	<ul>
		{#each data.reports as r (r.id)}
			<li class="border-b border-line last:border-0">
				<a href="/tagesberichte/{r.id}" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
					<span class="num w-24 shrink-0 font-display text-lg font-semibold">{r.number || '–'}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{r.road || r.site || 'Ohne Bezeichnung'}</span>
						<span class="block truncate text-[0.8125rem] text-ink-3">
							{r.dateTo ? reportDateLabel(r.date, r.dateTo) : dayLabel(r.date)}{r.site && r.road ? ` · ${r.site}` : ''}{r.partyName ? ` · ${r.partyName}` : ''}{r.orderNumber
								? ` · Auftrag ${spacedNumber(r.orderNumber)}`
								: ''}
						</span>
					</span>
					{#if r.dailyOutput}<span class="hidden truncate text-sm text-ink-2 sm:block">{r.dailyOutput}</span>{/if}
					<span class="badge {(STATUS[r.status] ?? STATUS.entwurf).tone}">
						{#if r.status === 'abgeschlossen'}<CircleCheck size={13} aria-hidden="true" />{/if}{(STATUS[r.status] ?? STATUS.entwurf).label}
					</span>
					<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
				</a>
			</li>
		{:else}
			<li class="p-10 text-center">
				<p class="font-medium">Noch kein Tagesbericht</p>
				<p class="mt-1 text-sm text-ink-3">
					{data.canCreate ? 'Mit „Neuer Bericht" den ersten anlegen.' : 'Sobald die Partien Berichte anlegen, stehen sie hier.'}
				</p>
			</li>
		{/each}
	</ul>
</div>

<Dialog bind:open={newOpen} title="Neuer Tagesbericht">
	<form method="POST" action="?/create" use:enhance class="space-y-4">
		<label class="block">
			<span class="field-label">Nummer</span>
			<input class="input num" name="nummer" bind:value={number} maxlength="40" />
		</label>
		<div class="grid grid-cols-2 gap-4">
			<label class="block">
				<span class="field-label">Datum *</span>
				<input class="input num" type="date" name="datum" bind:value={date} required />
			</label>
			<label class="block">
				<span class="field-label">bis <span class="font-normal text-ink-3">(mehrere Tage)</span></span>
				<input class="input num" type="date" name="datum_bis" bind:value={dateTo} min={date} />
			</label>
		</div>
		{#if data.orders.length}
			<label class="block">
				<span class="field-label">Auftrag <span class="font-normal text-ink-3">(freiwillig)</span></span>
				<select class="select" name="auftrag" bind:value={orderId} onchange={pickOrder}>
					<option value="">Ohne Auftrag</option>
					{#each data.orders as o (o.id)}<option value={String(o.id)}>{spacedNumber(o.number)} – {o.title || o.location || 'ohne BV'}</option>{/each}
				</select>
			</label>
		{/if}
		<label class="block">
			<span class="field-label">Bundesstraße Nr.</span>
			<input class="input" name="strasse" bind:value={road} maxlength="120" list="strassen" placeholder="z. B. B9" />
		</label>
		<label class="block">
			<span class="field-label">Baustelle</span>
			<input class="input" name="baustelle" bind:value={site} maxlength="200" list="baustellen" />
		</label>
		<datalist id="strassen">{#each data.places.roads as r (r)}<option value={r}></option>{/each}</datalist>
		<datalist id="baustellen">{#each data.places.sites as s (s)}<option value={s}></option>{/each}</datalist>
		{#if form?.message}<p class="field-error" role="alert">{form.message}</p>{/if}
		<div class="flex justify-end gap-2 pt-1">
			<button type="button" class="btn btn-ghost" onclick={() => (newOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary">Anlegen</button>
		</div>
	</form>
</Dialog>
