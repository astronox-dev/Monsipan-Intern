<script lang="ts">
	/** Text mit **fett** und __unterstrichen__ anzeigen – Zeilenumbrüche bleiben */
	import { parseRich } from '$lib/richtext';

	let { text, class: cls = '' }: { text: string; class?: string } = $props();
	const lines = $derived(parseRich(text));
</script>

<p class={cls}>
	{#each lines as line, i (i)}{#if i > 0}<br />{/if}{#each line as s, j (j)}{#if s.bold && s.underline}<strong><u>{s.text}</u></strong>{:else if s.bold}<strong>{s.text}</strong>{:else if s.underline}<u>{s.text}</u>{:else}{s.text}{/if}{/each}{/each}
</p>

<style>
	strong {
		font-weight: 700;
		color: var(--c-ink);
	}
	u {
		text-underline-offset: 2px;
	}
</style>
