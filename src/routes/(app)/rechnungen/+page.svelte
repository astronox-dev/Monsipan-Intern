<script lang="ts">
	/**
	 * Rechnungen: offen und bezahlt. Oben die abgeschlossenen Aufträge, bei denen
	 * noch etwas abzurechnen ist – von dort geht es direkt zum Abrechnen.
	 */
	import { pageTitle } from '$lib/app';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import Search from '@lucide/svelte/icons/search';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Plus from '@lucide/svelte/icons/plus';
	import { date as dateLabel } from '$lib/format';
	import { INVOICE_STATUS_LABELS, invoiceLabel, money, round2, spacedNumber } from '$lib/modules/auftraege/offer';
	import { INVOICE_STAGE_LABELS } from '$lib/modules/auftraege/signature';

	let { data } = $props();

	const TABS = $derived([
		{ key: 'offen', label: 'Offen', count: data.counts.open },
		{ key: 'bezahlt', label: 'Bezahlt', count: data.counts.paid },
		{ key: 'entwurf', label: 'Entwürfe', count: data.counts.drafts },
		{ key: 'alle', label: 'Alle', count: data.counts.all }
	]);
	const gross = (i: (typeof data.invoices)[number]) => round2(i.net * (1 + (i.reverseCharge ? 0 : i.vatRate) / 100));
	const inactive = (i: (typeof data.invoices)[number]) => i.stage === 'storniert' || i.kind === 'storno';
	const overdue = (i: (typeof data.invoices)[number]) => i.status === 'offen' && !inactive(i) && i.dueDate < data.today;
</script>

<svelte:head><title>{pageTitle('Rechnungen')}</title></svelte:head>

<div class="pt-2 pb-5">
	<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><ReceiptText size={26} aria-hidden="true" />Rechnungen</h1>
	<p class="text-ink-2">
		Zum abgeschlossenen Auftrag – Preise aus dem Angebot, Mengen aus den Tagesberichten.
		{#if data.counts.overdue}<span class="font-medium text-danger">{data.counts.overdue} überfällig.</span>{/if}
	</p>
</div>

{#if data.ready.length}
	<section class="card mb-4 border-warn/50 p-4 lg:p-5">
		<h2 class="text-lg">Bereit zur Rechnung</h2>
		<p class="mt-1 text-sm text-ink-2">Abgeschlossene Aufträge ohne Rechnung oder mit Tagesberichten, die noch nicht abgerechnet sind.</p>
		<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
			{#each data.ready as o (o.id)}
				<li class="flex flex-wrap items-center gap-3 px-3 py-2.5">
					<a href="/auftraege/{o.id}" class="num w-20 shrink-0 font-display text-lg font-semibold hover:underline">{spacedNumber(o.number)}</a>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{o.title || 'Ohne BV'}</span>
						<span class="block truncate text-[0.8125rem] text-ink-3">{[o.customerName, o.location].filter(Boolean).join(' · ')}</span>
					</span>
					<a href="/rechnungen/neu?auftrag={o.id}" class="btn btn-secondary btn-sm"><Plus size={16} aria-hidden="true" />Rechnung</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Stand">
		{#each TABS as t (t.key)}
			<a
				href="/rechnungen?stand={t.key}{data.filter.q ? `&q=${encodeURIComponent(data.filter.q)}` : ''}"
				role="tab"
				aria-selected={data.filter.state === t.key}
				class="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors {data.filter.state === t.key
					? 'bg-ink text-surface'
					: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
			>
				{t.label}<span class="num text-[0.75rem] opacity-70">{t.count}</span>
			</a>
		{/each}
	</div>
	<form method="GET" class="flex min-w-[14rem] flex-1 gap-2">
		<input type="hidden" name="stand" value={data.filter.state} />
		<input class="input" name="q" value={data.filter.q} placeholder="Nummer, BV, Kunde, Ort" aria-label="Suche" />
		<button class="btn btn-secondary btn-icon" aria-label="Suchen"><Search size={18} /></button>
	</form>
</div>

<div class="card overflow-hidden">
	<ul>
		{#each data.invoices as i (i.id)}
			{@const st = INVOICE_STATUS_LABELS[i.status] ?? INVOICE_STATUS_LABELS.offen}
			<li class="border-b border-line last:border-0">
				<a href="/rechnungen/{i.id}" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
					<span class="num w-24 shrink-0 font-display text-lg font-semibold">{spacedNumber(i.number)}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{i.kind === 'rechnung' ? '' : `${invoiceLabel(i.kind)} · `}{i.title || 'Ohne BV'}</span>
						<span class="block truncate text-[0.8125rem] text-ink-3">
							{[i.customerName, `vom ${dateLabel(i.date)}`, i.status === 'bezahlt' && i.paidOn ? `bezahlt am ${dateLabel(i.paidOn)}` : `zahlbar bis ${dateLabel(i.dueDate)}`].filter(Boolean).join(' · ')}
						</span>
					</span>
					<span class="num hidden shrink-0 text-right text-sm sm:block">{money(gross(i))}</span>
					{#if i.stage === 'signiert'}<span title="Digital signiert" class="shrink-0 text-ok"><ShieldCheck size={18} aria-label="Digital signiert" /></span>{/if}
					{#if i.stage === 'entwurf' || i.stage === 'fehlgeschlagen' || i.stage === 'storniert'}
						<span class="badge {INVOICE_STAGE_LABELS[i.stage].tone}">{i.stage === 'fehlgeschlagen' ? 'Nicht signiert' : INVOICE_STAGE_LABELS[i.stage].label}</span>
					{/if}
					{#if inactive(i)}
						<!-- Storniert bzw. Stornorechnung: keine Zahlung -->
					{:else if overdue(i)}
						<span class="badge badge-danger">Überfällig</span>
					{:else}
						<span class="badge {st.tone}">{st.label}</span>
					{/if}
					<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
				</a>
			</li>
		{:else}
			<li class="p-10 text-center">
				<p class="font-medium">{data.filter.q ? 'Keine Rechnung gefunden' : data.filter.state === 'bezahlt' ? 'Noch nichts bezahlt' : 'Keine offenen Rechnungen'}</p>
				<p class="mt-1 text-sm text-ink-3">Rechnungen entstehen aus abgeschlossenen Aufträgen.</p>
			</li>
		{/each}
	</ul>
</div>
