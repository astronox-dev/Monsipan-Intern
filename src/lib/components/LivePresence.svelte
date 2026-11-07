<script lang="ts">
	/**
	 * Wer diese Seite gerade noch offen hat – oben rechts, nur wenn jemand da ist.
	 * Ein grüner Punkt: tippt gerade. Änderungen der anderen erscheinen von selbst.
	 */
	import { page } from '$app/state';
	import { othersOn } from '$lib/live.svelte';

	let { me }: { me: number } = $props();
	const others = $derived(othersOn(page.url.pathname, me));
	const initials = (name: string) =>
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase())
			.join('');
	const editing = $derived(others.filter((p) => p.editing));
</script>

{#if others.length}
	<div class="live print:hidden" role="status" aria-live="polite">
		<div class="flex -space-x-2">
			{#each others.slice(0, 4) as p (p.userId)}
				<span class="avatar" class:editing={p.editing} title="{p.name}{p.editing ? ' – bearbeitet gerade' : ' – hat die Seite offen'}">{initials(p.name)}</span>
			{/each}
			{#if others.length > 4}<span class="avatar">+{others.length - 4}</span>{/if}
		</div>
		<span class="min-w-0 truncate text-[0.8125rem] text-ink-2">
			{#if editing.length}
				{editing.map((p) => p.name.split(' ')[0]).join(', ')} {editing.length === 1 ? 'bearbeitet' : 'bearbeiten'} gerade mit
			{:else}
				Auch offen bei {others.map((p) => p.name.split(' ')[0]).join(', ')}
			{/if}
			· Änderungen erscheinen live
		</span>
	</div>
{/if}

<style>
	.live {
		position: sticky;
		top: 4.25rem;
		z-index: 15;
		display: flex;
		width: fit-content;
		max-width: 100%;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.5rem auto;
		padding: 0.25rem 0.75rem 0.25rem 0.375rem;
		border: 1px solid var(--c-line);
		border-radius: 999px;
		background: var(--c-surface);
		box-shadow: var(--shadow-2, 0 1px 3px rgb(0 0 0 / 0.12));
	}
	@media (min-width: 1024px) {
		.live {
			top: 0.75rem;
		}
	}
	.avatar {
		position: relative;
		display: grid;
		width: 1.75rem;
		height: 1.75rem;
		place-items: center;
		border: 2px solid var(--c-surface);
		border-radius: 999px;
		background: var(--c-surface-3);
		color: var(--c-ink);
		font-size: 0.6875rem;
		font-weight: 700;
	}
	.avatar.editing::after {
		content: '';
		position: absolute;
		right: -2px;
		bottom: -2px;
		width: 0.625rem;
		height: 0.625rem;
		border: 2px solid var(--c-surface);
		border-radius: 999px;
		background: var(--c-ok, #22a06b);
	}
</style>
