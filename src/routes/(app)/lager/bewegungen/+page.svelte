<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Download from '@lucide/svelte/icons/download';
	import Printer from '@lucide/svelte/icons/printer';
	import FileText from '@lucide/svelte/icons/file-text';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import Search from '@lucide/svelte/icons/search';
	import ListFilter from '@lucide/svelte/icons/list-filter';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Ban from '@lucide/svelte/icons/ban';
	import MovementList from '$lib/modules/lager/components/MovementList.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import { fullName, relativeDateTime } from '$lib/format';
	import { MOVEMENT_META, signedQty, type MovementType } from '$lib/modules/lager/movement-view';
	import { can } from '$lib/permissions';
	import { toast } from '$lib/stores/toast.svelte';
	import { withParams } from '$lib/url';

	let { data } = $props();

	const canCorrect = $derived(can(data.user.role, 'lager.bewegungen.bearbeiten'));
	let q = $state(page.url.searchParams.get('q') ?? '');
	let showFilters = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	type Row = (typeof data.rows)[number];
	let cancelRow = $state<Row | null>(null);
	let correctRow = $state<Row | null>(null);
	let cancelOpen = $state(false);
	let correctOpen = $state(false);
	let dialogError = $state('');
	let busy = $state(false);

	function nav(patch: Record<string, string | number | null>) {
		goto(withParams(page.url, patch), { keepFocus: true, noScroll: true, replaceState: true });
	}
	function onSearch() {
		clearTimeout(timer);
		timer = setTimeout(() => nav({ q: q.trim() || null }), 220);
	}

	const activeFilters = $derived([data.query.art, data.query.ort, data.query.partie, data.query.nutzer].filter(Boolean).length);

	function openCancel(r: Row) {
		cancelRow = r;
		dialogError = '';
		cancelOpen = true;
	}
	function openCorrect(r: Row) {
		correctRow = r;
		dialogError = '';
		correctOpen = true;
	}

	const submit = (onDone: () => void, message: string) => () => {
		busy = true;
		dialogError = '';
		return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
			busy = false;
			if (result.type === 'success') {
				onDone();
				toast.success(message);
				await update({ reset: true });
			} else if (result.type === 'failure') {
				dialogError = String(result.data?.message ?? 'Aktion fehlgeschlagen');
			}
		};
	};
</script>

