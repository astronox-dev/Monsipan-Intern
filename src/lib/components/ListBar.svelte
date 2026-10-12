<script lang="ts">
	/**
	 * Suche und Filter einer langen Liste – bleiben beim Blättern oben stehen,
	 * direkt unter der Kopfleiste, über die ganze Breite des Inhalts.
	 */
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div
	class="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 -mx-4 mb-4 space-y-2 bg-bg/90 px-4 pt-1 pb-3 backdrop-blur-lg sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:static"
>
	{@render children()}
</div>
