<script lang="ts">
	/** Fotos zum Tagesbericht – nur intern, mit Drucken und PDF */
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';

	interface Props {
		reportId: number;
		photos: { id: number; width: number; height: number; createdAt: Date | string; createdBy: string | null }[];
		/** Hinzufügen und Löschen */
		editable: boolean;
	}
	let { reportId, photos, editable }: Props = $props();
</script>

<PhotoGallery
	base="/tagesberichte/{reportId}/fotos"
	{photos}
	{editable}
	printable
	hint="Nur intern – Fotos stehen nicht im PDF und nicht beim Kunden."
	empty="Noch keine Fotos – zum Beispiel von der fertigen Markierung."
/>
