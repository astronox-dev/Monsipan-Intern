<script lang="ts">
	/**
	 * Die Felder des 3M-Eigenüberwachungs-Protokolls für Markierungsfolien –
	 * im Arbeitsauftrag, gespeichert mit ihm zusammen.
	 */
	import {
		FOIL_CONDITION,
		FOIL_FILM_COLUMNS,
		FOIL_LAYING,
		FOIL_PREP,
		FOIL_PRESSING,
		FOIL_PRIMED,
		FOIL_TIMES,
		type FoilProtocol
	} from '../work-order';

	interface Props {
		foil: Omit<FoilProtocol, 'signatures'>;
		disabled?: boolean;
	}
	let { foil = $bindable(), disabled = false }: Props = $props();

	const CHOICES = [
		{ key: 'condition', nr: '1.5', label: 'Zustand', options: FOIL_CONDITION },
		{ key: 'prep', nr: '1.6', label: 'Notwendige Vorarbeiten', options: FOIL_PREP }
	] as const;
	const LAYING = [
		{ key: 'primed', nr: '3.3', label: 'Grundiert', options: FOIL_PRIMED },
		{ key: 'laying', nr: '3.4', label: 'Verlegung', options: FOIL_LAYING },
		{ key: 'pressing', nr: '3.5', label: 'Andruck', options: FOIL_PRESSING }
	] as const;
	const WEATHER = [
		{ key: 'air', label: 'Luft-Temperatur in °C' },
		{ key: 'ground', label: 'Boden-Temperatur in °C' },
		{ key: 'humidity', label: 'Relative Luftfeuchtigkeit in %' }
	] as const;
</script>

