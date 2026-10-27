<script lang="ts">
	/** Summenblatt zur Rechnung: die Seiten des PDFs, zum Drucken im Querformat */
	import { pageTitle } from '$lib/app';
	import PrintSheet from '$lib/components/PrintSheet.svelte';
	import PdfPages from '$lib/components/PdfPages.svelte';
	import { invoiceLabel, spacedNumber } from '$lib/modules/auftraege/offer';

	let { data } = $props();
	let ready = $state(false);
	const title = $derived(`Summenblatt zur ${invoiceLabel(data.kind)} ${spacedNumber(data.number)}`);
</script>

<svelte:head><title>{pageTitle(title)}</title></svelte:head>

<PrintSheet {title} back="/rechnungen/{data.id}" pdf="/rechnungen/{data.id}/summenblatt/pdf" bare {ready}>
	<div class="quer">
		<PdfPages url="/rechnungen/{data.id}/summenblatt/pdf" {title} onready={() => (ready = true)} />
	</div>
</PrintSheet>

<style>
	.quer :global(.seite) {
		max-width: 280mm;
	}
	@media print {
		/* Die Höhe begrenzt: so passt jede Seite auf ein Blatt */
		.quer :global(.seite) {
			width: auto;
			height: 192mm;
			max-width: 100%;
			margin: 0 auto;
		}
	}
</style>