<svelte:head><title>{pageTitle('Bewegungen')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="text-[2rem] leading-tight">Bewegungen</h1>
		<p class="text-ink-2"><span class="num">{data.count}</span> Buchungen im gewählten Zeitraum</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<a href="/lager/bewegungen/druck{page.url.search}" class="btn btn-secondary"><Printer size={18} aria-hidden="true" />Drucken</a>
		<PdfButton href="/export/bewegungen.pdf{page.url.search}"><FileText size={18} aria-hidden="true" />PDF</PdfButton>
		<a href="/export/bewegungen.csv{page.url.search}" class="btn btn-secondary" download><Download size={18} aria-hidden="true" />CSV</a>
	</div>
</div>

<section class="card overflow-visible">
	<div class="space-y-3 border-b border-line p-3 lg:p-4">
		<div class="flex flex-wrap gap-2">
			<div class="relative min-w-48 flex-1">
				<label for="mv-q" class="sr-only">Nach Artikel filtern</label>
				<Search size={18} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden="true" />
				<input id="mv-q" type="search" class="input pl-10" placeholder="Artikel, Nummer, EAN …" autocomplete="off" bind:value={q} oninput={onSearch} />
			</div>
			<div class="w-44 shrink-0 sm:w-52">
				<label for="mv-period" class="sr-only">Zeitraum</label>
				<select id="mv-period" class="select" value={data.query.period} onchange={(e) => nav({ zeitraum: e.currentTarget.value === '30' ? null : e.currentTarget.value })}>
					{#each data.periods as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
				</select>
			</div>
			<button class="btn btn-secondary relative lg:hidden" aria-expanded={showFilters} aria-controls="mv-filters" onclick={() => (showFilters = !showFilters)}>
				<ListFilter size={18} aria-hidden="true" /><span class="sr-only sm:not-sr-only">Filter</span>
				{#if activeFilters > 0}<span class="badge badge-brand num h-5 px-1.5 text-xs">{activeFilters}</span>{/if}
			</button>
		</div>

		{#if data.query.period === 'frei'}
			<div class="flex flex-wrap items-center gap-2">
				<label class="flex items-center gap-2 text-sm text-ink-2">Von
					<input type="date" class="input w-auto" value={data.query.von} onchange={(e) => nav({ von: e.currentTarget.value || null })} />
				</label>
				<label class="flex items-center gap-2 text-sm text-ink-2">Bis
					<input type="date" class="input w-auto" value={data.query.bis} onchange={(e) => nav({ bis: e.currentTarget.value || null })} />
				</label>
			</div>
		{/if}

		<div id="mv-filters" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 {showFilters ? '' : 'hidden lg:grid'}">
			<select class="select" aria-label="Art" value={data.query.art} onchange={(e) => nav({ art: e.currentTarget.value || null })}>
				<option value="">Alle Arten</option>
				{#each Object.entries(MOVEMENT_META) as [k, m] (k)}<option value={k}>{m.noun}</option>{/each}
			</select>
			<select class="select" aria-label="Lagerort" value={data.query.ort ?? ''} onchange={(e) => nav({ ort: e.currentTarget.value || null })}>
				<option value="">Alle Lagerorte</option>
				{#each data.locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
			</select>
			<select class="select" aria-label="Partie" value={data.query.partie ?? ''} onchange={(e) => nav({ partie: e.currentTarget.value || null })}>
				<option value="">Alle Partien</option>
				{#each data.parties as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<select class="select" aria-label="Gebucht von" value={data.query.nutzer ?? ''} onchange={(e) => nav({ nutzer: e.currentTarget.value || null })}>
				<option value="">Alle Benutzer</option>
				{#each data.users as u (u.id)}<option value={u.id}>{fullName(u)}{u.deletedAt ? ' (gelöscht)' : ''}</option>{/each}
			</select>
			<label class="flex h-11 items-center gap-3 rounded-[10px] border border-line-strong px-3 text-[0.9375rem]">
				<input type="checkbox" class="size-5 accent-[var(--c-ink)]" checked={data.query.stornos} onchange={(e) => nav({ stornos: e.currentTarget.checked ? null : 'nein' })} />
				Stornierte zeigen
			</label>
		</div>
	</div>

	{#snippet actions(r: Row)}
		{#if !r.cancelledAt}
			<div class="flex justify-end gap-1">
				<button class="btn btn-ghost btn-sm btn-icon" aria-label="Buchung korrigieren" title="Korrigieren" onclick={() => openCorrect(r)}><Pencil size={16} /></button>
				<button class="btn btn-ghost btn-sm btn-icon hover:text-danger" aria-label="Buchung stornieren" title="Stornieren" onclick={() => openCancel(r)}><Ban size={16} /></button>
			</div>
		{/if}
	{/snippet}

	<MovementList rows={data.rows} actions={canCorrect ? actions : undefined} empty="Keine Buchungen für diese Auswahl." />
	<Pagination page={data.page} pageSize={data.pageSize} count={data.count} />
</section>

{#snippet summary(r: Row)}
	{@const m = MOVEMENT_META[r.type as MovementType]}
	<div class="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
		<span class="grid size-9 shrink-0 place-items-center rounded-xl {m.soft}"><m.icon size={18} aria-hidden="true" /></span>
		<div class="min-w-0 flex-1">
			<p class="truncate font-medium">{r.productName}</p>
			<p class="text-sm text-ink-3">{m.noun}, {relativeDateTime(r.createdAt)}, {fullName({ firstName: r.userFirst, lastName: r.userLast, username: r.username })}</p>
		</div>
		<span class="num font-display text-xl font-semibold {m.tone}">{signedQty(r)}</span>
	</div>
{/snippet}

<Dialog bind:open={cancelOpen} title="Buchung stornieren">
	{#if cancelRow}
		{@render summary(cancelRow)}
		<form id="cancel-form" method="POST" action="?/cancel" class="mt-4 space-y-3" use:enhance={submit(() => (cancelOpen = false), 'Buchung storniert')}>
			<input type="hidden" name="id" value={cancelRow.id} />
			<p class="text-sm text-ink-2">Der Bestand wird zurückgerechnet. Die Buchung bleibt durchgestrichen sichtbar.</p>
			<div>
				<label for="cancel-reason" class="field-label">Grund *</label>
				<input id="cancel-reason" name="reason" class="input" required maxlength="300" placeholder="z. B. falscher Artikel gescannt" />
			</div>
			{#if dialogError}<p class="field-error" role="alert">{dialogError}</p>{/if}
		</form>
	{/if}
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (cancelOpen = false)}>Abbrechen</button>
		<button class="btn btn-danger" form="cancel-form" disabled={busy}>Stornieren</button>
	{/snippet}
</Dialog>

<Dialog bind:open={correctOpen} title="Buchung korrigieren">
	{#if correctRow}
		{@const r = correctRow}
		{@render summary(r)}
		<form id="correct-form" method="POST" action="?/correct" class="mt-4 grid gap-3 sm:grid-cols-2" use:enhance={submit(() => (correctOpen = false), 'Buchung korrigiert')}>
			<input type="hidden" name="id" value={r.id} />
			{#if r.type === 'INVENTORY'}
				<div>
					<label for="c-counted" class="field-label">Gezählt</label>
					<input id="c-counted" name="countedQuantity" class="input" inputmode="numeric" value={r.countedQuantity} required />
				</div>
				<input type="hidden" name="quantity" value="0" />
			{:else}
				<div>
					<label for="c-qty" class="field-label">Menge (Stück)</label>
					<input id="c-qty" name="quantity" class="input" inputmode="numeric" value={r.quantity} required />
				</div>
			{/if}
			{#if r.type === 'OUT' || r.type === 'TRANSFER'}
				<div>
					<label for="c-from" class="field-label">{r.type === 'OUT' ? 'Aus Lagerort' : 'Von Lagerort'}</label>
					<select id="c-from" name="fromLocationId" class="select" value={r.fromLocationId}>
						{#each data.locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
					</select>
				</div>
			{/if}
			{#if r.type !== 'OUT'}
				<div>
					<label for="c-to" class="field-label">{r.type === 'INVENTORY' ? 'Lagerort' : r.type === 'TRANSFER' ? 'Nach Lagerort' : 'In Lagerort'}</label>
					<select id="c-to" name="toLocationId" class="select" value={r.toLocationId}>
						{#each data.locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
					</select>
				</div>
			{/if}
			{#if r.type === 'OUT' || r.type === 'RETURN'}
				<div>
					<label for="c-party" class="field-label">{r.type === 'OUT' ? 'Ausgabe an' : 'Zurück von'}</label>
					<select id="c-party" name="recipient" class="select" value={r.partyId ? `party:${r.partyId}` : `user:${r.recipientUserId}`}>
						{#if r.recipientUserId}
							<option value="user:{r.recipientUserId}">{r.recipientName ?? r.recipientUsername}</option>
						{/if}
						<optgroup label="Partien">
							{#each data.parties as p (p.id)}<option value="party:{p.id}">{p.name}</option>{/each}
						</optgroup>
					</select>
				</div>
			{/if}
			<div class="sm:col-span-2">
				<label for="c-reason" class="field-label">Grund der Korrektur *</label>
				<input id="c-reason" name="reason" class="input" required maxlength="300" placeholder="z. B. Menge falsch gezählt" />
			</div>
			<p class="text-sm text-ink-3 sm:col-span-2">Die alte Buchung wird storniert und durch die korrigierte ersetzt – beides bleibt nachvollziehbar.</p>
			{#if dialogError}<p class="field-error sm:col-span-2" role="alert">{dialogError}</p>{/if}
		</form>
	{/if}
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (correctOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary" form="correct-form" disabled={busy}>Korrektur speichern</button>
	{/snippet}
</Dialog>
