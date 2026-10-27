<script lang="ts">
	import { page } from '$app/state';
	import Logo from './Logo.svelte';
	import UserMenu from './UserMenu.svelte';
	import { isActive, visibleModules, type NavItem } from '$lib/nav';
	import type { Role } from '$lib/permissions';
	import type { Theme } from '$lib/theme';

	interface Props {
		user: { firstName: string; lastName: string; username: string; role: Role };
		lowStockCount: number;
		theme: Theme;
	}
	let { user, lowStockCount, theme }: Props = $props();

	const modules = $derived(visibleModules(user.role));
</script>

{#snippet item(n: NavItem)}
	{@const active = isActive(n.href, page.url.pathname)}
	<li>
		<a
			href={n.href}
			aria-current={active ? 'page' : undefined}
			class="group relative flex h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] transition-colors {active
				? 'bg-surface-3 font-semibold text-ink'
				: 'text-ink-2 hover:bg-surface-2 hover:text-ink'}"
		>
			{#if active}
				<span class="lane-v absolute top-2 bottom-2 -left-3 w-[3px] rounded-full" aria-hidden="true"></span>
			{/if}
			<n.icon size={19} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
			<!-- Lange Namen („Richtlinien & Vorschriften") brechen eng um, damit sie in die Zeile passen -->
			<span class="flex-1 leading-tight">{n.label}</span>
			{#if n.badge === 'lowStock' && lowStockCount > 0}
				<span class="badge badge-warn num h-5 min-w-5 justify-center px-1.5 text-xs" aria-label="{lowStockCount} Artikel nachbestellen">
					{lowStockCount}
				</span>
			{/if}
		</a>
	</li>
{/snippet}

<aside class="asphalt no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface text-ink lg:flex">
	<div class="px-5 pt-5 pb-6">
		<a href="/" aria-label="Zur Übersicht" class="inline-block rounded-lg"><Logo /></a>
	</div>
	<nav aria-label="Hauptnavigation" class="flex-1 overflow-y-auto px-3 pb-3">
		{#each modules as m, i (m.key)}
			{#if m.status === 'leer'}
				<!-- Kategorie steht schon da, Einträge folgen -->
				<p class="{i === 0 ? '' : 'mt-6'} mb-1.5 px-3 text-[0.8125rem] text-ink-3">{m.label}</p>
				<p class="px-3 text-[0.8125rem] text-ink-3 italic opacity-70">Noch keine Einträge</p>
			{:else if m.items.length}
				<p class="{i === 0 ? '' : 'mt-6'} mb-1.5 px-3 text-[0.8125rem] text-ink-3">{m.label}</p>
				<ul class="space-y-0.5">
					{#each m.items as n (n.href)}{@render item(n)}{/each}
				</ul>
			{:else}
				<ul class="space-y-0.5 {i === 0 ? '' : 'mt-6'}">
					{@render item({ href: m.href, label: m.label, icon: m.icon })}
				</ul>
			{/if}
		{/each}
	</nav>
	<div class="border-t border-line p-3">
		<UserMenu {user} {theme} />
	</div>
</aside>
