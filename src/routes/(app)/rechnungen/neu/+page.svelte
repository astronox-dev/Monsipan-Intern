<script lang="ts">
	/** Neue Rechnung oder Teilrechnung zum Auftrag – Berichte, Zuordnung, Positionen, Kopf und Texte */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Sigma from '@lucide/svelte/icons/sigma';
	import InvoiceEditor from '$lib/modules/auftraege/components/InvoiceEditor.svelte';
	import { invoiceNo, INVOICE_STATUS_LABELS, invoiceLabel, spacedNumber } from '$lib/modules/auftraege/offer';
	import { date } from '$lib/format';

	let { data, form } = $props();
	let busy = $state(false);
	const next = $derived(data.previous.length ? 'Weitere Rechnung' : 'Neue Rechnung');
</script>

<svelte:head><title>{pageTitle(`${next} ${spacedNumber(data.order.number)}`)}</title></svelte:head>

<a href="/auftraege/{data.order.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Auftrag {spacedNumber(data.order.number)}
</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">{next} zu {spacedNumber(data.order.number)}</h1>
		<p class="text-ink-2">
			{data.order.title || 'Ohne BV'}{data.order.status === 'abgeschlossen' ? '' : ' · Auftrag noch in Arbeit – also eine Teilrechnung'}
		</p>
	</div>
	{#if data.selection.reports.length + data.selection.pending >= 2}
		<a href="/auftraege/{data.order.id}/summenblatt" class="btn btn-secondary"><Sigma size={18} aria-hidden="true" />Summenblatt</a>
	{/if}
</div>

{#if data.previous.length}
	<section class="card mb-4 p-4 text-sm">
		<p class="font-medium">Schon abgerechnet</p>
		<ul class="mt-1.5 space-y-1">
			{#each data.previous as p (p.id)}
				<li class="flex flex-wrap items-center gap-x-2">
					<a href="/rechnungen/{p.id}" class="num font-medium underline-offset-2 hover:underline">{invoiceLabel(p.kind)} {invoiceNo(p)}</a>
					<span class="num text-ink-3">vom {date(p.date)}</span>
					<span class="badge {INVOICE_STATUS_LABELS[p.status]?.tone ?? ''}">{INVOICE_STATUS_LABELS[p.status]?.label ?? p.status}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
{#if !data.hasPrices}
	<p class="card mb-4 border-warn/50 p-3 text-sm">Zu diesem Auftrag gibt es kein Angebot mehr – die Einheitspreise bitte selbst eintragen.</p>
{/if}

<form
	method="POST"
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			busy = false;
			await update({ reset: false });
		};
	}}
>
	<InvoiceEditor
		head={data.head}
		lines={data.lines}
		paymentDays={data.paymentDays}
		mapping={data.mapping}
		selection={data.selection}
		{busy}
		submitLabel="Erstellen"
		message={form?.message ?? ''}
	/>
</form>
