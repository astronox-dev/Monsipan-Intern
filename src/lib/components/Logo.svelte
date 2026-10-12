<script lang="ts">
	interface Props {
		compact?: boolean;
		/** Groß und kräftig – für die Anmeldeseite */
		large?: boolean;
	}
	let { compact = false, large = false }: Props = $props();
</script>

<span class="inline-flex items-center select-none {large ? 'gap-3.5' : 'gap-2.5'}">
	{#if large}
		<!--
			Dieselbe Fahrbahn, aber in Fahrt: schräg wie die kursive Schrift und der
			gelbe Streifen (skewX -12°), mit kräftigeren Linien passend zur fetten Schrift
		-->
		<svg width="74" height="60" viewBox="-7 0 39 32" aria-hidden="true" class="shrink-0">
			<defs>
				<clipPath id="logo-kachel"><rect width="32" height="32" rx="5" /></clipPath>
			</defs>
			<g transform="skewX(-12)">
				<rect width="32" height="32" rx="5" fill="#1b2027" />
				<g clip-path="url(#logo-kachel)">
					<path fill="#f4f5f6" d="M3.4 0h2.6v32H3.4zM26 0h2.6v32H26z" />
					<path fill="#f8f000" d="M14.4 -1h3.2v4.4h-3.2zM14.4 6.8h3.2v5.6h-3.2zM14.4 15.8h3.2v5.6h-3.2zM14.4 24.8h3.2v5.6h-3.2z" />
				</g>
				<rect x="0.5" y="0.5" width="31" height="31" rx="4.5" fill="none" stroke="var(--c-line-strong)" />
			</g>
		</svg>
		<!-- Schriftzug wie eine Straßenmarkierung: fett, kursiv, „Portal" auf gelbem Streifen -->
		<span class="leading-none">
			<span class="block font-display text-[2.75rem] font-extrabold tracking-tight text-ink uppercase italic">Monsipan</span>
			<span
				class="mt-1.5 inline-block -skew-x-12 rounded-[3px] bg-brand px-2.5 py-1 font-display text-[0.9375rem] font-extrabold tracking-[0.32em] text-brand-ink uppercase italic"
				>Portal</span
			>
		</span>
	{:else}
		<!-- Fahrbahn von oben: weiße Randlinien, gelbe unterbrochene Mittellinie (wie favicon.svg) -->
		<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
			<rect width="32" height="32" rx="6" fill="#1b2027" />
			<path fill="#f4f5f6" d="M4 .35h1.6v31.3H4zM26.4 .35H28v31.3h-1.6z" />
			<path fill="#f8f000" d="M15 0h2v4h-2zM15 6.4h2v4.8h-2zM15 13.6h2v4.8h-2zM15 20.8h2v4.8h-2zM15 28h2v4h-2z" />
			<!-- Rand zuletzt, damit die dunkle Kachel auch auf dunklem Grund abgesetzt ist -->
			<rect x="0.5" y="0.5" width="31" height="31" rx="5.5" fill="none" stroke="var(--c-line-strong)" />
		</svg>
		{#if !compact}
			<span class="leading-none">
				<span class="block font-display text-[1.0625rem] font-semibold tracking-tight text-ink">Monsipan</span>
				<span class="block text-[0.75rem] whitespace-nowrap text-ink-3">Portal</span>
			</span>
		{/if}
	{/if}
</span>
