<script lang="ts">
	/**
	 * Druckansicht: die Seiten des PDFs – Arbeitsauftrag im Aufbau des Vordrucks,
	 * dahinter das 3M-Verlegeprotokoll, wenn es eines gibt. So sieht der Ausdruck
	 * genau aus wie das PDF.
	 */
	import { pageTitle } from '$lib/app';
	import PrintSheet from '$lib/components/PrintSheet.svelte';
	import PdfPages from '$lib/components/PdfPages.svelte';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data } = $props();
	const pdf = $derived(`/auftraege/${data.order.id}/arbeitsauftrag/pdf`);
	let pagesReady = $state(false);
</script>

<svelte:head><title>{pageTitle(`Arbeitsauftrag ${spacedNumber(data.order.number)}`)}</title></svelte:head>

<PrintSheet title="Arbeitsauftrag {spacedNumber(data.order.number)}" back="/auftraege/{data.order.id}/arbeitsauftrag" {pdf} bare ready={pagesReady}>
	<PdfPages url={pdf} title="Arbeitsauftrag {spacedNumber(data.order.number)}" onready={() => (pagesReady = true)} />
</PrintSheet>
