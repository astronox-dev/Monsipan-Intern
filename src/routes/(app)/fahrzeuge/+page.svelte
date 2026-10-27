<script lang="ts">
	/**
	 * Fahrzeuge: Wo die Autos gerade sind – Karte und Liste, live: Jeder neue
	 * Standort kommt über die Ereignis-Leitung (siehe Layout), dazu alle 30
	 * Sekunden neu für „seit …". Wer verwalten darf, legt Fahrzeuge an und
	 * koppelt die Tablets.
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import Truck from '@lucide/svelte/icons/truck';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Unlink from '@lucide/svelte/icons/unlink';
	import Trash from '@lucide/svelte/icons/trash';
	import Route from '@lucide/svelte/icons/route';
	import BatteryCharging from '@lucide/svelte/icons/battery-charging';
	import Battery from '@lucide/svelte/icons/battery';
	import Download from '@lucide/svelte/icons/download';
	import Dialog from '$lib/components/Dialog.svelte';
	import VehicleMap from '$lib/modules/fuhrpark/components/VehicleMap.svelte';
	import type { MapVehicle, VehicleState } from '$lib/modules/fuhrpark/track';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();
	type Vehicle = (typeof data.vehicles)[number];

	// Live: alle 30 Sekunden neu laden – nur solange die Seite sichtbar ist
	$effect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') invalidate('app:fahrzeuge');
		}, 30_000);
		return () => clearInterval(timer);
	});

	const clock = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const dayClock = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const ago = (ms: number) => {
		const min = Math.round((data.now - ms) / 60_000);
		if (min < 1) return 'gerade eben';
		if (min < 60) return `vor ${min} Min.`;
		if (min < 24 * 60) return `seit ${clock.format(ms)} Uhr`;
		return `seit ${dayClock.format(ms)}`;
	};
	const STATE: Record<VehicleState, { label: string; tone: string }> = {
		faehrt: { label: 'Fährt', tone: 'badge-brand' },
		steht: { label: 'Steht', tone: 'badge-info' },
		offline: { label: 'Keine Meldung', tone: 'badge-warn' },
		nie: { label: 'Noch keine Daten', tone: '' }
	};
	function detail(v: Vehicle): string {
		if (!v.paired && v.state === 'nie') return 'Kein Tablet gekoppelt';
		if (v.state === 'faehrt') return `${Math.round((v.lastSpeed ?? 0) * 3.6)} km/h · ${ago(v.lastAt!)}`;
		if (v.state === 'steht') return v.lastAt ? `hier ${ago(v.lastAt)}` : 'meldet sich, noch ohne Standort';
		if (v.state === 'offline') return `zuletzt ${ago(Math.max(v.lastSeenAt ?? 0, v.lastAt ?? 0))}`;
		return 'Gekoppelt, wartet auf den ersten Standort';
	}

	const onMap = $derived(
		data.vehicles
			.filter((v) => v.active && v.lastLat != null && v.lastLon != null)
			.map((v): MapVehicle => ({ id: v.id, name: v.name, lat: v.lastLat!, lon: v.lastLon!, state: v.state, heading: v.lastHeading, href: `/fahrzeuge/${v.id}` }))
	);
	let focus = $state<number | null>(null);

	/* ------------------------------------------------------------ Verwalten */
	let editOpen = $state(false);
	let editing = $state<Vehicle | null>(null);
	let pairOpen = $state(false);
	let pairing = $state<{ id: number; code: string; expires: number } | null>(null);
	let removing = $state<Vehicle | null>(null);
	let removeOpen = $state(false);
	let busy = $state(false);
	const nameOf = (id: number) => data.vehicles.find((v) => v.id === id)?.name ?? '';

	function openEdit(v: Vehicle | null) {
		editing = v;
		editOpen = true;
	}
	const done =
		(message: string, close: () => void) =>
		() => {
			busy = true;
			return async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
				busy = false;
				if (result.type === 'success') {
					close();
					if (message) toast.success(message);
				}
				await update({ reset: false });
			};
		};
</script>

