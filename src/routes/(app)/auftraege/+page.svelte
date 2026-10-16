<script lang="ts">
	/**
	 * Aufträge in drei Listen: erstellt, in Arbeit, abgeschlossen – oben zum
	 * Umschalten, mit der Anzahl je Liste. Suche und Partie gelten für alle drei.
	 */
	import { pageTitle } from '$lib/app';
	import HardHat from '@lucide/svelte/icons/hard-hat';
	import SearchInput from '$lib/components/SearchInput.svelte';
	import { liveSubmit } from '$lib/live-search';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import { dateTime } from '$lib/format';
	import { INVOICE_STATUS_LABELS, ORDER_STATUS_LABELS, spacedNumber } from '$lib/modules/auftraege/offer';

	let { data } = $props();

	const TABS = [
		{ key: 'erstellt', label: 'Erstellt' },
		{ key: 'in_arbeit', label: 'In Arbeit' },
		{ key: 'abgeschlossen', label: 'Abgeschlossen' }
	] as const;

	/** Link auf einen Reiter – Suche und Partie bleiben */
	const tabHref = (status: string) => {
		const p = new URLSearchParams({ status });
		if (data.filter.q) p.set('q', data.filter.q);
		if (data.filter.partyId) p.set('partie', String(data.filter.partyId));
		return `/auftraege?${p}`;
	};
	const EMPTY: Record<string, string> = {
		erstellt: 'Keine neuen Aufträge',
		in_arbeit: 'Nichts in Arbeit',
		abgeschlossen: 'Noch nichts abgeschlossen'
	};
</script>

<svelte:head><title>{pageTitle('Aufträge')}</title></svelte:head>

<div class="pt-2 pb-5">
	<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><HardHat size={26} aria-hidden="true" />Aufträge</h1>
	<p class="text-ink-2">
		{data.all ? 'Aus angenommenen Angeboten – je Partie, mit Stand der Arbeiten.' : 'Die Aufträge deiner Partie – hier setzt ihr sie auf „in Arbeit" und „abgeschlossen".'}
	</p>
</div>

<div class="mb-4 grid grid-cols-3 gap-1 rounded-2xl border border-line bg-surface p-1 sm:inline-grid sm:w-auto" role="tablist" aria-label="Stand der Aufträge">
	{#each TABS as t (t.key)}
		{@const active = data.filter.status === t.key}
		<a
			href={tabHref(t.key)}
			role="tab"
			aria-selected={active}
			data-sveltekit-noscroll
			class="flex flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 text-center text-sm font-medium transition-colors sm:flex-row sm:gap-2 sm:px-4 {active
				? 'bg-ink text-surface'
				: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
		>
			{t.label}
			<span class="num rounded-full px-1.5 text-[0.75rem] {active ? 'bg-surface/20' : 'bg-surface-3'}">{data.counts[t.key]}</span>
		</a>
	{/each}
</div>

<form method="GET" class="card mb-4 flex flex-wrap items-end gap-3 p-3">
	<input type="hidden" name="status" value={data.filter.status} />
	<label class="min-w-[12rem] flex-1">
		<span class="field-label">Suche</span>
		<SearchInput value={data.filter.q} placeholder="Nummer, BV, Kunde" />
	</label>
	{#if data.all}
		<label>
			<span class="field-label">Partie</span>
			<select class="select" name="partie" value={data.filter.partyId ? String(data.filter.partyId) : ''} onchange={(e) => liveSubmit(e.currentTarget.form)}>
				<option value="">Alle Partien</option>
				<option value="ohne">Nicht zugeteilt</option>
				{#each data.parties as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
			</select>
		</label>
	{/if}
	{#if data.filter.q || data.filter.partyId}<a href="/auftraege?status={data.filter.status}" class="btn btn-ghost">Zurücksetzen</a>{/if}
</form>

<div class="card overflow-hidden">
	<ul>
		{#each data.orders as o (o.id)}
			{@const st = ORDER_STATUS_LABELS[o.status] ?? ORDER_STATUS_LABELS.erstellt}
			{@const inv = data.invoices ? data.invoices[o.id] : undefined}
			<li class="border-b border-line last:border-0">
				<a href="/auftraege/{o.id}" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
					<span class="num w-20 shrink-0 font-display text-lg font-semibold">{spacedNumber(o.number)}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{o.title || 'Ohne BV'}</span>
						<span class="block truncate text-[0.8125rem] text-ink-3">
							{[o.location || o.customerName, data.all ? (o.partyName ?? 'nicht zugeteilt') : null].filter(Boolean).join(' · ')}
						</span>
					</span>
					<span class="hidden shrink-0 text-right text-[0.8125rem] text-ink-3 sm:block">{o.statusAt ? dateTime(o.statusAt) : dateTime(o.createdAt)}</span>
					{#if data.invoices}
						<span class="badge {inv ? INVOICE_STATUS_LABELS[inv].tone : ''}" title={inv ? `Rechnung ${INVOICE_STATUS_LABELS[inv].label.toLowerCase()}` : 'Noch keine Rechnung'}>
							<ReceiptText size={13} aria-label="Rechnung" />{inv ? INVOICE_STATUS_LABELS[inv].label : 'Keine'}
						</span>
					{:else}
						<span class="badge {st.tone}">{st.label}</span>
					{/if}
					<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
				</a>
			</li>
		{:else}
			<li class="p-10 text-center">
				<p class="font-medium">{data.filter.q || data.filter.partyId ? 'Kein Auftrag gefunden' : EMPTY[data.filter.status]}</p>
				<p class="mt-1 text-sm text-ink-3">
					{!data.all && !data.hasParty
						? 'Du bist keiner Partie zugeordnet – Aufträge sieht man hier für die eigene Partie.'
						: 'Aufträge entstehen aus angenommenen Angeboten.'}
				</p>
			</li>
		{/each}
	</ul>
</div>
