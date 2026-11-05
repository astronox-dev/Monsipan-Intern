<script lang="ts">
	/**
	 * Werkzeuge einer Zeile in Angebot und Rechnung: Griff zum Ziehen, nach oben,
	 * nach unten, ein Menü mit Einfügen, Kopieren und Einrücken, Entfernen.
	 */
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import CopyPlus from '@lucide/svelte/icons/copy-plus';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Heading from '@lucide/svelte/icons/heading';
	import IndentDecrease from '@lucide/svelte/icons/list-indent-decrease';
	import IndentIncrease from '@lucide/svelte/icons/list-indent-increase';
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import X from '@lucide/svelte/icons/x';
	import { draggable } from '$lib/dnd';

	interface Props {
		/** Zeile ab 0 – für die Beschriftungen */
		index: number;
		count: number;
		/** Was beim Ziehen mitkommt – die Ablagestellen erkennen die Zeile daran */
		dragKind: string;
		dragKey: number;
		/** Noch Platz für weitere Zeilen */
		canAdd: boolean;
		/** Einrücken möglich (direkt unter einer Überschrift bzw. deren Unterposition)? */
		canIndent?: boolean;
		indented?: boolean;
		onmove: (by: -1 | 1) => void;
		oninsert: (kind: 'position' | 'titel') => void;
		oncopy: () => void;
		onindent?: () => void;
		onremove: () => void;
	}
	let { index, count, dragKind, dragKey, canAdd, canIndent = false, indented = false, onmove, oninsert, oncopy, onindent, onremove }: Props = $props();

	let open = $state(false);
	let box: HTMLDivElement;

	$effect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => {
			if (!box.contains(e.target as Node)) open = false;
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		document.addEventListener('pointerdown', away, true);
		document.addEventListener('keydown', key);
		return () => {
			document.removeEventListener('pointerdown', away, true);
			document.removeEventListener('keydown', key);
		};
	});

	const pick = (fn: () => void) => () => {
		open = false;
		fn();
	};
	const row = $derived(index + 1);
</script>

<div class="relative flex items-center justify-end gap-0.5" bind:this={box}>
	<span class="tool cursor-grab touch-none" title="Zum Verschieben ziehen" aria-hidden="true" use:draggable={{ kind: dragKind, data: dragKey }}>
		<GripVertical size={15} />
	</span>
	<button type="button" class="tool" aria-label="Zeile {row} nach oben" disabled={index === 0} onclick={() => onmove(-1)}><ArrowUp size={15} /></button>
	<button type="button" class="tool" aria-label="Zeile {row} nach unten" disabled={index === count - 1} onclick={() => onmove(1)}><ArrowDown size={15} /></button>
	<button type="button" class="tool" aria-label="Weitere Aktionen für Zeile {row}" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>
		<Ellipsis size={15} />
	</button>
	<button type="button" class="tool hover:text-danger" aria-label="Zeile {row} entfernen" onclick={onremove}><X size={15} /></button>
	{#if open}
		<div class="menu" role="menu">
			<button type="button" role="menuitem" disabled={!canAdd} onclick={pick(() => oninsert('position'))}><ListPlus size={16} aria-hidden="true" />Position darunter einfügen</button>
			<button type="button" role="menuitem" disabled={!canAdd} onclick={pick(() => oninsert('titel'))}><Heading size={16} aria-hidden="true" />Überschrift darunter einfügen</button>
			<button type="button" role="menuitem" disabled={!canAdd} onclick={pick(oncopy)}><CopyPlus size={16} aria-hidden="true" />Kopieren</button>
			{#if onindent && (canIndent || indented)}
				<button type="button" role="menuitem" onclick={pick(onindent)}>
					{#if indented}
						<IndentDecrease size={16} aria-hidden="true" />Ausrücken – eigene Nummer
					{:else}
						<IndentIncrease size={16} aria-hidden="true" />Unter die Überschrift einrücken
					{/if}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool {
		display: grid;
		width: 1.875rem;
		height: 2rem;
		place-items: center;
		border-radius: 0.5rem;
		color: var(--c-ink-3);
	}
	.tool:hover:not(:disabled) {
		background: var(--c-surface-3);
	}
	.tool:disabled {
		opacity: 0.3;
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 30;
		display: grid;
		min-width: 15rem;
		padding: 0.25rem;
		border: 1px solid var(--c-line);
		border-radius: 12px;
		background: var(--c-surface);
		box-shadow: var(--shadow-3);
	}
	.menu button {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		text-align: left;
		font-size: 0.875rem;
		color: var(--c-ink);
	}
	.menu button:hover:not(:disabled) {
		background: var(--c-surface-2);
	}
	.menu button:disabled {
		opacity: 0.45;
	}
</style>
