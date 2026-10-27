<script lang="ts">
	import { page } from '$app/state';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import ScanBarcode from '@lucide/svelte/icons/scan-barcode';
	import { bottomTabs, isActive, type NavItem } from '$lib/nav';
	import { can, type Role } from '$lib/permissions';

	interface Props {
		role: Role;
		onscan: () => void;
		onmore: () => void;
		moreBadge?: number;
	}
	let { role, onscan, onmore, moreBadge = 0 }: Props = $props();

	const home: NavItem = { href: '/', label: 'Übersicht', icon: LayoutDashboard };
	/** Zwei Reiter je nach Rolle – Büro: Aufträge und Planung, Partie: Berichte und Stunden */
	const tabs = $derived(bottomTabs(role));
	/** Scannen sucht Artikel im Lager – nur, wer den Bestand sehen darf */
	const canScan = $derived(can(role, 'lager.bestand.sehen'));
</script>

{#snippet tab(t: NavItem)}
	{@const active = isActive(t.href, page.url.pathname)}
	<a
		href={t.href}
		aria-current={active ? 'page' : undefined}
		class="relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[0.6875rem] font-medium transition-colors {active
			? 'text-ink'
			: 'text-ink-3'}"
	>
		{#if active}<span class="absolute top-0 h-[3px] w-7 rounded-b-[2px] bg-mark" aria-hidden="true"></span>{/if}
		<span class="grid h-7 w-12 place-items-center">
			<t.icon size={21} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
		</span>
		{t.label}
	</a>
{/snippet}

<nav
	aria-label="Hauptnavigation"
	class="asphalt no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
>
	<div class="mx-auto flex h-16 max-w-lg items-stretch px-1">
		{@render tab(home)}
		{#if tabs[0]}{@render tab(tabs[0])}{/if}
		{#if canScan}
			<div class="flex flex-1 items-start justify-center">
				<button
					class="-mt-5 grid size-15 place-items-center rounded-full bg-brand text-brand-ink shadow-[0_8px_20px_-6px_rgb(0_0_0/0.35)] ring-4 ring-bg transition-transform active:scale-95"
					aria-label="Artikel scannen"
					onclick={onscan}
				>
					<ScanBarcode size={26} strokeWidth={2} aria-hidden="true" />
				</button>
			</div>
		{/if}
		{#if tabs[1]}{@render tab(tabs[1])}{/if}
		<button class="relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[0.6875rem] font-medium text-ink-3" onclick={onmore}>
			<span class="grid h-7 w-12 place-items-center rounded-full"><Ellipsis size={21} aria-hidden="true" /></span>
			Mehr
			{#if moreBadge > 0}
				<span class="absolute top-1.5 right-[calc(50%-1.25rem)] size-2.5 rounded-full bg-warn ring-2 ring-surface" aria-label="Hinweise vorhanden"></span>
			{/if}
		</button>
	</div>
</nav>