<svelte:head><title>{pageTitle('Fahrzeuge')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pb-5">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Truck size={28} aria-hidden="true" />Fahrzeuge</h1>
		<p class="text-ink-2">Wo die Autos gerade sind – live, laut Tablet im Fahrzeug. Ein Klick auf ein Auto in der Liste fährt mit.</p>
	</div>
	{#if data.canManage}
		<button class="btn btn-primary" onclick={() => openEdit(null)}><Plus size={18} aria-hidden="true" />Fahrzeug anlegen</button>
	{/if}
</div>

{#if !data.vehicles.length}
	<div class="card p-8 text-center">
		<p class="font-medium">Noch kein Fahrzeug</p>
		<p class="mt-1 text-sm text-ink-3">
			{data.canManage ? 'Mit „Fahrzeug anlegen" beginnen, dann das Tablet im Auto koppeln.' : 'Fahrzeuge legt an, wer den Fuhrpark verwaltet.'}
		</p>
	</div>
{:else}
	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
		<VehicleMap vehicles={onMap} {focus} onrelease={() => (focus = null)} class="h-[55vh] lg:h-[calc(100dvh-12rem)]" />

		<ul class="card divide-y divide-line self-start overflow-hidden" aria-label="Fahrzeuge">
			{#each data.vehicles as v (v.id)}
				{@const st = STATE[v.state]}
				<li class="p-3 {v.active ? '' : 'opacity-60'}">
					<div class="flex items-start gap-2">
						<button
							type="button"
							class="min-w-0 flex-1 text-left"
							disabled={v.lastLat == null}
							onclick={() => (focus = v.id)}
							title={v.lastLat == null ? undefined : 'Auf der Karte zeigen'}
						>
							<span class="block truncate font-semibold">{v.name}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">{[v.plate, v.partyName].filter(Boolean).join(' · ') || ' '}</span>
						</button>
						<span class="badge {st.tone}">{v.active ? st.label : 'Ausgeblendet'}</span>
					</div>
					<p class="mt-1 flex items-center gap-2 text-[0.8125rem] text-ink-2">
						<span class="min-w-0 flex-1 truncate">{detail(v)}</span>
						{#if v.battery != null}
							<span class="num inline-flex shrink-0 items-center gap-1 text-ink-3" title={v.charging ? 'Tablet lädt (Zündung an)' : 'Akku des Tablets'}>
								{#if v.charging}<BatteryCharging size={14} aria-hidden="true" />{:else}<Battery size={14} aria-hidden="true" />{/if}{v.battery} %
							</span>
						{/if}
					</p>
					<div class="mt-2 flex flex-wrap gap-1">
						<a href="/fahrzeuge/{v.id}" class="btn btn-secondary btn-sm"><Route size={15} aria-hidden="true" />Fahrten</a>
						{#if data.canManage}
							<button class="btn btn-ghost btn-sm" onclick={() => openEdit(v)}><Pencil size={15} aria-hidden="true" />Bearbeiten</button>
							<form
								method="POST"
								action="?/pair"
								use:enhance={() => async ({ result, update }) => {
									if (result.type === 'success' && result.data?.pairing) {
										pairing = result.data.pairing as typeof pairing;
										pairOpen = true;
									}
									await update({ reset: false });
								}}
							>
								<input type="hidden" name="id" value={v.id} />
								<button class="btn btn-ghost btn-sm"><Link2 size={15} aria-hidden="true" />{v.paired ? 'Neu koppeln' : 'Koppeln'}</button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<p class="field-hint mt-4">
	Die Tablets senden rund um die Uhr; jeder Standort bleibt 90 Tage gespeichert, dann wird er gelöscht. Die Fahrer sehen am Tablet dauerhaft, dass der Standort
	geteilt wird.
</p>

{#if data.canManage}
	<!-- Fahrzeug anlegen bzw. bearbeiten -->
	<Dialog bind:open={editOpen} title={editing ? `${editing.name} bearbeiten` : 'Fahrzeug anlegen'}>
		{#key editing?.id ?? 'neu'}
			<form method="POST" action="?/save" class="space-y-3" use:enhance={done(editing ? 'Gespeichert' : 'Fahrzeug angelegt', () => (editOpen = false))}>
				{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
				<label class="block">
					<span class="field-label">Name *</span>
					<input class="input" name="name" required maxlength="80" value={editing?.name ?? ''} placeholder="z. B. Pritsche Nord" />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="block">
						<span class="field-label">Kennzeichen</span>
						<input class="input" name="kennzeichen" maxlength="20" value={editing?.plate ?? ''} />
					</label>
					<label class="block">
						<span class="field-label">Partie</span>
						<select class="select" name="partie" value={editing?.partyId ? String(editing.partyId) : ''}>
							<option value="">–</option>
							{#each data.parties as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
						</select>
					</label>
				</div>
				<label class="block">
					<span class="field-label">Notiz</span>
					<input class="input" name="notiz" maxlength="500" value={editing?.note ?? ''} />
				</label>
				{#if editing}
					<label class="flex items-center gap-2 text-[0.9375rem]">
						<input type="checkbox" name="ausblenden" class="size-5 accent-[var(--c-ink)]" checked={!editing.active} />
						Ausblenden – das Tablet sendet nicht mehr, der Verlauf bleibt
					</label>
				{/if}
				{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
				<div class="flex flex-wrap items-center gap-2 pt-1">
					<button class="btn btn-primary" disabled={busy}>{editing ? 'Speichern' : 'Anlegen'}</button>
					<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)}>Abbrechen</button>
				</div>
			</form>
			{#if editing}
				{@const vehicle = editing}
				<div class="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
					{#if vehicle.paired}
						<form method="POST" action="?/unpair" use:enhance={done('Tablet entkoppelt', () => (editOpen = false))}>
							<input type="hidden" name="id" value={vehicle.id} />
							<button class="btn btn-ghost btn-sm"><Unlink size={15} aria-hidden="true" />Tablet entkoppeln</button>
						</form>
					{/if}
					<button
						type="button"
						class="btn btn-ghost btn-sm ml-auto text-danger hover:bg-danger-soft"
						onclick={() => {
							removing = vehicle;
							editOpen = false;
							removeOpen = true;
						}}><Trash size={15} aria-hidden="true" />Löschen</button
					>
				</div>
			{/if}
		{/key}
	</Dialog>

	<!-- Kopplungscode -->
	<Dialog bind:open={pairOpen} title="Tablet koppeln">
		{#if pairing}
			<p class="text-ink-2">Für <span class="font-semibold text-ink">{nameOf(pairing.id)}</span> auf dem Tablet im Auto:</p>
			<ol class="mt-3 list-decimal space-y-1.5 pl-5 text-[0.9375rem]">
				<li>
					Die App <span class="font-medium">„Monsipan Fahrzeug"</span> installieren und öffnen
					(<a href={data.apk} class="font-medium underline decoration-mark decoration-2 underline-offset-4">herunterladen</a>).
				</li>
				<li>Diesen Code eintippen und „Koppeln" drücken:</li>
			</ol>
			<p class="num my-4 rounded-xl border border-line bg-surface-2 py-4 text-center font-display text-[2.5rem] font-bold tracking-[0.12em]">{pairing.code}</p>
			<ol start="3" class="list-decimal space-y-1.5 pl-5 text-[0.9375rem]">
				<li>Den Standort „Immer zulassen" und die Akku-Ausnahme bestätigen – sonst hört das Tablet nach einer Weile auf zu senden.</li>
			</ol>
			<p class="field-hint mt-3">Gültig bis {clock.format(pairing.expires)} Uhr. Ein früher gekoppeltes Tablet dieses Autos sendet weiter, bis das neue gekoppelt ist.</p>
			<div class="mt-4 flex justify-end">
				<button class="btn btn-primary" onclick={() => (pairOpen = false)}>Fertig</button>
			</div>
		{/if}
	</Dialog>

	<Dialog bind:open={removeOpen} title="Fahrzeug löschen?">
		{#if removing}
			<p class="text-ink-2">„{removing.name}" mit allen gespeicherten Standorten löschen? Das Tablet sendet danach nicht mehr. Lässt sich nicht rückgängig machen.</p>
			<form method="POST" action="?/delete" class="mt-4 flex justify-end gap-2" use:enhance={done('Fahrzeug gelöscht', () => (removeOpen = false))}>
				<input type="hidden" name="id" value={removing.id} />
				<button type="button" class="btn btn-ghost" onclick={() => (removeOpen = false)}>Abbrechen</button>
				<button class="btn btn-danger" disabled={busy}><Trash size={16} aria-hidden="true" />Löschen</button>
			</form>
		{/if}
	</Dialog>

	<p class="mt-3 text-sm">
		<a href={data.apk} class="inline-flex items-center gap-1.5 font-medium text-ink-2 underline decoration-mark decoration-2 underline-offset-4 hover:text-ink"
			><Download size={15} aria-hidden="true" />App „Monsipan Fahrzeug" für die Tablets</a
		>
	</p>
{/if}
