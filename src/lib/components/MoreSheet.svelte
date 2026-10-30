<script lang="ts">
	/**
	 * „Mehr" am Handy: alle Bereiche, gegliedert wie die Seitenleiste – je
	 * Bereich eine Überschrift, darunter die Seiten in zwei Spalten.
	 */
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import UserRound from '@lucide/svelte/icons/user-round';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Dialog from './Dialog.svelte';
	import { badgeCount, isActive, NAV_BADGES, visibleModules, type NavBadges, type NavItem } from '$lib/nav';
	import { fullName, initials } from '$lib/format';
	import { ROLE_LABELS, type Role } from '$lib/permissions';
	import { install } from '$lib/install.svelte';
	import { setTheme, type Theme } from '$lib/theme';

	interface Props {
		open: boolean;
		user: { firstName: string; lastName: string; username: string; role: Role };
		badges: NavBadges;
		theme: Theme;
	}
	let { open = $bindable(), user, badges, theme }: Props = $props();

	/** Bereiche mit ihren Seiten; die Übersicht steht ohnehin in der Leiste */
	const groups = $derived(
		visibleModules(user.role)
			.filter((m) => m.status === 'aktiv' && m.items.length)
			.map((m) => ({ key: m.key, label: m.label, items: m.items }))
	);

	const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
		{ value: 'light', label: 'Hell', icon: Sun },
		{ value: 'dark', label: 'Dunkel', icon: Moon },
		{ value: 'system', label: 'System', icon: Monitor }
	];
</script>

{#snippet link(n: NavItem)}
	{@const active = isActive(n.href, page.url.pathname)}
	{@const count = badgeCount(n, badges)}
	<li>
		<a
			href={n.href}
			aria-current={active ? 'page' : undefined}
			class="flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-2 transition-colors {active
				? 'bg-surface-3 font-semibold text-ink ring-1 ring-brand/70'
				: 'bg-surface-2 font-medium text-ink hover:bg-surface-3'}"
			onclick={() => (open = false)}
		>
			<n.icon size={19} class="shrink-0 {active ? 'text-ink' : 'text-ink-2'}" aria-hidden="true" />
			<span class="min-w-0 flex-1 text-[0.875rem] leading-tight hyphens-auto">{n.label}</span>
			{#if n.badge && count > 0}
				<span class="badge {NAV_BADGES[n.badge].tone} num shrink-0" aria-label={NAV_BADGES[n.badge].label(count)}>{count}</span>
			{/if}
		</a>
	</li>
{/snippet}

<Dialog bind:open title="Menü">
	<div class="-mx-2 flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
		<span class="grid size-11 place-items-center rounded-full bg-ink font-display font-semibold text-surface">{initials(user)}</span>
		<div class="min-w-0 flex-1">
			<p class="truncate font-semibold">{fullName(user)}</p>
			<p class="text-sm text-ink-3">{ROLE_LABELS[user.role]}</p>
		</div>
		<a href="/konto" class="btn btn-secondary btn-sm" onclick={() => (open = false)}><UserRound size={16} aria-hidden="true" />Konto</a>
	</div>

	{#each groups as g (g.key)}
		<p class="mt-4 mb-1.5 px-1 text-[0.8125rem] font-medium text-ink-3">{g.label}</p>
		<ul class="grid grid-cols-2 gap-1.5">
			{#each g.items as n (n.href)}{@render link(n)}{/each}
		</ul>
	{/each}
	{#if install.suggest}
		<ul class="mt-4 grid grid-cols-2 gap-1.5">
			{@render link({ href: '/app', label: 'App installieren', icon: Smartphone })}
		</ul>
	{/if}

	<p class="mt-4 mb-2 text-sm text-ink-3" id="m-theme">Darstellung</p>
	<div class="grid grid-cols-3 gap-1 rounded-xl bg-surface-3 p-1" role="group" aria-labelledby="m-theme">
		{#each themes as t (t.value)}
			<button
				class="flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium {theme === t.value ? 'bg-surface shadow-sm' : 'text-ink-2'}"
				aria-pressed={theme === t.value}
				onclick={async () => {
					setTheme(t.value);
					await invalidateAll();
				}}
			>
				<t.icon size={16} aria-hidden="true" />{t.label}
			</button>
		{/each}
	</div>

	<form method="POST" action="/logout" class="mt-5">
		<button class="btn w-full border-line text-danger hover:bg-danger-soft"><LogOut size={18} aria-hidden="true" />Abmelden</button>
	</form>
</Dialog>
