<script lang="ts">
	/** Druckansicht: die Seiten des Summenblatts – im Querformat */
	import { pageTitle } from '$lib/app';
	import PrintSheet from '$lib/components/PrintSheet.svelte';
	import PdfPages from '$lib/components/PdfPages.svelte';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data } = $props();
	let ready = $state(false);
	const title = $derived(`Summenblatt ${spacedNumber(data.number)}`);
</script>

<svelte:head><title>{pageTitle(title)}</title></svelte:head>

<PrintSheet {title} back="/auftraege/{data.id}/summenblatt" pdf="/auftraege/{data.id}/summenblatt/pdf" bare {ready}>
	<div class="quer">
		<PdfPages url="/auftraege/{data.id}/summenblatt/pdf" {title} onready={() => (ready = true)} />
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
