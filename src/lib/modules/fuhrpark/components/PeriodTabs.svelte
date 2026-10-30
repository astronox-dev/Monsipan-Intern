<script lang="ts">
	/** Zeitraum wählen: Heute, Gestern, 7 oder 30 Tage – für Statistik, Ablauf und Fahrtenbuch */
	import { PERIODS } from '../periods';

	interface Props {
		/** Der gewählte Zeitraum – keiner, wenn ein anderer Tag gewählt ist */
		active: string | null;
		/** Was in der Adresse bleibt, etwa das gewählte Fahrzeug: „&fahrzeug=3" */
		keep?: string;
	}
	let { active, keep = '' }: Props = $props();
</script>

<div class="flex w-fit rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Zeitraum">
	{#each PERIODS as p (p.key)}
		<a
			href="?zeit={p.key}{keep}"
			role="tab"
			aria-selected={active === p.key}
			data-sveltekit-noscroll
			class="rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors {active === p.key ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-3 hover:text-ink'}">{p.label}</a
		>
	{/each}
</div>
