<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import FileText from '@lucide/svelte/icons/file-text';
	import Lock from '@lucide/svelte/icons/lock';
	import Signature from '@lucide/svelte/icons/signature';
	import Dialog from '$lib/components/Dialog.svelte';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import SignaturePad from '$lib/modules/stunden/components/SignaturePad.svelte';
	import SignatureTile from '$lib/modules/auftraege/components/SignatureTile.svelte';
	import { spacedNumber } from '$lib/modules/auftraege/offer';
	import {
		FOIL_CONDITION,
		FOIL_FILM_COLUMNS,
		FOIL_LAYING,
		FOIL_PREP,
		FOIL_PRESSING,
		FOIL_PRIMED,
		FOIL_SIGNATURE_LABELS,
		FOIL_TIMES,
		type FoilSignatureRole
	} from '$lib/modules/auftraege/work-order';
	import { dateTime } from '$lib/format';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();

	const locked = $derived(data.lockedByOrder || !!data.foil.signatures.auftraggeber);
	const editable = $derived(data.canEdit && !locked);

	// svelte-ignore state_referenced_locally
	const { signatures: _s, ...start } = structuredClone(data.foil);
	let f = $state(start);
	const payload = $derived(JSON.stringify(f));

	let busy = $state(false);
	let signOpen = $state(false);
	let signRole = $state<FoilSignatureRole>('auftragnehmer');
	let signName = $state('');
	let signPath = $state('');
	let removeRole = $state<FoilSignatureRole | null>(null);
	function openSign(role: FoilSignatureRole) {
		signRole = role;
		signName = role === 'auftraggeber' ? data.contact : data.me;
		signPath = '';
		signOpen = true;
	}
	const tile = (role: FoilSignatureRole) => ({
		label: FOIL_SIGNATURE_LABELS[role],
		signature: data.foil.signatures[role],
		canSign: data.canEdit && !data.lockedByOrder && (role === 'auftraggeber' || !data.foil.signatures.auftraggeber),
		canRemove: data.canEdit && !data.lockedByOrder && (role === 'auftraggeber' || !data.foil.signatures.auftraggeber),
		busy,
		onsign: () => openSign(role),
		onremove: () => (removeRole = role)
	});

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

<svelte:head><title>{pageTitle(`3M-Verlegeprotokoll ${spacedNumber(data.order.number)}`)}</title></svelte:head>

