<script lang="ts">
	/**
	 * Feste Orte: Lager, Firma, Baustellen. Mit Adresse suchen oder direkt in die
	 * Karte klicken; der Umkreis sagt, ab wann ein Auto „dort" ist.
	 */
	import { pageTitle } from '$lib/app';
	import { deserialize, enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Trash from '@lucide/svelte/icons/trash';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import FleetTabs from '$lib/modules/fuhrpark/components/FleetTabs.svelte';
	import VehicleMap from '$lib/modules/fuhrpark/components/VehicleMap.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();
	type Place = (typeof data.places)[number];

	/** Das Formular neben der Karte – `open` auch für einen neuen Ort */
	let open = $state(false);
	let editing = $state<Place | null>(null);
	let name = $state('');
	let address = $state('');
	let radius = $state(150);
	let lat = $state<number | null>(null);
	let lon = $state<number | null>(null);
	let query = $state('');
	let hits = $state<{ label: string; lat: number; lon: number }[]>([]);
	let searching = $state(false);
	let searchError = $state('');
	let busy = $state(false);

	function start(p: Place | null) {
		editing = p;
		name = p?.name ?? '';
		address = p?.address ?? '';
		radius = p?.radius ?? 150;
		lat = p?.lat ?? null;
		lon = p?.lon ?? null;
		query = '';
		hits = [];
		searchError = '';
		open = true;
	}

	async function search() {
		if (query.trim().length < 3) return;
		searching = true;
		searchError = '';
		const body = new FormData();
		body.set('q', query);
		const res = await fetch('?/search', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		searching = false;
		if (result.type === 'success') {
			hits = (result.data?.hits ?? []) as typeof hits;
			if (!hits.length) searchError = 'Nichts gefunden – anders schreiben oder in die Karte klicken.';
		} else searchError = result.type === 'failure' ? String(result.data?.message ?? 'Die Suche hat nicht geklappt.') : 'Die Suche hat nicht geklappt.';
	}

	function choose(hit: (typeof hits)[number]) {
		lat = hit.lat;
		lon = hit.lon;
		address = hit.label;
		hits = [];
	}

	const after = (message: string) => () => {
		busy = true;
		return async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
			busy = false;
			if (result.type === 'success') {
				open = false;
				toast.success(message);
			}
			await update({ reset: false });
		};
	};

	const picked = $derived(open && lat != null && lon != null ? { lat, lon, radius } : null);
	/** Während man einen Ort ändert, zeigt die Karte ihn nur als Auswahl */
	const shown = $derived(data.places.filter((p) => !(open && p.id === editing?.id)));
</script>

<svelte:head><title>{pageTitle('Feste Orte')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pb-5">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Warehouse size={28} aria-hidden="true" />Feste Orte</h1>
		<p class="text-ink-2">Lager, Firma, Baustellen – auf der Karte markiert. Steht ein Auto dort, sieht man das in Liste, Verlauf und Fahrtenbuch.</p>
	</div>
	{#if data.canManage}
		<button class="btn btn-primary" onclick={() => start(null)}><Plus size={18} aria-hidden="true" />Ort anlegen</button>
	{/if}
</div>

<FleetTabs />

<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
	<VehicleMap
		places={shown}
		{picked}
		onpick={(a, b) => {
			if (!open) return;
			lat = Math.round(a * 1e6) / 1e6;
			lon = Math.round(b * 1e6) / 1e6;
		}}
		class="h-[55vh] lg:h-[calc(100dvh-15rem)]"
	/>

	<div class="space-y-4 self-start">
		{#if open}
			<form method="POST" action="?/save" class="card space-y-3 p-4" use:enhance={after(editing ? 'Gespeichert' : 'Ort angelegt')}>
				<h2 class="text-lg">{editing ? `${editing.name} ändern` : 'Neuer Ort'}</h2>
				{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
				<input type="hidden" name="lat" value={lat ?? ''} />
				<input type="hidden" name="lon" value={lon ?? ''} />
				<label class="block">
					<span class="field-label">Name *</span>
					<input class="input" name="name" required maxlength="80" bind:value={name} placeholder="z. B. Lager Eibesbrunn" />
				</label>
				<div>
					<label class="block" for="ort-suche"><span class="field-label">Adresse suchen</span></label>
					<div class="flex gap-2">
						<input
							id="ort-suche"
							class="input min-w-0 flex-1"
							bind:value={query}
							placeholder="Straße, PLZ, Ort"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									search();
								}
							}}
						/>
						<button type="button" class="btn btn-secondary" disabled={searching} onclick={search}><Search size={16} aria-hidden="true" />Suchen</button>
					</div>
					{#if searchError}<p class="field-error mt-1" role="alert">{searchError}</p>{/if}
					{#if hits.length}
						<ul class="mt-2 divide-y divide-line rounded-xl border border-line">
							{#each hits as h (`${h.lat},${h.lon}`)}
								<li><button type="button" class="w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onclick={() => choose(h)}>{h.label}</button></li>
							{/each}
						</ul>
					{/if}
					<p class="field-hint mt-1">Oder einfach in die Karte klicken – auch um die Lage nachzujustieren.</p>
				</div>
				<label class="block">
					<span class="field-label">Anschrift</span>
					<input class="input" name="adresse" maxlength="200" bind:value={address} />
				</label>
				<label class="block">
					<span class="field-label">Umkreis: {radius} m</span>
					<input class="w-full accent-[var(--c-ink)]" type="range" name="umkreis" min="30" max="1000" step="10" bind:value={radius} />
				</label>
				{#if lat == null}<p class="text-sm text-ink-3">Noch keine Lage gewählt.</p>{/if}
				{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
				<div class="flex flex-wrap gap-2 pt-1">
					<button class="btn btn-primary" disabled={busy || lat == null}>{editing ? 'Speichern' : 'Anlegen'}</button>
					<button type="button" class="btn btn-ghost" onclick={() => (open = false)}>Abbrechen</button>
				</div>
			</form>
		{/if}

		<ul class="card divide-y divide-line overflow-hidden" aria-label="Feste Orte">
			{#each data.places as p (p.id)}
				<li class="flex items-center gap-2 p-3">
					<span class="min-w-0 flex-1">
						<span class="block truncate font-semibold">{p.name}</span>
						<span class="block truncate text-[0.8125rem] text-ink-3">{[p.address, `${p.radius} m Umkreis`].filter(Boolean).join(' · ')}</span>
					</span>
					{#if data.canManage}
						<button class="btn btn-ghost btn-icon" aria-label="{p.name} ändern" onclick={() => start(p)}><Pencil size={16} /></button>
						<form method="POST" action="?/delete" use:enhance={after('Ort gelöscht')}>
							<input type="hidden" name="id" value={p.id} />
							<button class="btn btn-ghost btn-icon text-danger" aria-label="{p.name} löschen"><Trash size={16} /></button>
						</form>
					{/if}
				</li>
			{:else}
				<li class="p-6 text-center text-sm text-ink-3">
					{data.canManage ? 'Noch keine Orte – mit „Ort anlegen" beginnen.' : 'Noch keine Orte angelegt.'}
				</li>
			{/each}
		</ul>
	</div>
</div>
