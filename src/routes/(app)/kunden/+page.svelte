<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import Building from '@lucide/svelte/icons/building';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchInput from '$lib/components/SearchInput.svelte';
	import { liveSubmit } from '$lib/live-search';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Dialog from '$lib/components/Dialog.svelte';
	import ListBar from '$lib/components/ListBar.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import CustomerFields from '$lib/modules/auftraege/components/CustomerFields.svelte';
	import { addressLines } from '$lib/modules/auftraege/offer';
	import { toast } from '$lib/stores/toast.svelte';
	import { can } from '$lib/permissions';

	let { data, form } = $props();

	/** Ansehen darf, wer Kunden sieht – Anlegen, Ändern und Löschen sind eigene Rechte */
	const canCreate = $derived(can(data.user.role, 'kunden.erstellen'));
	const canEdit = $derived(can(data.user.role, 'kunden.bearbeiten'));
	const canDelete = $derived(can(data.user.role, 'kunden.loeschen'));

	type Row = (typeof data.customers)[number];
	let editing = $state<Row | null>(null);
	let open = $state(false);
	let busy = $state(false);
	/** Neu anlegen oder ändern – sonst nur ansehen */
	const writable = $derived(editing ? canEdit : canCreate);

	function edit(c: Row | null) {
		editing = c;
		open = true;
	}
</script>

<svelte:head><title>{pageTitle('Kunden')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Building size={26} aria-hidden="true" />Kunden</h1>
		<p class="text-ink-2">Anschriften für Angebote – im Angebot einfach auswählen.</p>
	</div>
	{#if canCreate}<button class="btn btn-primary" onclick={() => edit(null)}><Plus size={18} aria-hidden="true" />Neuer Kunde</button>{/if}
</div>

<ListBar>
	<form method="GET" class="card flex flex-wrap items-end gap-3 p-3">
		<label class="min-w-[12rem] flex-1">
			<span class="field-label">Suche</span>
			<SearchInput value={data.filter.q} placeholder="Name, Ort, Ansprechpartner, UID" />
		</label>
		<label class="flex items-center gap-2 pb-2.5 text-sm">
			<input
				type="checkbox"
				name="alle"
				value="1"
				class="size-5 accent-[var(--c-ink)]"
				checked={data.filter.all}
				onchange={(e) => liveSubmit(e.currentTarget.form)}
			/>Auch ausgeblendete
		</label>
		{#if data.filter.q || data.filter.all}<a href="/kunden" class="btn btn-ghost">Zurücksetzen</a>{/if}
	</form>
</ListBar>

<div class="card overflow-hidden">
	<ul>
		{#each data.customers as c (c.id)}
			<li class="border-b border-line last:border-0">
				<button type="button" class="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2" onclick={() => edit(c)}>
					<span class="min-w-0 flex-1">
						<span class="flex flex-wrap items-center gap-2 font-medium">
							{c.name}{#if !c.active}<span class="badge">ausgeblendet</span>{/if}{#if c.reverseCharge}<span class="badge">Bauunternehmen · § 19</span>{/if}
						</span>
						<span class="block truncate text-[0.8125rem] text-ink-3">{addressLines(c).slice(1).join(' · ') || 'Keine Anschrift'}</span>
						{#if c.contact || c.email || c.phone}
							<span class="block truncate text-[0.8125rem] text-ink-3">{[c.contact, c.email, c.phone].filter(Boolean).join(' · ')}</span>
						{/if}
					</span>
					<span class="shrink-0 text-right text-[0.8125rem] text-ink-3">
						{#if c.uid}<span class="num block">{c.uid}</span>{/if}
						{c.offers === 1 ? '1 Angebot' : `${c.offers} Angebote`}
					</span>
					<Pencil size={16} class="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
				</button>
			</li>
		{:else}
			<li class="p-10 text-center">
				<p class="font-medium">{data.filter.q ? 'Kein Kunde gefunden' : 'Noch keine Kunden'}</p>
				<p class="mt-1 text-sm text-ink-3">Kunden lassen sich hier anlegen oder direkt beim Schreiben eines Angebots.</p>
			</li>
		{/each}
	</ul>
	<Pagination page={data.page} pageSize={data.pageSize} count={data.count} />
</div>

<Dialog bind:open title={editing ? (canEdit ? 'Kunde bearbeiten' : 'Kunde') : 'Neuer Kunde'} wide>
	<form
		method="POST"
		action="?/save"
		class="space-y-4"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'success') {
					toast.success(editing ? 'Kunde gespeichert' : 'Kunde angelegt');
					open = false;
				}
				await update({ reset: false });
			};
		}}
	>
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<fieldset disabled={!writable} class="contents"><CustomerFields customer={editing} /></fieldset>
		{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
		<div class="flex flex-wrap justify-end gap-2 pt-1">
			<button type="button" class="btn btn-ghost" onclick={() => (open = false)}>Abbrechen</button>
			{#if writable}<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Speichern'}</button>{/if}
		</div>
	</form>
	{#if editing && (canEdit || (canDelete && editing.offers === 0))}
		<div class="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
			{#if canEdit}
			<form method="POST" action="?/active" use:enhance={() => async ({ update }) => ((open = false), await update())}>
				<input type="hidden" name="id" value={editing.id} />
				<input type="hidden" name="active" value={editing.active ? '0' : '1'} />
				<button class="btn btn-ghost btn-sm">{editing.active ? 'Ausblenden' : 'Wieder einblenden'}</button>
			</form>
			{/if}
			{#if canDelete && editing.offers === 0}
				<form
					method="POST"
					action="?/delete"
					use:enhance={() => async ({ result, update }) => {
						if (result.type === 'success') {
							toast.info('Kunde gelöscht');
							open = false;
						}
						await update();
					}}
				>
					<input type="hidden" name="id" value={editing.id} />
					<button class="btn btn-ghost btn-sm text-danger hover:bg-danger-soft">Löschen</button>
				</form>
			{/if}
		</div>
	{/if}
</Dialog>
