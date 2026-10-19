<script lang="ts">
	import DocumentPage from '$lib/modules/auftraege/components/DocumentPage.svelte';

	let { data } = $props();
</script>

<DocumentPage
	back={data.folder
		? { href: `/richtlinien?ordner=${data.folder.id}`, label: data.folder.name }
		: { href: '/richtlinien', label: 'Richtlinien & Vorschriften' }}
	document={data.document}
	fileUrl="/richtlinien/{data.document.id}/datei"
	note={data.place || undefined}
/>
