<script lang="ts">
	/**
	 * Rechner für die Baustelle: Länge bzw. Breite eintippen, die Einteilung
	 * steht gleich darunter – mit Zeichnung. Gerechnet wird im Browser.
	 */
	import { pageTitle } from '$lib/app';
	import Calculator from '@lucide/svelte/icons/calculator';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import LayoutStrip, { type StripPart } from '$lib/modules/tools/components/LayoutStrip.svelte';
	import {
		cmLabel,
		CROSSING,
		crossingLayout,
		metersToCm,
		mLabel,
		PARKING,
		parkingLayouts,
		type CrossingLayout,
		type ParkingLayout
	} from '$lib/modules/tools/rechner';

	let parkInput = $state('');
	let crossInput = $state('');
	let barInput = $state('');

	const parkLength = $derived(metersToCm(parkInput));
	const parking = $derived(parkLength == null ? [] : parkingLayouts(parkLength));
	const crossWidth = $derived(metersToCm(crossInput));
	const crossing = $derived(crossWidth == null ? null : crossingLayout(crossWidth));
	const barLength = $derived(metersToCm(barInput));

	const area = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	/** Fläche der Riegel in m² – nur mit Riegellänge */
	const barArea = (bars: number) => (barLength == null ? null : `${area.format((bars * CROSSING.bar * barLength) / 10_000)} m²`);

	/** Parkordnung zum Zeichnen – bei vielen Strichen nur Anfang und Ende */
	function parkingParts(l: ParkingLayout): StripPart[] {
		const repeat = (n: number) => Array.from({ length: n }, (): StripPart[] => [{ kind: 'mark', len: PARKING.stroke }, { kind: 'gap', len: PARKING.gap }]).flat();
		const head: StripPart[] = [{ kind: 'end', len: l.end }, { kind: 'gap', len: PARKING.gap }];
		const middle = l.inner <= 8 ? repeat(l.inner) : [...repeat(3), { kind: 'break', len: 0 } as StripPart, ...repeat(3)];
		return [...head, ...middle, { kind: 'end', len: l.end }];
	}

	/** Schutzweg zum Zeichnen: Rand, Riegel, Lücken, Rand */
	function crossingParts(c: CrossingLayout): StripPart[] {
		const parts: StripPart[] = [{ kind: 'edge', len: c.edge }];
		for (let i = 0; i < c.bars; i++) {
			if (i) parts.push({ kind: 'gap', len: CROSSING.gap });
			parts.push({ kind: 'mark', len: CROSSING.bar });
		}
		parts.push({ kind: 'edge', len: c.edge });
		return parts;
	}

	/** „Strich 1,70 m · Lücke 1 m · 6 × (Strich 2 m · Lücke 1 m) · Strich 1,70 m" */
	const parkingSequence = (l: ParkingLayout) =>
		[`Strich ${mLabel(l.end)}`, 'Lücke 1 m', l.inner ? `${l.inner} × (Strich 2 m · Lücke 1 m)` : '', `Strich ${mLabel(l.end)}`].filter(Boolean).join(' · ');
</script>

<svelte:head><title>{pageTitle('Rechner')}</title></svelte:head>

<div class="pt-2 pb-5">
	<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Calculator size={26} aria-hidden="true" />Rechner</h1>
	<p class="text-ink-2">Maß eintippen – die Einteilung steht gleich darunter, mit Zeichnung.</p>
</div>

