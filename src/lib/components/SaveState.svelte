<script lang="ts">
	/**
	 * Stand des automatischen Speicherns. `compact`: eine Zeile neben dem
	 * Speichern-Knopf; sonst der Hinweis, wenn inzwischen jemand anderer
	 * gespeichert hat – mit der Wahl, neu zu laden oder die eigene Fassung zu behalten.
	 */
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CloudCheck from '@lucide/svelte/icons/cloud-check';
	import Users from '@lucide/svelte/icons/users';
	import { autosaveLabel, type Autosave } from '$lib/autosave.svelte';

	let { saver, doc, what, compact = false }: { saver: Autosave; doc?: { lastRemote: { by: string; at: Date } | null } | null; what: string; compact?: boolean } = $props();
	const label = $derived(autosaveLabel(saver));
	const time = (d: Date) => d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
</script>

{#if compact}
	{#if label}
		<span class="flex items-center gap-1.5 text-sm {saver.state === 'error' || saver.state === 'conflict' ? 'text-danger' : 'text-ink-3'}" aria-live="polite">
			{#if saver.state === 'saved'}<CloudCheck size={16} aria-hidden="true" />{/if}{label}
		</span>
	{/if}
	{#if doc?.lastRemote}
		<span class="flex items-center gap-1.5 text-sm text-ink-3" aria-live="polite">
			<Users size={16} aria-hidden="true" />Änderung von {doc.lastRemote.by} übernommen {time(doc.lastRemote.at)}
		</span>
	{/if}
{:else if saver.state === 'conflict'}
	<!-- Bleibt beim Scrollen oben sichtbar -->
	<section class="card sticky top-20 z-20 mb-4 border-warn/60 p-4 shadow-lg lg:p-5" role="alert">
		<p class="flex items-center gap-2 font-medium"><CircleAlert size={20} class="shrink-0 text-warn" aria-hidden="true" />{saver.conflictBy} hat {what} inzwischen gespeichert.</p>
		<p class="mt-1 text-sm text-ink-2">
			Deine Änderungen sind noch nicht gespeichert. Neu laden zeigt die andere Fassung (deine Änderungen gehen dabei verloren) – oder deine Fassung speichern,
			dann ist die andere überschrieben. Am besten kurz absprechen.
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<button type="button" class="btn btn-secondary" onclick={() => location.reload()}>Neu laden</button>
			<button type="button" class="btn btn-ghost text-danger hover:bg-danger-soft" onclick={() => saver.keepMine()}>Meine Fassung speichern</button>
		</div>
	</section>
{/if}
