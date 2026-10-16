<script lang="ts">
	import DocumentPage from '$lib/modules/auftraege/components/DocumentPage.svelte';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data } = $props();
</script>

<DocumentPage
	back={{ href: `/auftraege/${data.order.id}`, label: `Auftrag ${spacedNumber(data.order.number)}` }}
	document={data.document}
	fileUrl="/auftraege/{data.order.id}/unterlagen/{data.document.key}/datei"
	note={data.document.fromOffer ? 'vom Angebot' : undefined}
/>