<div class="grid items-start gap-4 xl:grid-cols-2">
	<section class="card p-4 lg:p-5" aria-labelledby="h-park">
		<h2 id="h-park" class="text-lg">Parkordnung</h2>
		<p class="mt-1 text-sm text-ink-2">
			Strich 2 m, Lücke 1 m. Anfangs- und Endstrich sind gleich lang – mindestens 50 cm, höchstens 2 m.
		</p>
		<label class="mt-3 block max-w-xs">
			<span class="field-label">Länge der Parkordnung</span>
			<span class="flex items-center gap-2">
				<input class="input num text-right" inputmode="decimal" autocomplete="off" placeholder="z. B. 23,40" bind:value={parkInput} />m
			</span>
		</label>

		{#if parkInput.trim() && parkLength == null}
			<p class="mt-3 text-sm text-danger">Bitte die Länge in Metern eintragen, z. B. 23,40.</p>
		{:else if parkLength != null && !parking.length}
			<p class="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn">
				<TriangleAlert size={18} class="mt-0.5 shrink-0" aria-hidden="true" />
				Unter 2 m geht sich Strich – Lücke – Strich mit mindestens 50 cm nicht aus.
			</p>
		{:else if parking.length}
			{@const best = parking[0]}
			<div class="mt-4 rounded-xl bg-info-soft p-4">
				<p class="text-sm text-ink-2">Anfangs- und Endstrich je</p>
				<p class="num text-3xl font-semibold">{mLabel(best.end)}</p>
			</div>
			<dl class="num mt-3 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
				<dt class="text-ink-2">Striche dazwischen à 2 m</dt>
				<dd class="text-right">{best.inner}</dd>
				<dt class="text-ink-2">Lücken à 1 m</dt>
				<dd class="text-right">{best.gaps}</dd>
				<dt class="text-ink-2">Striche insgesamt</dt>
				<dd class="text-right">{best.strokes}</dd>
				<dt class="text-ink-2">Markierte Länge</dt>
				<dd class="text-right font-medium">{mLabel(best.marked)}</dd>
			</dl>
			<p class="mt-3 text-sm">{parkingSequence(best)}</p>
			<LayoutStrip parts={parkingParts(best)} label={mLabel(best.end)} caption={best.inner > 8 ? `${best.strokes} Striche – Mitte gekürzt` : ''} />
			{#if parking[1]}
				<p class="mt-3 text-sm text-ink-2">
					Geht genauso: Anfangs- und Endstrich je {mLabel(parking[1].end)} mit {parking[1].inner} Strichen dazwischen.
				</p>
			{/if}
		{/if}
	</section>

	<section class="card p-4 lg:p-5" aria-labelledby="h-schutzweg">
		<h2 id="h-schutzweg" class="text-lg">Schutzweg</h2>
		<p class="mt-1 text-sm text-ink-2">
			Riegel 50 cm, Lücke 50 cm. Vom Randstein zum ersten und zum letzten Riegel mindestens 25 cm, höchstens 50 cm.
		</p>
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="field-label">Breite der Fahrbahn</span>
				<span class="flex items-center gap-2">
					<input class="input num text-right" inputmode="decimal" autocomplete="off" placeholder="z. B. 6,50" bind:value={crossInput} />m
				</span>
				<span class="field-hint">Von Randstein zu Randstein</span>
			</label>
			<label class="block">
				<span class="field-label">Länge der Riegel <span class="font-normal text-ink-3">(freiwillig)</span></span>
				<span class="flex items-center gap-2">
					<input class="input num text-right" inputmode="decimal" autocomplete="off" placeholder="z. B. 4,00" bind:value={barInput} />m
				</span>
				<span class="field-hint">Breite des Schutzwegs – für die Fläche</span>
			</label>
		</div>

		{#if crossInput.trim() && crossWidth == null}
			<p class="mt-3 text-sm text-danger">Bitte die Breite in Metern eintragen, z. B. 6,50.</p>
		{:else if crossing}
			{#if crossing.exact}
				{@const c = crossing.exact}
				<div class="mt-4 rounded-xl bg-info-soft p-4">
					<p class="text-sm text-ink-2">Randstein bis zum ersten bzw. letzten Riegel je</p>
					<p class="num text-3xl font-semibold">{cmLabel(c.edge)}</p>
				</div>
				<dl class="num mt-3 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
					<dt class="text-ink-2">Riegel à 50 cm</dt>
					<dd class="text-right">{c.bars}</dd>
					<dt class="text-ink-2">Lücken à 50 cm</dt>
					<dd class="text-right">{c.bars - 1}</dd>
					{#if barArea(c.bars)}
						<dt class="text-ink-2">Fläche der Riegel</dt>
						<dd class="text-right font-medium">{barArea(c.bars)}</dd>
					{/if}
				</dl>
				<LayoutStrip parts={crossingParts(c)} label={cmLabel(c.edge)} curbs caption="Randstein bis Randstein" />
			{:else if !crossing.nearest.length}
				<p class="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn">
					<TriangleAlert size={18} class="mt-0.5 shrink-0" aria-hidden="true" />
					Zu schmal – für einen Riegel mit 25 cm zu beiden Randsteinen braucht es mindestens 1 m.
				</p>
			{:else}
				<p class="mt-4 flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn">
					<TriangleAlert size={18} class="mt-0.5 shrink-0" aria-hidden="true" />
					<span>
						Bei dieser Breite geht es sich mit 50 cm Lücken nicht aus – der Abstand zum Randstein liegt immer außerhalb von 25 bis 50 cm.
						Die beiden Möglichkeiten, die nähere zuerst:
					</span>
				</p>
				<div class="mt-3 grid gap-3">
					{#each crossing.nearest as c, i (c.bars)}
						<div class="rounded-xl border border-line p-3">
							<p class="num">
								<span class="font-semibold">{c.bars} Riegel</span> · je <span class="font-semibold">{cmLabel(c.edge)}</span> zum Randstein
								<span class="text-warn">({c.deviation > 0 ? `${cmLabel(c.deviation)} zu viel` : `${cmLabel(-c.deviation)} zu wenig`})</span>
								{#if barArea(c.bars)}<span class="text-ink-2"> · {barArea(c.bars)}</span>{/if}
							</p>
							{#if i === 0 && crossing.nearest.length > 1}<p class="text-sm text-ink-3">Näher an der Vorgabe</p>{/if}
							<LayoutStrip parts={crossingParts(c)} label={cmLabel(c.edge)} curbs warn />
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>
</div>
