<script lang="ts">
	/** Rechnung kopieren – ein neuer Entwurf mit allem aus der Vorlage */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import InvoiceEditor from '$lib/modules/auftraege/components/InvoiceEditor.svelte';
	import { invoiceLabel, invoiceNo } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();
	let busy = $state(false);
	const source = $derived(`${invoiceLabel(data.source.kind)} ${invoiceNo(data.source)}`);
</script>

<svelte:head><title>{pageTitle(`${source} kopieren`)}</title></svelte:head>

<a href="/rechnungen/{data.source.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />{source}
</a>

<div class="mt-3 mb-5">
	<h1 class="text-[2rem] leading-tight">{source} kopieren</h1>
	<p class="text-ink-2">
		Eine neue Rechnung mit allem aus der Vorlage{data.source.cancelled ? ' – etwa, um die stornierte richtig neu auszustellen' : ''}. Rechnungsnummer und Datum
		bitte prüfen; Tagesberichte hängen an der Kopie keine.
	</p>
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
	<InvoiceEditor
		head={data.head}
		lastNumber={data.lastNumber}
		lines={data.lines}
		paymentDays={data.paymentDays}
		units={data.units}
		{busy}
		submitLabel="Rechnung anlegen"
		message={form?.message ?? ''}
	/>
</form>
