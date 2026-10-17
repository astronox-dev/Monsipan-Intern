<script lang="ts">
	/** Offene Rechnung ändern */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import InvoiceEditor from '$lib/modules/auftraege/components/InvoiceEditor.svelte';
	import { invoiceLabel, invoiceNo } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>{pageTitle(`${invoiceLabel(data.invoice.kind)} ${invoiceNo(data.invoice)} bearbeiten`)}</title></svelte:head>

<a href="/rechnungen/{data.invoice.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />{invoiceLabel(data.invoice.kind)} {invoiceNo(data.invoice)}
</a>

<div class="mt-3 mb-5">
	<h1 class="text-[2rem] leading-tight">{invoiceLabel(data.invoice.kind)} {invoiceNo(data.invoice)} bearbeiten</h1>
	<p class="text-ink-2">Solange sie offen ist. Wurde sie schon verschickt, am besten eine neue PDF mitschicken.</p>
</div>

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
	<InvoiceEditor head={data.head} lines={data.lines} paymentDays={data.paymentDays} units={data.units} {busy} submitLabel="Speichern" message={form?.message ?? ''} />
</form>
