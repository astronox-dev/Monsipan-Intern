<script lang="ts">
	/** Die eigenen Benachrichtigungen – ungelesene hervorgehoben, ein Tipp führt zur Stelle */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import Bell from '@lucide/svelte/icons/bell';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import Settings from '@lucide/svelte/icons/settings-2';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { relativeDateTime } from '$lib/format';
	import PushToggle from '$lib/components/PushToggle.svelte';

	let { data } = $props();
	const unread = $derived(data.items.filter((n) => !n.readAt).length);
</script>

<svelte:head><title>{pageTitle('Benachrichtigungen')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Bell size={26} aria-hidden="true" />Benachrichtigungen</h1>
		<p class="text-ink-2">{unread ? `${unread} ungelesen` : 'Alles gelesen'} · gelesene verschwinden nach 30 Tagen von selbst</p>
	</div>
	<div class="flex flex-wrap gap-2">
		{#if unread}
			<form method="POST" action="?/allRead" use:enhance={() => async ({ update }) => (await update(), await invalidate('app:notifications'))}>
				<button class="btn btn-secondary"><CheckCheck size={18} aria-hidden="true" />Alle gelesen</button>
			</form>
		{/if}
		<a href="/konto#benachrichtigungen" class="btn btn-ghost"><Settings size={18} aria-hidden="true" />Einstellungen</a>
	</div>
</div>

<div class="mb-4"><PushToggle compact /></div>

<div class="card overflow-hidden">
	<ul>
		{#each data.items as n (n.id)}
			<li class="border-b border-line last:border-0">
				<a href="/benachrichtigungen/{n.id}" class="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 {n.readAt ? '' : 'bg-brand-soft/40'}">
					<span class="mt-2 size-2 shrink-0 rounded-full {n.readAt ? 'bg-transparent' : 'bg-warn'}" aria-label={n.readAt ? undefined : 'ungelesen'}></span>
					<span class="min-w-0 flex-1">
						<span class="block {n.readAt ? 'font-medium' : 'font-semibold'}">{n.title}</span>
						{#if n.body}<span class="block text-sm text-ink-2">{n.body}</span>{/if}
						<span class="mt-0.5 block text-[0.8125rem] text-ink-3">{relativeDateTime(n.createdAt)}</span>
					</span>
					<ChevronRight size={18} class="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
				</a>
			</li>
		{:else}
			<li class="p-10 text-center">
				<p class="font-medium">Noch keine Benachrichtigungen</p>
				<p class="mt-1 text-sm text-ink-3">Was du bekommst, legt der Admin fest – abschalten kannst du einzelne unter Einstellungen.</p>
			</li>
		{/each}
	</ul>
</div>
