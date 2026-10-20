<script lang="ts">
	/**
	 * Bezeichnung einer Position mit Vorschlägen: Beim Tippen erscheinen
	 * Positionen, die schon in Angeboten standen (alle eingegebenen Wörter
	 * müssen vorkommen), die häufigsten zuerst. Pfeiltasten wählen, Enter
	 * übernimmt, Escape schließt – oder einfach antippen.
	 */
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	export interface PositionMemory {
		text: string;
		note: string;
		unit: string;
		unitPrice: number | null;
		uses: number;
	}

	interface Props extends Omit<HTMLTextareaAttributes, 'value'> {
		value: string;
		memory: PositionMemory[];
		/** Vorschlag gewählt – die Seite füllt Einheit, Preis und Bemerkung */
		onpick: (m: PositionMemory) => void;
	}
	let { value = $bindable(), memory, onpick, ...rest }: Props = $props();

	let focused = $state(false);
	let active = $state(0);
	let dismissed = $state(false);

	const MAX = 6;
	const norm = (t: string) => t.toLocaleLowerCase('de-AT');
	const hits = $derived.by(() => {
		const words = norm(value).split(/\s+/).filter((w) => w.length >= 2);
		if (!words.length) return [];
		const own = norm(value.trim());
		return memory.filter((m) => norm(m.text) !== own && words.every((w) => norm(m.text).includes(w))).slice(0, MAX);
	});
	const open = $derived(focused && !dismissed && hits.length > 0);

	const priceLabel = (p: number | null) => (p == null ? '' : `${p.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`);

	function pick(m: PositionMemory) {
		value = m.text;
		onpick(m);
		dismissed = true;
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = (active + 1) % hits.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = (active - 1 + hits.length) % hits.length;
		} else if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			pick(hits[active]);
		} else if (e.key === 'Escape') {
			dismissed = true;
		}
	}
</script>

<div class="relative">
	<textarea
		{...rest}
		bind:value
		onfocus={() => (focused = true)}
		onblur={() => (focused = false)}
		oninput={() => {
			dismissed = false;
			active = 0;
		}}
		{onkeydown}
		autocomplete="off"
		aria-autocomplete="list"
	></textarea>
	{#if open}
		<ul class="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg" role="listbox" aria-label="Frühere Positionen">
			{#each hits as m, i (m.text)}
				<li role="option" aria-selected={i === active}>
					<!-- mousedown statt click: sonst verliert das Feld vorher den Fokus und die Liste ist weg -->
					<button
						type="button"
						class="block w-full rounded-lg px-2.5 py-2 text-left text-sm {i === active ? 'bg-surface-3' : 'hover:bg-surface-2'}"
						onmousedown={(e) => {
							e.preventDefault();
							pick(m);
						}}
					>
						<span class="line-clamp-2 font-medium whitespace-pre-line">{m.text}</span>
						<span class="mt-0.5 block text-[0.75rem] text-ink-3">
							{[m.unit, priceLabel(m.unitPrice), m.uses > 1 ? `${m.uses}× verwendet` : 'einmal verwendet'].filter(Boolean).join(' · ')}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
