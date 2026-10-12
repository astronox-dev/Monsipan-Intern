<script lang="ts">
	/** Liste nach Jahren: alle oder ein Jahr – mit der Anzahl je Jahr */
	import { page } from '$app/state';
	import { withParams } from '$lib/url';

	interface Props {
		years: { year: string; n: number }[];
		/** Gewähltes Jahr, leer für alle */
		current: string;
	}
	let { years, current }: Props = $props();
	const total = $derived(years.reduce((sum, y) => sum + y.n, 0));
	const options = $derived([{ year: '', n: total }, ...years]);
</script>

{#if years.length > 1 || current}
	<nav class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" aria-label="Jahre">
		{#each options as y (y.year)}
			<a
				href={withParams(page.url, { jahr: y.year || null })}
				aria-current={current === y.year ? 'page' : undefined}
				data-sveltekit-noscroll
				class="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors {current === y.year
					? 'border-ink bg-ink text-surface'
					: 'border-line bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink'}"
			>
				<span class="num">{y.year || 'Alle Jahre'}</span><span class="num text-[0.75rem] opacity-70">{y.n}</span>
			</a>
		{/each}
	</nav>
{/if}
