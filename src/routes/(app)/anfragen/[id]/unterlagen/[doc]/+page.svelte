<script lang="ts">
	import DocumentPage from '$lib/modules/auftraege/components/DocumentPage.svelte';

	let { data } = $props();
</script>

<DocumentPage
	back={{ href: `/anfragen/${data.inquiry.id}`, label: data.inquiry.subject || 'Anfrage' }}
	document={data.document}
	fileUrl="/anfragen/{data.inquiry.id}/unterlagen/{data.document.key}/datei"
	note={data.note}
/>