<a href="/auftraege/{data.order.id}/arbeitsauftrag" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Arbeitsauftrag {spacedNumber(data.order.number)}
</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">3M-Verlegeprotokoll</h1>
		<p class="text-ink-2">Eigenüberwachungs-Protokoll für Markierungsfolien · {data.order.title || 'Ohne BV'}</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		{#if locked}<span class="badge badge-ok"><Lock size={13} aria-hidden="true" />Abgeschlossen</span>{/if}
		<PdfButton href="/auftraege/{data.order.id}/arbeitsauftrag/folie/pdf"><FileText size={18} aria-hidden="true" />PDF</PdfButton>
	</div>
</div>

{#if form && 'message' in form && form.message && !signOpen}
	<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>
{/if}
{#if data.lockedByOrder}
	<p class="mb-4 text-sm text-ink-3">Der Auftraggeber hat den Arbeitsauftrag unterschrieben – das Protokoll lässt sich nicht mehr ändern.</p>
{:else if data.foil.signatures.auftraggeber}
	<p class="mb-4 text-sm text-ink-3">Vom Auftraggeber anerkannt – zum Ändern zuerst seine Unterschrift entfernen.</p>
{:else if !data.canEdit}
	<p class="mb-4 text-sm text-ink-3">Das Verlegeprotokoll füllt die Partie aus – du kannst es nur ansehen.</p>
{/if}

<form
	id="folie"
	method="POST"
	action="?/save"
	use:enhance={({ action }) => {
		busy = true;
		const signing = action.search === '?/sign';
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				toast.success(signing ? 'Unterschrift gespeichert' : 'Gespeichert');
				if (signing) signOpen = false;
			}
			await update({ reset: false });
		};
	}}
>
	<input type="hidden" name="inhalt" value={payload} />
	{#if signOpen}
		<input type="hidden" name="wer" value={signRole} />
		<input type="hidden" name="name" value={signName} />
		<input type="hidden" name="unterschrift" value={signPath} />
	{/if}

	<fieldset disabled={!editable} class="space-y-4">
		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">1.0 Angaben zur Straße</h2>
			<div class="mt-3 grid gap-3 sm:grid-cols-2">
				<label class="block sm:col-span-2">
					<span class="field-label">1.1 Ort und Straßenbezeichnung</span>
					<input class="input" maxlength="160" bind:value={f.place} />
				</label>
				<label class="block">
					<span class="field-label">1.2 Von – bis, bzw. km</span>
					<input class="input" maxlength="120" bind:value={f.section} />
				</label>
				<label class="block">
					<span class="field-label">1.3 Fahrbahndeckenart</span>
					<input class="input" maxlength="120" bind:value={f.surface} />
				</label>
				<label class="block">
					<span class="field-label">1.4 Spurbreite</span>
					<input class="input" maxlength="60" bind:value={f.laneWidth} />
				</label>
			</div>
			{#each CHOICES as c (c.key)}
				<div class="mt-4">
					<p class="field-label">{c.nr} {c.label}</p>
					<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
						{#each c.options as o (o.key)}
							<label class="flex items-center gap-2"><input type="checkbox" class="size-5 accent-[var(--c-ink)]" checked={(f[c.key] as Record<string, boolean>)[o.key]} onchange={(e) => ((f[c.key] as Record<string, boolean>)[o.key] = e.currentTarget.checked)} />{o.label}</label>
						{/each}
						<span class="flex min-w-[12rem] flex-1 items-center gap-2">
							<input type="checkbox" class="size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={f[c.key].other} aria-label="{c.label}: anderes" />
							<input class="input input-sm" maxlength="60" placeholder="Anderes" bind:value={f[c.key].otherText} oninput={() => (f[c.key].other ||= !!f[c.key].otherText.trim())} />
						</span>
					</div>
				</div>
			{/each}
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">2.0 Angaben zum Wetter</h2>
			<p class="field-label mt-3">2.1 Messung</p>
			<div class="overflow-x-auto">
				<div class="grid min-w-[30rem] grid-cols-[minmax(10rem,1fr)_repeat(4,5.5rem)] items-center gap-2">
					<span></span>
					{#each FOIL_TIMES as t (t)}<span class="text-center text-sm text-ink-3">{t}</span>{/each}
					{#each WEATHER as w (w.key)}
						<span class="text-sm">{w.label}</span>
						{#each FOIL_TIMES as t, i (t)}
							<input class="input input-sm num text-center" inputmode="decimal" maxlength="12" bind:value={f.weather[w.key][i]} aria-label="{w.label} um {t}" />
						{/each}
					{/each}
				</div>
			</div>
			<div class="mt-4 flex flex-wrap items-center gap-2">
				<span class="field-label mb-0">2.2 Letzter Regen vor</span>
				<input class="input input-sm num w-20 text-center" inputmode="numeric" maxlength="12" bind:value={f.rainDays} aria-label="Tagen" />
				<span>Tagen</span>
				<input class="input input-sm num w-20 text-center" inputmode="numeric" maxlength="12" bind:value={f.rainHours} aria-label="Stunden" />
				<span>Stunden</span>
			</div>
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">3.0 Angaben zur Verlegung</h2>
			<p class="field-label mt-3">3.1 Folien</p>
			<div class="space-y-3">
				{#each f.films as film, i (i)}
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
				<label class="block"><span class="field-label">3.2 Lot-Nr. Folie (Aufkleber)</span><input class="input" maxlength="40" bind:value={f.lotFilm} /></label>
				<label class="block"><span class="field-label">Lot-Nr. Primer</span><input class="input" maxlength="40" bind:value={f.lotPrimer} /></label>
				<label class="block"><span class="field-label">Lot-Nr. DS01E</span><input class="input" maxlength="40" bind:value={f.lotDs01e} /></label>
			</div>
			{#each LAYING as c (c.key)}
				<div class="mt-4">
					<p class="field-label">{c.nr} {c.label}</p>
					<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
						{#each c.options as o (o.key)}
							<label class="flex items-center gap-2"><input type="checkbox" class="size-5 accent-[var(--c-ink)]" checked={(f[c.key] as Record<string, boolean>)[o.key]} onchange={(e) => ((f[c.key] as Record<string, boolean>)[o.key] = e.currentTarget.checked)} />{o.label}</label>
						{/each}
						<span class="flex min-w-[12rem] flex-1 items-center gap-2">
							<input type="checkbox" class="size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={f[c.key].other} aria-label="{c.label}: anderes" />
							<input class="input input-sm" maxlength="60" placeholder="Anderes" bind:value={f[c.key].otherText} oninput={() => (f[c.key].other ||= !!f[c.key].otherText.trim())} />
						</span>
					</div>
				</div>
			{/each}
			<div class="mt-4">
				<p class="field-label">3.6 Streckenfreigabe</p>
				<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
					<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="gleich" bind:group={f.release} />gleicher Tag</label>
					<label class="flex items-center gap-2">
						<input type="radio" class="accent-[var(--c-ink)]" value="nach" bind:group={f.release} />nach
						<input class="input input-sm num w-20 text-center" inputmode="numeric" maxlength="12" bind:value={f.releaseDays} oninput={() => f.releaseDays.trim() && (f.release = 'nach')} aria-label="Tagen" />
						Tagen
					</label>
					<label class="flex items-center gap-2 text-ink-3"><input type="radio" class="accent-[var(--c-ink)]" value="" bind:group={f.release} />offen</label>
				</div>
			</div>
			<div class="mt-4 grid gap-3 sm:grid-cols-2">
				<label class="block"><span class="field-label">3.7 Verlegedatum</span><input class="input" type="date" bind:value={f.layingDate} /></label>
				<label class="block"><span class="field-label">3.8 Voraussichtl. Datum der Demarkierung</span><input class="input" type="date" bind:value={f.removalDate} /></label>
			</div>
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">4.0 Bemerkungen</h2>
			<textarea class="textarea mt-3" rows="3" maxlength="300" bind:value={f.remarks}></textarea>
		</section>
	</fieldset>

	<section class="card mt-4 p-4 lg:p-5">
		<h2 class="text-lg">Unterschriften</h2>
		<div class="mt-3 grid gap-3 lg:grid-cols-2">
			<SignatureTile {...tile('auftraggeber')} />
			<SignatureTile {...tile('auftragnehmer')} />
		</div>
	</section>

	{#if editable}
		<div class="card sticky bottom-24 mt-4 flex flex-wrap items-center gap-2 p-3 lg:bottom-6">
			<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Speichern'}</button>
			<span class="ml-auto text-sm text-ink-3">
				{data.updatedAt ? `Zuletzt gespeichert ${dateTime(data.updatedAt)}${data.updatedByName ? ` von ${data.updatedByName}` : ''}` : ''}
			</span>
		</div>
	{/if}
</form>

<Dialog bind:open={signOpen} title={FOIL_SIGNATURE_LABELS[signRole]}>
	<p class="text-ink-2">
		{signRole === 'auftraggeber'
			? 'Gib das Gerät dem Auftraggeber: Er trägt seinen Namen ein und bestätigt das Protokoll. Danach lässt es sich nicht mehr ändern.'
			: 'Was im Protokoll steht, wird vorher gespeichert.'}
	</p>
	<label class="mt-4 block">
		<span class="field-label">Name</span>
		<input class="input" maxlength="120" autocomplete="off" bind:value={signName} />
	</label>
	<div class="mt-3"><SignaturePad bind:path={signPath} /></div>
	{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
	<div class="mt-4 flex flex-wrap justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (signOpen = false)}>Abbrechen</button>
		<button type="submit" form="folie" formaction="?/sign" class="btn btn-primary" disabled={busy || !signPath || signName.trim().length < 2}>
			<Signature size={18} aria-hidden="true" />Unterschrift speichern
		</button>
	</div>
</Dialog>

<Dialog open={removeRole !== null} title="Unterschrift entfernen?" onclose={() => (removeRole = null)}>
	<p class="text-ink-2">„{removeRole ? FOIL_SIGNATURE_LABELS[removeRole] : ''}“ wird entfernt.</p>
	<form
		method="POST"
		action="?/unsign"
		class="mt-5 flex justify-end gap-2"
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') {
				toast.info('Unterschrift entfernt');
				removeRole = null;
			}
			await update({ reset: false });
		}}
	>
		<input type="hidden" name="wer" value={removeRole ?? ''} />
		<button type="button" class="btn btn-ghost" onclick={() => (removeRole = null)}>Abbrechen</button>
		<button class="btn btn-primary">Entfernen</button>
	</form>
</Dialog>
