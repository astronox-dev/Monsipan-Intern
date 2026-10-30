<script lang="ts">
	/**
	 * Ein Fahrzeug, ein Zeitraum oder ein Tag: die Strecke auf der Karte, daneben
	 * der Ablauf – das Neueste oben, je Fahrt Ankunft und Abfahrt, dazwischen die
	 * Standzeiten, nummeriert wie auf der Karte. Was über Mitternacht geht, steht
	 * ganz da.
	 */
	import { pageTitle } from '$lib/app';
	import { goto, invalidate } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Flag from '@lucide/svelte/icons/flag';
	import Play from '@lucide/svelte/icons/play';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import FleetTabs from '$lib/modules/fuhrpark/components/FleetTabs.svelte';
	import PeriodTabs from '$lib/modules/fuhrpark/components/PeriodTabs.svelte';
	import VehicleMap from '$lib/modules/fuhrpark/components/VehicleMap.svelte';
	import { kindOf } from '$lib/modules/fuhrpark/kinds';
	import { distance, STOP_MINUTES } from '$lib/modules/fuhrpark/track';
	import { addDays } from '$lib/modules/stunden/week';

	let { data } = $props();
	const kind = $derived(kindOf(data.vehicle.kind));

	// Anschriften kommen nach und nach – solange welche fehlen, gleich noch einmal laden
	$effect(() => {
		if (!data.pending) return;
		const timer = setTimeout(() => invalidate('app:ablauf'), 4000);
		return () => clearTimeout(timer);
	});

	const clock = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const dayClock = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const shortDay = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Vienna' });
	const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' });
	const dayLong = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
	/** Uhrzeit – über mehrere Tage und über Mitternacht mit Datum */
	const t = (ms: number) => (data.single && isoDay.format(ms) === data.from ? clock.format(ms) : dayClock.format(ms));
	const duration = (min: number) => (min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${String(min % 60).padStart(2, '0')} Min.`);
	/** „2 h 27 min 37 s" – führende Nullen fallen weg, ab einem Tag mit „d" */
	const parkTime = (ms: number) => {
		const s = Math.round(ms / 1000);
		const parts: [number, string][] = [
			[Math.floor(s / 86_400), 'd'],
			[Math.floor(s / 3600) % 24, 'h'],
			[Math.floor(s / 60) % 60, 'min'],
			[s % 60, 's']
		];
		const first = parts.findIndex(([n]) => n > 0);
		return first < 0 ? '0 s' : parts.slice(first).map(([n, unit]) => `${n} ${unit}`).join(' ');
	};
	const km = (v: number) => `${v.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;

	/** Der Ablauf: das Neueste oben */
	const newestFirst = $derived([...data.items].reverse());
	const trips = $derived(data.items.filter((s) => s.kind === 'fahrt'));
	const parked = $derived(data.items.filter((s) => s.kind === 'stopp'));
	const totalKm = $derived(Math.round(trips.reduce((s, x) => s + x.km, 0) * 10) / 10);
	const drivingMin = $derived(Math.round(trips.reduce((s, x) => s + (x.to - x.from), 0) / 60_000));
	/** Mehrmals am selben Ort: eine Marke mit allen Nummern, sonst läge eine auf der anderen */
	const stopMarks = $derived.by(() => {
		const marks: { lat: number; lon: number; number: string; label: string }[] = [];
		for (const s of parked) {
			const label = `${s.number}. ${s.where.label ? `${s.where.label} · ` : ''}${t(s.from)} – ${t(s.to)} Uhr (${duration(s.minutes)})`;
			const same = marks.find((m) => distance(m, s) < 60);
			if (same) {
				same.number += ` · ${s.number}`;
				same.label += ` | ${label}`;
			} else marks.push({ lat: s.lat, lon: s.lon, number: String(s.number), label });
		}
		return marks;
	});
	const go = (day: string) => goto(`?tag=${day}`, { noScroll: true, keepFocus: true });
	const shortYear = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
	const heading = $derived(
		data.single
			? `${dayLong.format(new Date(`${data.from}T12:00:00Z`))}${data.from === data.today ? ' (heute)' : ''}`
			: `${shortYear.format(new Date(`${data.from}T12:00:00Z`))} – ${shortYear.format(new Date(`${data.to}T12:00:00Z`))}`
	);
</script>

<svelte:head><title>{pageTitle(`${data.vehicle.name} – Fahrten`)}</title></svelte:head>

{#snippet stamp(at: number, where: { place: string | null; label: string }, end: 'Ankunft' | 'Abfahrt')}
	<div class="grid grid-cols-[3.25rem_1.5rem_minmax(0,1fr)] items-start gap-x-2">
		<span class="num text-sm leading-tight">
			{clock.format(at)}
			<span class="block text-xs text-ink-3">{shortDay.format(at)}</span>
		</span>
		<span class="relative grid size-6 place-items-center rounded-full bg-ink text-surface" title={end}>
			{#if end === 'Ankunft'}<Flag size={13} aria-hidden="true" />{:else}<Play size={13} fill="currentColor" aria-hidden="true" />{/if}
			<span class="sr-only">{end}</span>
		</span>
		{#if where.place}
			<span class="flex items-center gap-1.5 text-sm leading-tight font-semibold text-info"><Warehouse size={15} class="shrink-0" aria-hidden="true" />{where.place}</span>
		{:else}
			<span class="text-sm leading-tight">{where.label || `${end} – Anschrift folgt`}</span>
		{/if}
	</div>
{/snippet}

<a href="/fahrzeuge" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft size={16} aria-hidden="true" />Fahrzeuge</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><kind.icon size={28} aria-hidden="true" />{data.vehicle.name}</h1>
		<p class="text-ink-2">{[data.vehicle.plate, data.vehicle.driverName, data.vehicle.partyName].filter(Boolean).join(' · ') || 'Fahrten je Tag'}</p>
	</div>
</div>

<FleetTabs />

<div class="mb-4 flex flex-wrap items-center gap-3">
	<PeriodTabs active={data.period} />
	<div class="flex items-center gap-2">
		{#if data.single}
			<button class="btn btn-secondary btn-icon" aria-label="Tag davor" disabled={data.from <= data.oldest} onclick={() => go(addDays(data.from, -1))}>
				<ChevronLeft size={18} />
			</button>
		{/if}
		<input
			class="input num w-auto"
			type="date"
			aria-label="Bestimmter Tag"
			min={data.oldest}
			max={data.today}
			value={data.single ? data.from : ''}
			onchange={(e) => e.currentTarget.value && go(e.currentTarget.value)}
		/>
		{#if data.single}
			<button class="btn btn-secondary btn-icon" aria-label="Tag danach" disabled={data.from >= data.today} onclick={() => go(addDays(data.from, 1))}>
				<ChevronRight size={18} />
			</button>
		{/if}
	</div>
</div>

<p class="mb-3 font-medium">{heading}</p>

{#if !data.items.length}
	<div class="card p-8 text-center">
		<p class="font-medium">{data.single ? 'An diesem Tag keine Standorte' : 'In diesem Zeitraum keine Standorte'}</p>
		<p class="mt-1 text-sm text-ink-3">Das Tablet hat nichts geschickt – etwa ausgeschaltet, ohne Netz oder noch nicht gekoppelt.</p>
	</div>
{:else}
	<section class="card mb-4 grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4" aria-label="Zusammenfassung">
		<div class="bg-surface p-4">
			<p class="text-sm text-ink-2">Gefahren</p>
			<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{km(totalKm)}</p>
		</div>
		<div class="bg-surface p-4">
			<p class="text-sm text-ink-2">Fahrzeit</p>
			<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{duration(drivingMin)}</p>
		</div>
		<div class="bg-surface p-4">
			<p class="text-sm text-ink-2">Fahrten</p>
			<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{trips.length}</p>
		</div>
		<div class="bg-surface p-4">
			<p class="text-sm text-ink-2">Standzeiten</p>
			<p class="num mt-1 font-display text-[1.75rem] leading-none font-semibold">{parked.length}</p>
			<p class="mt-1 text-[0.8125rem] text-ink-3">ab {STOP_MINUTES} Minuten</p>
		</div>
	</section>

	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
		{#key `${data.from}/${data.to}`}
			<VehicleMap track={data.track} stops={stopMarks} places={data.places} class="h-[55vh] lg:h-[calc(100dvh-18rem)]" />
		{/key}
		<section class="card self-start overflow-hidden lg:max-h-[calc(100dvh-18rem)] lg:overflow-y-auto" aria-labelledby="h-ablauf">
			<h2 id="h-ablauf" class="px-4 pt-3 pb-2 text-lg">Ablauf</h2>
			<ol class="border-t border-line">
				{#each newestFirst as s (`${s.kind}-${s.from}`)}
					{#if s.kind === 'stopp'}
						<li class="flex items-center gap-2 bg-surface-3 px-3 py-1.5" title="{t(s.from)} – {t(s.to)} Uhr">
							<span class="grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-mark font-display text-xs font-bold text-[#1b1f24]">{s.number}</span>
							<span class="grid size-5 shrink-0 place-items-center rounded-[4px] bg-ink-3 font-display text-xs font-bold text-surface" aria-hidden="true">P</span>
							<span class="num text-sm font-semibold">{parkTime(s.to - s.from)}</span>
							{#if !trips.length && s.where.label}<span class="min-w-0 truncate text-sm text-ink-2">{s.where.label}</span>{/if}
						</li>
					{:else}
						<li class="flex border-b border-line last:border-0">
							<div class="relative min-w-0 flex-1 space-y-3 p-3">
								<!-- Die Linie zwischen Ankunft und Abfahrt läuft hinter den beiden Punkten -->
								<span class="absolute top-6 bottom-6 left-[calc(0.75rem+3.25rem+0.5rem+0.75rem-1px)] w-0.5 bg-ink" aria-hidden="true"></span>
								{@render stamp(s.to, s.endWhere, 'Ankunft')}
								{@render stamp(s.from, s.startWhere, 'Abfahrt')}
							</div>
							<div class="num flex w-20 shrink-0 flex-col items-center justify-center gap-0.5 bg-surface-2 px-1 text-center text-[0.8125rem]">
								<span class="font-semibold">{km(s.km)}</span>
								<span class="text-ink-3">{duration(Math.round((s.to - s.from) / 60_000))}</span>
							</div>
						</li>
					{/if}
				{/each}
			</ol>
			<p class="field-hint border-t border-line px-4 py-2">Halte unter {STOP_MINUTES} Minuten zählen zur Fahrt.</p>
		</section>
	</div>
{/if}
