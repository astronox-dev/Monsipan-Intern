<script lang="ts">
	/** Die Seiten des Fuhrparks: Karte, Fahrtenbuch, Statistik und feste Orte */
	import { page } from '$app/state';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import MapIcon from '@lucide/svelte/icons/map';
	import Warehouse from '@lucide/svelte/icons/warehouse';

	const TABS = [
		{ href: '/fahrzeuge', label: 'Karte', icon: MapIcon },
		{ href: '/fahrzeuge/fahrtenbuch', label: 'Fahrtenbuch', icon: BookOpen },
		{ href: '/fahrzeuge/statistik', label: 'Statistik', icon: ChartColumn },
		{ href: '/fahrzeuge/orte', label: 'Orte', icon: Warehouse }
	];
</script>

<nav class="mb-4 inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-1" aria-label="Fuhrpark">
	{#each TABS as t (t.href)}
		{@const active = page.url.pathname === t.href}
		<a
			href={t.href}
			aria-current={active ? 'page' : undefined}
			class="flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors {active ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
		>
			<t.icon size={16} aria-hidden="true" />{t.label}
		</a>
	{/each}
</nav>