<fieldset {disabled} class="space-y-6">
	<div>
		<h3 class="font-semibold">1.0 Angaben zur Straße</h3>
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="block sm:col-span-2">
				<span class="field-label">1.1 Ort und Straßenbezeichnung</span>
				<input class="input" maxlength="160" bind:value={foil.place} />
			</label>
			<label class="block">
				<span class="field-label">1.2 Von – bis, bzw. km</span>
				<input class="input" maxlength="120" bind:value={foil.section} />
			</label>
			<label class="block">
				<span class="field-label">1.3 Fahrbahndeckenart</span>
				<input class="input" maxlength="120" bind:value={foil.surface} />
			</label>
			<label class="block">
				<span class="field-label">1.4 Spurbreite</span>
				<input class="input" maxlength="60" bind:value={foil.laneWidth} />
			</label>
		</div>
		{#each CHOICES as c (c.key)}
			<div class="mt-4">
				<p class="field-label">{c.nr} {c.label}</p>
				<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
					{#each c.options as o (o.key)}
						<label class="flex items-center gap-2"><input type="checkbox" class="size-5 accent-[var(--c-ink)]" checked={(foil[c.key] as Record<string, boolean>)[o.key]} onchange={(e) => ((foil[c.key] as Record<string, boolean>)[o.key] = e.currentTarget.checked)} />{o.label}</label>
					{/each}
					<span class="flex min-w-[12rem] flex-1 items-center gap-2">
						<input type="checkbox" class="size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={foil[c.key].other} aria-label="{c.label}: anderes" />
						<input class="input input-sm" maxlength="60" placeholder="Anderes" bind:value={foil[c.key].otherText} oninput={() => (foil[c.key].other ||= !!foil[c.key].otherText.trim())} />
					</span>
				</div>
			</div>
		{/each}
	</div>

	<div>
		<h3 class="font-semibold">2.0 Angaben zum Wetter</h3>
		<p class="field-label mt-3">2.1 Messung</p>
		<div class="overflow-x-auto">
			<div class="grid min-w-[30rem] grid-cols-[minmax(10rem,1fr)_repeat(4,5.5rem)] items-center gap-2">
				<span></span>
				{#each FOIL_TIMES as t (t)}<span class="text-center text-sm text-ink-3">{t}</span>{/each}
				{#each WEATHER as w (w.key)}
					<span class="text-sm">{w.label}</span>
					{#each FOIL_TIMES as t, i (t)}
						<input class="input input-sm num text-center" inputmode="decimal" maxlength="12" bind:value={foil.weather[w.key][i]} aria-label="{w.label} um {t}" />
					{/each}
				{/each}
			</div>
		</div>
		<div class="mt-4 flex flex-wrap items-center gap-2">
			<span class="field-label mb-0">2.2 Letzter Regen vor</span>
			<input class="input input-sm num w-20 text-center" inputmode="numeric" maxlength="12" bind:value={foil.rainDays} aria-label="Tagen" />
			<span>Tagen</span>
			<input class="input input-sm num w-20 text-center" inputmode="numeric" maxlength="12" bind:value={foil.rainHours} aria-label="Stunden" />
			<span>Stunden</span>
		</div>
	</div>

	<div>
		<h3 class="font-semibold">3.0 Angaben zur Verlegung</h3>
		<p class="field-label mt-3">3.1 Folien</p>
		<div class="space-y-3">
			{#each foil.films as film, i (i)}
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
					{#each FOIL_FILM_COLUMNS as c (c.key)}
						<label class="block">
							<span class="text-[0.75rem] text-ink-3">{c.label}</span>
							<input class="input input-sm" maxlength="40" bind:value={film[c.key]} />
						</label>
					{/each}
				</div>
			{/each}
		</div>
		<div class="mt-4 grid gap-3 sm:grid-cols-3">
			<label class="block"><span class="field-label">3.2 Lot-Nr. Folie (Aufkleber)</span><input class="input" maxlength="40" bind:value={foil.lotFilm} /></label>
			<label class="block"><span class="field-label">Lot-Nr. Primer</span><input class="input" maxlength="40" bind:value={foil.lotPrimer} /></label>
			<label class="block"><span class="field-label">Lot-Nr. DS01E</span><input class="input" maxlength="40" bind:value={foil.lotDs01e} /></label>
		</div>
		{#each LAYING as c (c.key)}
			<div class="mt-4">
				<p class="field-label">{c.nr} {c.label}</p>
				<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
					{#each c.options as o (o.key)}
						<label class="flex items-center gap-2"><input type="checkbox" class="size-5 accent-[var(--c-ink)]" checked={(foil[c.key] as Record<string, boolean>)[o.key]} onchange={(e) => ((foil[c.key] as Record<string, boolean>)[o.key] = e.currentTarget.checked)} />{o.label}</label>
					{/each}
					<span class="flex min-w-[12rem] flex-1 items-center gap-2">
						<input type="checkbox" class="size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={foil[c.key].other} aria-label="{c.label}: anderes" />
						<input class="input input-sm" maxlength="60" placeholder="Anderes" bind:value={foil[c.key].otherText} oninput={() => (foil[c.key].other ||= !!foil[c.key].otherText.trim())} />
					</span>
				</div>
			</div>
		{/each}
		<div class="mt-4">
			<p class="field-label">3.6 Streckenfreigabe</p>
			<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
				<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="gleich" bind:group={foil.release} />gleicher Tag</label>
				<label class="flex items-center gap-2">
					<input type="radio" class="accent-[var(--c-ink)]" value="nach" bind:group={foil.release} />nach
					<input class="input input-sm num w-20 text-center" inputmode="numeric" maxlength="12" bind:value={foil.releaseDays} oninput={() => foil.releaseDays.trim() && (foil.release = 'nach')} aria-label="Tagen" />
					Tagen
				</label>
				<label class="flex items-center gap-2 text-ink-3"><input type="radio" class="accent-[var(--c-ink)]" value="" bind:group={foil.release} />offen</label>
			</div>
		</div>
		<div class="mt-4 grid gap-3 sm:grid-cols-2">
			<label class="block"><span class="field-label">3.7 Verlegedatum</span><input class="input" type="date" bind:value={foil.layingDate} /></label>
			<label class="block"><span class="field-label">3.8 Voraussichtl. Datum der Demarkierung</span><input class="input" type="date" bind:value={foil.removalDate} /></label>
		</div>
	</div>

	<div>
		<h3 class="font-semibold">4.0 Bemerkungen</h3>
		<textarea class="textarea mt-3" rows="3" maxlength="300" bind:value={foil.remarks}></textarea>
	</div>
</fieldset>
