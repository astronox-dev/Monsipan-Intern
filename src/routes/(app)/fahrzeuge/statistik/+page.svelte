<script lang="ts">
	/**
	 * Statistik: Strecke, Fahrzeit und Fahrten des Fuhrparks – oben die Summen,
	 * darunter je Tag und je Fahrzeug, dazu die Zeit an den festen Orten.
	 */
	import { pageTitle } from '$lib/app';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import BarChart from '$lib/components/BarChart.svelte';
	import FleetTabs from '$lib/modules/fuhrpark/components/FleetTabs.svelte';
	import { kindOf } from '$lib/modules/fuhrpark/kinds';

	let { data } = $props();
	const stats = $derived(data.stats);

	const km = (v: number) => `${v.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
	const hours = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std.`;
	const short = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
	const long = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
	const dayChart = $derived(
		stats.days.map((d) => {
			const when = new Date(`${d.date}T12:00:00Z`);
			return { key: d.date, label: short.format(when), longLabel: long.format(when), value: d.km };
		})
	);
	/** Die Balken beziehen sich auf den jeweils längsten */
	const topKm = $derived(Math.max(1, ...stats.vehicles.map((v) => v.km)));
	const topDriving = $derived(Math.max(1, ...stats.vehicles.map((v) => v.driving)));
	const topPlace = $derived(Math.max(1, ...stats.places.map((p) => p.minutes)));
	const perVehicle = $derived(stats.vehicles.length ? stats.km / stats.vehicles.length : 0);
</script>

<svelte:head><title>{pageTitle('Fuhrpark-Statistik')}</title></svelte:head>

{#snippet bar(share: number, label: string)}
	<span class="flex items-center gap-2">
		<span class="h-2 min-w-0 flex-1 rounded-r-[4px] bg-surface-3" aria-hidden="true">
			<span class="block h-full rounded-r-[4px] bg-info" style="width: {Math.max(share * 100, share > 0 ? 1 : 0)}%"></span>
		</span>
		<span class="num w-24 shrink-0 text-right text-sm">{label}</span>
	</span>
{/snippet}

<div class="pb-5">
	<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><ChartColumn size={28} aria-hidden="true" />Statistik</h1>
	<p class="text-ink-2">Strecke und Fahrzeit des Fuhrparks, laut Tablets in den Fahrzeugen.</p>
</div>

<FleetTabs />

<div class="mb-4 flex w-fit rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Zeitraum">
	{#each data.periods as p (p.key)}
		<a
			href="?zeit={p.key}"
			role="tab"
			aria-selected={data.period === p.key}
			data-sveltekit-noscroll
			class="rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors {data.period === p.key ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-3 hover:text-ink'}">{p.label}</a
		>
	{/each}
</div>

<section class="card mb-4 grid grid-cols-2 gap-px overflow-hidden bg-line lg:grid-cols-4" aria-label="Summen">
	<div class="bg-surface p-4">
		<p class="text-sm text-ink-2">Strecke</p>
		<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{km(stats.km)}</p>
	</div>
	<div class="bg-surface p-4">
		<p class="text-sm text-ink-2">Fahrzeit</p>
		<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{hours(stats.driving)}</p>
	</div>
	<div class="bg-surface p-4">
		<p class="text-sm text-ink-2">Fahrten</p>
		<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{stats.trips}</p>
	</div>
	<div class="bg-surface p-4">
		<p class="text-sm text-ink-2">Ø je Fahrzeug</p>
		<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{km(Math.round(perVehicle * 10) / 10)}</p>
	</div>
</section>

{#if stats.days.length > 1}
	<section class="card mb-4 p-4">
		<BarChart data={dayChart} unit="km" title="Strecke je Tag" />
	</section>
{/if}

<div class="grid gap-4 xl:grid-cols-2">
	<section class="card p-4" aria-labelledby="h-strecke">
		<h2 id="h-strecke" class="text-lg">Strecke je Fahrzeug</h2>
		{#if stats.vehicles.length}
			<ul class="mt-2 space-y-2.5">
				{#each stats.vehicles as v (v.id)}
					{@const kind = kindOf(v.kind)}
					<li title="{v.trips} Fahrten">
						<a href="/fahrzeuge/{v.id}" class="flex items-center gap-1.5 truncate text-sm font-medium hover:underline"
							><kind.icon size={15} class="shrink-0 text-ink-3" aria-hidden="true" />{v.name}</a
						>
						{@render bar(v.km / topKm, km(v.km))}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-sm text-ink-3">Noch keine Fahrzeuge.</p>
		{/if}
	</section>

	<section class="card p-4" aria-labelledby="h-zeit">
		<h2 id="h-zeit" class="text-lg">Fahrzeit je Fahrzeug</h2>
		{#if stats.vehicles.length}
			<ul class="mt-2 space-y-2.5">
				{#each stats.vehicles as v (v.id)}
					<li>
						<span class="flex items-baseline justify-between gap-2 text-sm"
							><span class="truncate font-medium">{v.name}</span>{#if v.topSpeed != null}<span class="num shrink-0 text-ink-3">bis {v.topSpeed} km/h</span>{/if}</span
						>
						{@render bar(v.driving / topDriving, hours(v.driving))}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-sm text-ink-3">Noch keine Fahrzeuge.</p>
		{/if}
	</section>

	<section class="card p-4 xl:col-span-2" aria-labelledby="h-orte">
		<h2 id="h-orte" class="text-lg">Zeit an festen Orten</h2>
		{#if stats.places.length}
			<ul class="mt-2 space-y-2.5">
				{#each stats.places as p (p.name)}
					<li>
						<span class="flex items-baseline justify-between gap-2 text-sm"
							><span class="truncate font-medium">{p.name}</span><span class="num shrink-0 text-ink-3">{p.visits === 1 ? '1 Besuch' : `${p.visits} Besuche`}</span></span
						>
						{@render bar(p.minutes / topPlace, hours(p.minutes))}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-sm text-ink-3">
				In diesem Zeitraum stand kein Auto an einem festen Ort.
				<a href="/fahrzeuge/orte" class="underline decoration-mark decoration-2 underline-offset-4">Orte anlegen</a>
			</p>
		{/if}
	</section>
</div>
