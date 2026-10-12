<script lang="ts">
	interface Props {
		/** Nur das Zeichen (wie das Favicon) – für enge Köpfe, etwa die Seiten der Kunden */
		compact?: boolean;
		/** Groß – für die Anmeldeseite */
		large?: boolean;
	}
	let { compact = false, large = false }: Props = $props();
</script>

{#if compact}
	<img src="/favicon.svg" alt="" width="32" height="32" class="shrink-0 select-none" />
{:else}
	<!-- Schriftzug wie eine Straßenmarkierung: fett, kursiv, „Portal" auf gelbem, schrägem Streifen -->
	<span class="inline-block leading-none select-none">
		<span class="block font-display font-extrabold tracking-tight text-ink uppercase italic {large ? 'text-[2.75rem]' : 'text-[1.75rem]'}"
			>Monsipan</span
		>
		<span
			class="inline-block -skew-x-12 bg-brand font-display font-extrabold text-brand-ink uppercase italic {large
				? 'mt-1.5 rounded-[3px] px-2.5 py-1 text-[0.9375rem] tracking-[0.32em]'
				: 'mt-1 rounded-[2px] px-1.5 py-0.5 text-[0.625rem] tracking-[0.3em]'}">Portal</span
		>
	</span>
{/if}
