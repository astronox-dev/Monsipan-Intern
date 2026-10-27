<script lang="ts">
	/** Ein Fahrzeug, ein Tag: die gefahrene Strecke auf der Karte, Kilometer und Standzeiten */
	import { pageTitle } from '$lib/app';
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import VehicleMap from '$lib/modules/fuhrpark/components/VehicleMap.svelte';
	import { addDays } from '$lib/modules/stunden/week';

	let { data } = $props();

	const clock = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const dayLong = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
	const t = (ms: number) => clock.format(ms);
	const duration = (min: number) => (min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${String(min % 60).padStart(2, '0')} Min.`);
	const km = (v: number) => `${String(v).replace('.', ',')} km`;
	const standing = $derived(data.stops.reduce((s, x) => s + x.minutes, 0));
	const stopMarks = $derived(data.stops.map((s) => ({ lat: s.lat, lon: s.lon, label: `${t(s.from)} – ${t(s.to)} Uhr (${duration(s.minutes)})` })));
	const go = (day: string) => goto(`?tag=${day}`, { noScroll: true, keepFocus: true });
</script>

<svelte:head><title>{pageTitle(`${data.vehicle.name} – Fahrten`)}</title></svelte:head>

<a href="/fahrzeuge" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft size={16} aria-hidden="true" />Fahrzeuge</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">{data.vehicle.name}</h1>
		<p class="text-ink-2">{[data.vehicle.plate, data.vehicle.partyName].filter(Boolean).join(' · ') || 'Fahrten je Tag'}</p>
	</div>
	<div class="flex items-center gap-2">
		<button class="btn btn-secondary btn-icon" aria-label="Tag davor" disabled={data.day <= data.oldest} onclick={() => go(addDays(data.day, -1))}>
			<ChevronLeft size={18} />
		</button>
		<input
			class="input num w-auto"
			type="date"
			aria-label="Tag"
			min={data.oldest}
			max={data.today}
			value={data.day}
			onchange={(e) => e.currentTarget.value && go(e.currentTarget.value)}
		/>
		<button class="btn btn-secondary btn-icon" aria-label="Tag danach" disabled={data.day >= data.today} onclick={() => go(addDays(data.day, 1))}>
			<ChevronRight size={18} />
		</button>
	</div>
</div>

<p class="mb-3 font-medium">{dayLong.format(new Date(`${data.day}T12:00:00Z`))}{data.day === data.today ? ' (heute)' : ''}</p>

{#if !data.count}
	<div class="card p-8 text-center">
		<p class="font-medium">An diesem Tag keine Standorte</p>
		<p class="mt-1 text-sm text-ink-3">Das Tablet hat nichts geschickt – etwa ausgeschaltet, ohne Netz oder noch nicht gekoppelt.</p>
	</div>
{:else}
	<section class="card mb-4 grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4" aria-label="Zusammenfassung">
		<div class="bg-surface p-4">
			<p class="text-sm text-ink-2">Gefahren</p>
			<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{km(data.km)}</p>
		</div>
		<div class="bg-surface p-4">
			<p class="text-sm text-ink-2">Erster Standort</p>
			<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{t(data.first!)}</p>
		</div>
		<div class="bg-surface p-4">
			<p class="text-sm text-ink-2">Letzter Standort</p>
			<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{t(data.last!)}</p>
		</div>
		<div class="bg-surface p-4">
			<p class="text-sm text-ink-2">Standzeiten</p>
			<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{data.stops.length}</p>
			<p class="mt-1 text-[0.8125rem] text-ink-3">{standing ? `zusammen ${duration(standing)}` : 'ab 5 Minuten'}</p>
		</div>
	</section>

	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
		{#key data.day}
			<VehicleMap track={data.track} stops={stopMarks} class="h-[55vh] lg:h-[calc(100dvh-18rem)]" />
		{/key}
		<section class="card self-start p-4" aria-labelledby="h-stopps">
			<h2 id="h-stopps" class="text-lg">Standzeiten</h2>
			{#if data.stops.length}
				<ol class="mt-2 divide-y divide-line">
					{#each data.stops as s, i (i)}
						<li class="flex items-center gap-3 py-2">
							<MapPin size={16} class="shrink-0 text-info" aria-hidden="true" />
							<span class="num min-w-0 flex-1">{t(s.from)} – {t(s.to)} Uhr</span>
							<span class="num text-sm text-ink-3">{duration(s.minutes)}</span>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="mt-1 text-sm text-ink-3">Keine – das Auto ist nirgends länger als 5 Minuten gestanden.</p>
			{/if}
		</section>
	</div>
{/if}
