<script lang="ts">
	interface Props {
		/** Nur das Zeichen (wie das Favicon) – für enge Köpfe, etwa die Seiten der Kunden */
		compact?: boolean;
		/** Groß – für die Anmeldeseite */
		large?: boolean;
	}
	let { compact = false, large = false }: Props = $props();
</script>

<!-- Das Zeichen wie das Favicon: feiner Rand und leichter Schatten heben die dunkle Kachel vom Hintergrund ab -->
{#snippet mark(size: string)}
	<img src="/favicon.svg" alt="" class="shrink-0 rounded-[18.75%] shadow-[0_2px_6px_-1px_rgb(0_0_0/0.35)] ring-1 ring-line-strong select-none {size}" />
{/snippet}

{#if compact}
	{@render mark('size-8')}
{:else}
	<span class="inline-flex items-center select-none {large ? 'gap-3.5' : 'gap-2.5'}">
		{@render mark(large ? 'size-[4.5rem]' : 'size-12')}
		<!-- Schriftzug wie eine Straßenmarkierung: fett, kursiv, „Portal" auf gelbem, schrägem Streifen -->
		<span class="inline-block leading-none">
			<span class="block font-display font-extrabold tracking-tight text-ink uppercase italic {large ? 'text-[2.75rem]' : 'text-[1.75rem]'}"
				>Monsipan</span
			>
			<span
				class="inline-block -skew-x-12 bg-brand font-display font-extrabold text-brand-ink uppercase italic {large
					? 'mt-1.5 rounded-[3px] px-2.5 py-1 text-[0.9375rem] tracking-[0.32em]'
					: 'mt-1 rounded-[2px] px-1.5 py-0.5 text-[0.625rem] tracking-[0.3em]'}">Portal</span
			>
		</span>
	</span>
{/if}
