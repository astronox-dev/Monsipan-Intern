<script lang="ts">
	/**
	 * Ein Fahrzeug, ein Tag: die Strecke auf der Karte, daneben der Ablauf aus
	 * Fahrten und Standzeiten. Standzeiten sind nummeriert wie auf der Karte; was
	 * über Mitternacht geht, steht ganz da.
	 */
	import { pageTitle } from '$lib/app';
	import { goto, invalidate } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import FleetTabs from '$lib/modules/fuhrpark/components/FleetTabs.svelte';
	import VehicleMap from '$lib/modules/fuhrpark/components/VehicleMap.svelte';
	import { kindOf } from '$lib/modules/fuhrpark/kinds';
	import { distance, STOP_MINUTES } from '$lib/modules/fuhrpark/track';
	import { addDays } from '$lib/modules/stunden/week';

	let { data } = $props();
	const kind = $derived(kindOf(data.vehicle.kind));

	// Anschriften kommen nach und nach – solange welche fehlen, gleich noch einmal laden
	$effect(() => {
		if (!data.pending) return;
		const timer = setTimeout(() => invalidate('app:fahrzeuge'), 4000);
		return () => clearTimeout(timer);
	});

	const clock = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const dayClock = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' });
	const dayLong = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
	/** Uhrzeit – an einem anderen Tag (über Mitternacht) mit Datum */
	const t = (ms: number) => (isoDay.format(ms) === data.day ? clock.format(ms) : dayClock.format(ms));
	const duration = (min: number) => (min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${String(min % 60).padStart(2, '0')} Min.`);
	const km = (v: number) => `${v.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;

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
</script>

<svelte:head><title>{pageTitle(`${data.vehicle.name} – Fahrten`)}</title></svelte:head>

<a href="/fahrzeuge" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft size={16} aria-hidden="true" />Fahrzeuge</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><kind.icon size={28} aria-hidden="true" />{data.vehicle.name}</h1>
		<p class="text-ink-2">{[data.vehicle.plate, data.vehicle.driverName, data.vehicle.partyName].filter(Boolean).join(' · ') || 'Fahrten je Tag'}</p>
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

<FleetTabs />

<p class="mb-3 font-medium">{dayLong.format(new Date(`${data.day}T12:00:00Z`))}{data.day === data.today ? ' (heute)' : ''}</p>

{#if !data.items.length}
	<div class="card p-8 text-center">
		<p class="font-medium">An diesem Tag keine Standorte</p>
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
		{#key data.day}
			<VehicleMap track={data.track} stops={stopMarks} places={data.places} class="h-[55vh] lg:h-[calc(100dvh-18rem)]" />
		{/key}
		<section class="card self-start p-4" aria-labelledby="h-ablauf">
			<h2 id="h-ablauf" class="text-lg">Ablauf</h2>
			<ol class="mt-2 divide-y divide-line">
				{#each data.items as s (`${s.kind}-${s.from}`)}
					{#if s.kind === 'stopp'}
						<li class="flex items-start gap-3 py-2.5">
							<span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-mark font-display text-xs font-bold text-[#1b1f24]">{s.number}</span>
							<span class="min-w-0 flex-1">
								{#if s.where.place}
									<span class="flex items-center gap-1.5 font-semibold text-info"><Warehouse size={15} class="shrink-0" aria-hidden="true" />{s.where.place}</span>
								{:else}
									<span class="block font-medium">{s.where.label || 'Standzeit'}</span>
								{/if}
								<span class="num block text-sm text-ink-3">{t(s.from)} – {t(s.to)} Uhr · {duration(s.minutes)}</span>
							</span>
						</li>
					{:else}
						<li class="py-2.5 pl-9">
							<span class="num block text-sm font-medium">{t(s.from)} – {t(s.to)} Uhr · {km(s.km)} · {duration(Math.round((s.to - s.from) / 60_000))}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">{s.startWhere.label || 'Abfahrt'} → {s.endWhere.label || 'Ankunft'}</span>
						</li>
					{/if}
				{/each}
			</ol>
			<p class="field-hint mt-2">Halte unter {STOP_MINUTES} Minuten zählen zur Fahrt.</p>
		</section>
	</div>
{/if}
