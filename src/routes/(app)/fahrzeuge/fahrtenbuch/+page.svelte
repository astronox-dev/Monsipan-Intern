<script lang="ts">
	/**
	 * Fahrtenbuch: jede Fahrt mit Abfahrt, Ankunft, Strecke und Fahrer. Fahrten
	 * werden nicht am Tagesende geschnitten – wer über Mitternacht fährt, hat eine
	 * Fahrt, eingetragen am Tag ihres Beginns.
	 */
	import { pageTitle } from '$lib/app';
	import { invalidate } from '$app/navigation';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Download from '@lucide/svelte/icons/download';
	import { liveSubmit } from '$lib/live-search';
	import FleetTabs from '$lib/modules/fuhrpark/components/FleetTabs.svelte';
	import PeriodTabs from '$lib/modules/fuhrpark/components/PeriodTabs.svelte';

	let { data } = $props();

	// Anschriften kommen nach und nach – solange welche fehlen, gleich noch einmal laden
	$effect(() => {
		if (!data.pending) return;
		const timer = setTimeout(() => invalidate('app:fahrtenbuch'), 4000);
		return () => clearTimeout(timer);
	});

	const stamp = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const km = (v: number) => `${v.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
	const duration = (ms: number) => {
		const min = Math.round(ms / 60_000);
		return min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${String(min % 60).padStart(2, '0')} Min.`;
	};
	const exportHref = $derived(`/fahrzeuge/fahrtenbuch/export?von=${data.range.from}&bis=${data.range.to}${data.vehicle ? `&fahrzeug=${data.vehicle}` : ''}`);
</script>

<svelte:head><title>{pageTitle('Fahrtenbuch')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pb-5">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><BookOpen size={28} aria-hidden="true" />Fahrtenbuch</h1>
		<p class="text-ink-2">Jede Fahrt von der Abfahrt bis zur Ankunft – über Mitternacht in einem Stück.</p>
	</div>
	<a href={exportHref} class="btn btn-secondary" data-sveltekit-reload><Download size={18} aria-hidden="true" />Herunterladen (CSV)</a>
</div>

<FleetTabs />

<div class="mb-4"><PeriodTabs active={data.range.period} keep={data.vehicle ? `&fahrzeug=${data.vehicle}` : ''} /></div>

<form method="GET" class="card mb-4 flex flex-wrap items-end gap-3 p-3">
	<label>
		<span class="field-label">von</span>
		<input class="input num" type="date" name="von" min={data.range.oldest} max={data.range.today} value={data.range.from} onchange={(e) => liveSubmit(e.currentTarget.form)} />
	</label>
	<label>
		<span class="field-label">bis</span>
		<input class="input num" type="date" name="bis" min={data.range.oldest} max={data.range.today} value={data.range.to} onchange={(e) => liveSubmit(e.currentTarget.form)} />
	</label>
	<label class="min-w-[12rem]">
		<span class="field-label">Fahrzeug</span>
		<select class="select" name="fahrzeug" value={data.vehicle ? String(data.vehicle) : ''} onchange={(e) => liveSubmit(e.currentTarget.form)}>
			<option value="">Alle Fahrzeuge</option>
			{#each data.vehicles as v (v.id)}<option value={String(v.id)}>{v.name}</option>{/each}
		</select>
	</label>
	<p class="num ml-auto pb-2 text-sm text-ink-2">{data.entries.length === 1 ? '1 Fahrt' : `${data.entries.length} Fahrten`} · {km(data.km)}</p>
</form>

{#if data.entries.length}
	<div class="card overflow-x-auto">
		<table class="w-full min-w-[56rem] text-sm">
			<thead>
				<tr class="border-b border-line text-left text-ink-3">
					<th scope="col" class="px-3 py-2 font-medium">Zeit</th>
					<th scope="col" class="px-3 py-2 font-medium">Abfahrt und Ankunft</th>
					<th scope="col" class="px-3 py-2 text-right font-medium">Strecke</th>
					<th scope="col" class="px-3 py-2 text-right font-medium">Dauer</th>
					<th scope="col" class="px-3 py-2 font-medium">Fahrer</th>
					<th scope="col" class="px-3 py-2 font-medium">Fahrzeug</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-line">
				{#each data.entries as e (e.key)}
					<tr class="align-top">
						<td class="num px-3 py-2 whitespace-nowrap">
							<span class="block">{stamp.format(e.from)}</span>
							<span class="block text-ink-3">{stamp.format(e.to)}</span>
						</td>
						<td class="px-3 py-2">
							<span class="block">{e.start || 'Anschrift folgt'}</span>
							<span class="block text-ink-3">{e.end || 'Anschrift folgt'}</span>
						</td>
						<td class="num px-3 py-2 text-right whitespace-nowrap">{km(e.km)}</td>
						<td class="num px-3 py-2 text-right whitespace-nowrap">{duration(e.to - e.from)}</td>
						<td class="px-3 py-2">{e.driver || '–'}</td>
						<td class="px-3 py-2">
							<a href="/fahrzeuge/{e.vehicleId}" class="font-medium hover:underline">{e.vehicleName}</a>
							{#if e.plate}<span class="block text-ink-3">{e.plate}</span>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<div class="card p-8 text-center">
		<p class="font-medium">Keine Fahrten in diesem Zeitraum</p>
		<p class="mt-1 text-sm text-ink-3">Ein anderes Fahrzeug oder einen längeren Zeitraum wählen.</p>
	</div>
{/if}
