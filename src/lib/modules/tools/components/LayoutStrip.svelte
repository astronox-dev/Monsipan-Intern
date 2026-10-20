<script lang="ts" module>
	/** Ein Stück der Einteilung: Strich bzw. Riegel, Lücke, das gesuchte Maß am Rand – oder „…" für den ausgelassenen Teil */
	export interface StripPart {
		kind: 'mark' | 'end' | 'gap' | 'edge' | 'break';
		/** Länge in cm (bei „break" egal) */
		len: number;
	}
</script>

<script lang="ts">
	/**
	 * Die Einteilung maßstäblich als Streifen: Striche bzw. Riegel dunkel, das
	 * gesuchte Maß an Anfang und Ende hervorgehoben, darunter beschriftet. Mit
	 * `curbs` stehen links und rechts die Randsteine.
	 */
	interface Props {
		parts: StripPart[];
		/** Beschriftung unter dem ersten und letzten Stück */
		label: string;
		/** Schutzweg: Riegel hoch, Randsteine an den Seiten */
		curbs?: boolean;
		caption?: string;
		/** Das Maß am Rand liegt außerhalb der Vorgabe – in Warnfarbe */
		warn?: boolean;
	}
	let { parts, label, curbs = false, caption = '', warn = false }: Props = $props();
</script>

<figure class="mt-4">
	<div class="strip" class:crossing={curbs} class:warn aria-hidden="true">
		{#if curbs}<span class="curb"></span>{/if}
		{#each parts as p, i (i)}
			{#if p.kind === 'break'}
				<span class="break">···</span>
			{:else}
				<span class="part {p.kind}" style:flex="{p.len} 0 0"></span>
			{/if}
		{/each}
		{#if curbs}<span class="curb"></span>{/if}
	</div>
	<figcaption class="num mt-1.5 flex justify-between gap-3 text-sm font-semibold {warn ? 'text-warn' : 'text-info'}">
		<span>{curbs ? '↤ ' : ''}{label}</span>
		{#if caption}<span class="text-center font-normal text-ink-3">{caption}</span>{/if}
		<span>{label}{curbs ? ' ↦' : ''}</span>
	</figcaption>
</figure>

<style>
	.strip {
		display: flex;
		align-items: center;
		height: 2rem;
	}
	.strip.crossing {
		align-items: stretch;
		height: 4rem;
	}
	.part {
		min-width: 1px;
		height: 0.625rem;
	}
	.crossing .part {
		height: auto;
	}
	.mark {
		border-radius: 2px;
		background: var(--c-ink-2);
	}
	.end {
		border-radius: 2px;
		background: var(--c-info);
	}
	.edge {
		background: var(--c-info-soft);
	}
	.warn .edge {
		background: var(--c-warn-soft);
	}
	.curb {
		width: 0.5rem;
		flex-shrink: 0;
		border-radius: 3px;
		background: var(--c-ink-3);
	}
	.break {
		width: 2rem;
		flex-shrink: 0;
		text-align: center;
		color: var(--c-ink-3);
	}
</style>
