<script lang="ts">
	import DocumentPage from '$lib/modules/auftraege/components/DocumentPage.svelte';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data } = $props();
</script>

<DocumentPage
	back={{ href: `/angebote/${data.offer.id}`, label: `Angebot ${spacedNumber(data.offer.number)}` }}
	document={data.document}
	fileUrl="/angebote/{data.offer.id}/unterlagen/{data.document.id}/datei"
	note={data.document.forCrew ? 'auch für die Partie' : 'nur Büro'}
/>
