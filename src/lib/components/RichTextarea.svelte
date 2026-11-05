<script lang="ts">
	/**
	 * Textfeld mit Knöpfen für **fett** und __unterstrichen__ (auch Strg+B / Strg+U).
	 * Im Feld stehen die Zeichen, darunter die Vorschau, sobald etwas hervorgehoben ist.
	 */
	import Bold from '@lucide/svelte/icons/bold';
	import Underline from '@lucide/svelte/icons/underline';
	import { tick } from 'svelte';
	import { toggleMark } from '$lib/richtext';
	import RichText from './RichText.svelte';

	interface Props {
		name: string;
		value?: string;
		label: string;
		rows?: number;
		maxlength?: number;
		placeholder?: string;
		/** Wächst mit dem Inhalt */
		grow?: boolean;
		oninput?: () => void;
	}
	let { name, value = $bindable(''), label, rows = 3, maxlength = 5000, placeholder, grow = true, oninput }: Props = $props();

	let area: HTMLTextAreaElement;
	const id = $props.id();
	const marked = $derived(/(\*\*|__)\S/.test(value));

	async function mark(m: '**' | '__') {
		const next = toggleMark(value, area.selectionStart, area.selectionEnd, m);
		value = next.value;
		oninput?.();
		await tick();
		area.focus();
		area.setSelectionRange(next.start, next.end);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
		const k = e.key.toLowerCase();
		if (k === 'b' || k === 'u') {
			e.preventDefault();
			mark(k === 'b' ? '**' : '__');
		}
	}
</script>

<div class="block">
	<div class="flex items-end justify-between gap-2">
		<label class="field-label" for={id}>{label}</label>
		<div class="mb-1 flex gap-1" role="toolbar" aria-label="{label}: Hervorheben">
			<!-- onmousedown verhindert, dass das Feld die Auswahl verliert -->
			<button type="button" class="fmt" title="Fett (Strg+B)" aria-label="Fett" onmousedown={(e) => e.preventDefault()} onclick={() => mark('**')}><Bold size={15} /></button>
			<button type="button" class="fmt" title="Unterstrichen (Strg+U)" aria-label="Unterstrichen" onmousedown={(e) => e.preventDefault()} onclick={() => mark('__')}><Underline size={15} /></button>
		</div>
	</div>
	<textarea
		{id}
		class="textarea"
		class:grow
		{name}
		{rows}
		{maxlength}
		{placeholder}
		bind:this={area}
		bind:value
		{onkeydown}
		{oninput}
	></textarea>
	{#if marked}
		<div class="mt-1.5 rounded-lg bg-surface-2 px-3 py-2">
			<span class="text-[0.75rem] text-ink-3">So sieht es aus</span>
			<RichText class="text-sm text-ink-2" text={value} />
		</div>
	{/if}
</div>

<style>
	.grow {
		field-sizing: content;
		min-height: 2.5rem;
		resize: vertical;
	}
	.fmt {
		display: grid;
		width: 2rem;
		height: 1.75rem;
		place-items: center;
		border: 1px solid var(--c-line);
		border-radius: 0.5rem;
		color: var(--c-ink-2);
	}
	.fmt:hover {
		background: var(--c-surface-3);
		color: var(--c-ink);
	}
</style>
