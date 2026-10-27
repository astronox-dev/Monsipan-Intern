<script lang="ts">
	/** Druckansicht: die Seiten des Wochenplan-PDFs – im Querformat */
	import { pageTitle } from '$lib/app';
	import PrintSheet from '$lib/components/PrintSheet.svelte';
	import PdfPages from '$lib/components/PdfPages.svelte';
	import { isoWeek } from '$lib/modules/stunden/week';

	let { data } = $props();
	let ready = $state(false);
	const title = $derived(`Wochenplanung KW ${isoWeek(data.weekStart).week}`);
	const pdf = $derived(`/planung/pdf?woche=${data.weekStart}`);
</script>

<svelte:head><title>{pageTitle(title)}</title></svelte:head>

<PrintSheet {title} back="/planung?woche={data.weekStart}" {pdf} bare {ready}>
	<div class="quer">
		<PdfPages url={pdf} {title} onready={() => (ready = true)} />
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
