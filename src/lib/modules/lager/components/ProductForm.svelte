<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { fly } from 'svelte/transition';
	import X from '@lucide/svelte/icons/x';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CodeInput from './CodeInput.svelte';
	import { UNITS } from '$lib/format';
	import { displayGtin, normalizeCode, pickBestParse } from '$lib/modules/lager/scan/parse';
	import { feedbackSuccess } from '$lib/modules/lager/scan/feedback';
	import { toast } from '$lib/stores/toast.svelte';

	type Code = { code: string; kind: 'ean' | 'artikel' | 'sonstige' };
	interface Values {
		name: string;
		articleNumber: string;
		manufacturer: string;
		categoryId: string;
		colorId: string;
		packageSize: string;
		unit: string;
		minStock: string;
		targetStock: string;
		notes: string;
		active: boolean;
	}

	interface Props {
		mode: 'new' | 'edit';
		initial: Values;
		initialCodes: Code[];
		categories: { id: number; name: string }[];
		colors: { id: number; name: string; ral: string | null; hex: string }[];
		manufacturers: string[];
		errors?: Record<string, string>;
		/** Ein Code gehört schon zu einem anderen Artikel – Rückfrage statt Fehler */
		codeConflict?: string | null;
		scan?: string | null;
		action?: string;
	}
	let {
		mode,
		initial,
		initialCodes,
		categories,
		colors,
		manufacturers,
		errors = {},
		codeConflict = null,
		scan = null,
		action = ''
	}: Props = $props();

	// Bewusst nur der Startwert: Die Seite baut das Formular per {#key} neu auf, wenn sich die Vorlage ändert
	// svelte-ignore state_referenced_locally
	let v = $state<Values>({ ...initial });
	// svelte-ignore state_referenced_locally
	let codes = $state<Code[]>([...initialCodes]);
	let codeDraft = $state('');
	let filled = $state<string[]>([]);
	let flash = $state(new Set<string>());
	let busy = $state(false);
	let nameInput: HTMLInputElement;

	const KIND_LABEL = { ean: 'EAN', artikel: 'Artikelnr.', sonstige: 'Code' } as const;

	function addCode(code: string, kind: Code['kind']) {
		const n = normalizeCode(code);
		if (!n || codes.some((c) => normalizeCode(c.code) === n)) return false;
		codes = [...codes, { code, kind }];
		return true;
	}

	/** Scan auswerten und leere Felder aus dem DataMatrix-Inhalt füllen */
	function applyScan(variants: string[]) {
		const p = pickBestParse(variants);
		codeDraft = '';
		if (!p) return;
		const hit: string[] = [];
		const primary = p.gtin ? displayGtin(p.gtin) : (p.fields.ean ?? (p.format === 'text' ? p.text : null));
		if (primary && addCode(primary, p.gtin || p.fields.ean ? 'ean' : 'sonstige')) hit.push('codes');
		if (p.fields.sap && addCode(p.fields.sap, 'sonstige')) hit.push('codes');
		if (p.fields.name && !v.name.trim()) {
			v.name = p.fields.name;
			hit.push('name');
		}
		if (p.fields.article && !v.articleNumber.trim()) {
			v.articleNumber = p.fields.article;
			hit.push('articleNumber');
		}
		if (p.fields.packageSize && !v.packageSize.trim()) {
			v.packageSize = String(p.fields.packageSize).replace('.', ',');
			if (p.fields.unit && UNITS.some((u) => u.value === p.fields.unit)) v.unit = p.fields.unit;
			hit.push('packageSize');
		}
		if ((p.fields.ral || p.fields.color) && !v.colorId) {
			// RAL-Nummer vom Etikett hat Vorrang vor dem Farbwort im Namen
			const c =
				(p.fields.ral && colors.find((c) => c.ral === p.fields.ral)) ||
				(p.fields.color && colors.find((c) => c.name.toLowerCase() === p.fields.color!.toLowerCase()));
			if (c) {
				v.colorId = String(c.id);
				hit.push('colorId');
			}
		}
		if (p.fields.category && !v.categoryId) {
			const c = categories.find((c) => c.name.toLowerCase() === p.fields.category!.toLowerCase());
			if (c) {
				v.categoryId = String(c.id);
				hit.push('categoryId');
			}
		}
		if (hit.length) {
			feedbackSuccess();
			filled = [...new Set(hit)];
			flash = new Set(hit);
			setTimeout(() => (flash = new Set()), 1700);
		}
	}

	onMount(() => {
		if (scan) applyScan([scan]);
	});

	const fieldNames: Record<string, string> = {
		codes: 'Code',
		name: 'Name',
		articleNumber: 'Artikelnummer',
		packageSize: 'Inhalt',
		colorId: 'Farbe',
		categoryId: 'Materialart'
	};

	const fl = (k: string) => (flash.has(k) ? 'animate-flash rounded-xl' : '');
</script>

<form
	method="POST"
	{action}
	class="grid gap-4 lg:grid-cols-3"
	use:enhance={({ submitter }) => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success' && result.data?.created) {
				const created = result.data.created as { name: string };
				toast.success('Artikel angelegt', created.name);
				v = { ...initial };
				codes = [];
				filled = [];
				await update({ reset: true });
				await tick();
				document.getElementById('code-draft')?.focus();
				return;
			}
			await update({ reset: false });
			if (submitter) (submitter as HTMLButtonElement).blur();
		};
	}}
>
	<input type="hidden" name="codes" value={JSON.stringify(codes)} />

	<div class="space-y-4 lg:col-span-2">
		<section class="card p-4 lg:p-6">
			<h2 class="text-xl">Erkennung</h2>
			<p class="mt-1 text-sm text-ink-2">Barcode oder DataMatrix vom Etikett scannen – leere Felder werden automatisch ausgefüllt.</p>
			<div class="mt-4 {fl('codes')}">
				<label for="code-draft" class="field-label">EAN, Barcode oder DataMatrix</label>
				<CodeInput id="code-draft" bind:value={codeDraft} placeholder="Scannen oder eintippen und Enter" oncode={applyScan} scanTitle="Etikett scannen" />
				{#if errors.codes}<p class="field-error" role="alert">{errors.codes}</p>{/if}
			</div>
			{#if codes.length}
				<ul class="mt-3 flex flex-wrap gap-2">
					{#each codes as c, i (c.code)}
						<li class="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 py-1 pr-1 pl-3" in:fly={{ y: 6, duration: 200 }}>
							<span class="text-[0.8125rem] text-ink-3">{KIND_LABEL[c.kind]}</span>
							<span class="num font-medium">{c.code}</span>
							<button type="button" class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Code {c.code} entfernen" onclick={() => (codes = codes.filter((_, j) => j !== i))}>
								<X size={14} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if codeConflict}
				<div class="mt-3 flex items-start gap-3 rounded-xl bg-warn-soft p-3 text-sm" role="alert">
					<TriangleAlert size={18} class="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
					<div>
						<p class="font-medium">{codeConflict}</p>
						<p class="mt-1 text-ink-2">
							Tragen zwei verschiedene Produkte wirklich dieselbe Nummer, darf sie doppelt vergeben werden – beim Scannen fragt die App
							dann, welcher Artikel gemeint ist.
						</p>
						<button class="btn btn-secondary btn-sm mt-3" name="allowSharedCodes" value="1" disabled={busy}>Trotzdem speichern</button>
					</div>
				</div>
			{/if}
			{#if filled.length}
				<p class="mt-3 flex items-center gap-2 text-sm text-ink-2" in:fly={{ y: 4, duration: 200 }}>
					<Sparkles size={16} class="text-mark" aria-hidden="true" />
					Übernommen: {filled.map((f) => fieldNames[f]).join(', ')}
				</p>
			{/if}
		</section>

		<section class="card space-y-4 p-4 lg:p-6">
			<h2 class="text-xl">Artikel</h2>
			<div class={fl('name')}>
				<label for="name" class="field-label">Bezeichnung *</label>
				<input id="name" name="name" class="input" required maxlength="200" bind:value={v.name} bind:this={nameInput} aria-invalid={errors.name ? true : undefined} />
				{#if errors.name}<p class="field-error">{errors.name}</p>{/if}
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class={fl('articleNumber')}>
					<label for="articleNumber" class="field-label">Artikelnummer</label>
					<input id="articleNumber" name="articleNumber" class="input" maxlength="60" bind:value={v.articleNumber} />
					<p class="field-hint">Ist automatisch auch scanbar.</p>
				</div>
				<div>
					<label for="manufacturer" class="field-label">Hersteller / Lieferant</label>
					<input id="manufacturer" name="manufacturer" class="input" list="manufacturers" maxlength="120" bind:value={v.manufacturer} />
					<datalist id="manufacturers">{#each manufacturers as m (m)}<option value={m}></option>{/each}</datalist>
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class={fl('categoryId')}>
					<label for="categoryId" class="field-label">Materialart</label>
					<select id="categoryId" name="categoryId" class="select" bind:value={v.categoryId}>
						<option value="">Keine</option>
						{#each categories as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
					</select>
				</div>
				<div class={fl('packageSize')}>
					<span class="field-label" id="pkg-label">Inhalt je Stück</span>
					<div class="flex gap-2">
						<input
							id="packageSize"
							name="packageSize"
							class="input flex-1"
							inputmode="decimal"
							placeholder="z. B. 15"
							aria-labelledby="pkg-label"
							bind:value={v.packageSize}
							aria-invalid={errors.packageSize ? true : undefined}
						/>
						<select name="unit" class="select w-28" aria-label="Einheit" bind:value={v.unit}>
							{#each UNITS as u (u.value)}<option value={u.value}>{u.label}</option>{/each}
						</select>
					</div>
					{#if errors.packageSize}<p class="field-error">{errors.packageSize}</p>{/if}
				</div>
			</div>

			<fieldset class={fl('colorId')}>
				<legend class="field-label">Farbe</legend>
				<div class="flex flex-wrap gap-2">
					<label class="color-chip">
						<input type="radio" name="colorId" value="" bind:group={v.colorId} class="sr-only" />
						<span class="size-4 rounded-full border border-dashed border-ink-3"></span>Keine
					</label>
					{#each colors as c (c.id)}
						<label class="color-chip" title={c.ral ? `RAL ${c.ral}` : undefined}>
							<input type="radio" name="colorId" value={String(c.id)} bind:group={v.colorId} class="sr-only" />
							<span class="size-4 rounded-full border border-black/15" style:background={c.hex}></span>{c.name}
							{#if c.ral}<span class="num text-[0.8125rem] font-normal text-ink-3">RAL {c.ral}</span>{/if}
						</label>
					{/each}
				</div>
			</fieldset>

			<div>
				<label for="notes" class="field-label">Notiz</label>
				<textarea id="notes" name="notes" class="textarea" maxlength="2000" rows="3" bind:value={v.notes} placeholder="z. B. Lagerhinweise, Mischverhältnis"></textarea>
			</div>
		</section>
	</div>

	<div class="space-y-4">
		<section class="card space-y-4 p-4 lg:p-6">
			<h2 class="text-xl">Bestandsgrenzen</h2>
			<div>
				<label for="minStock" class="field-label">Mindestbestand (Stück)</label>
				<input id="minStock" name="minStock" class="input" inputmode="numeric" bind:value={v.minStock} aria-invalid={errors.minStock ? true : undefined} aria-describedby="min-hint" />
				<p id="min-hint" class="field-hint">Wird er erreicht, erscheint der Artikel auf der Bestellliste und es gibt eine Benachrichtigung (je nach Einstellung auch als Info-Mail).</p>
				{#if errors.minStock}<p class="field-error">{errors.minStock}</p>{/if}
			</div>
			<div>
				<label for="targetStock" class="field-label">Sollbestand (Stück)</label>
				<input id="targetStock" name="targetStock" class="input" inputmode="numeric" bind:value={v.targetStock} aria-invalid={errors.targetStock ? true : undefined} aria-describedby="target-hint" />
				<p id="target-hint" class="field-hint">Bis hierhin wird beim Nachbestellen aufgefüllt.</p>
				{#if errors.targetStock}<p class="field-error">{errors.targetStock}</p>{/if}
			</div>
			{#if mode === 'edit'}
				<label class="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
					<input type="checkbox" name="active" class="mt-0.5 size-5 accent-[var(--c-ink)]" bind:checked={v.active} />
					<span><span class="font-medium">Aktiv</span><span class="block text-sm text-ink-3">Inaktive Artikel verschwinden aus Suche und Buchung.</span></span>
				</label>
				<input type="hidden" name="active" value={v.active ? 'on' : 'off'} disabled={v.active} />
			{/if}
		</section>

		<div class="card sticky bottom-24 space-y-2 p-4 lg:bottom-6">
			<button class="btn btn-primary w-full" name="intent" value="save" disabled={busy}>{mode === 'new' ? 'Artikel anlegen' : 'Änderungen speichern'}</button>
			{#if mode === 'new'}
				<button class="btn btn-secondary w-full" name="intent" value="next" disabled={busy}>Anlegen und nächsten erfassen</button>
			{/if}
		</div>
	</div>
</form>

<style>
	.color-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		height: 2.5rem;
		padding: 0 0.875rem 0 0.625rem;
		border-radius: 999px;
		border: 1px solid var(--c-line-strong);
		font-size: 0.9375rem;
		cursor: pointer;
		transition:
			border-color 140ms var(--ease-out),
			background-color 140ms var(--ease-out);
	}
	.color-chip:hover {
		border-color: var(--c-ink-3);
	}
	.color-chip:has(input:checked) {
		border-color: var(--c-ink);
		background: var(--c-surface-3);
		font-weight: 600;
	}
	.color-chip:has(input:focus-visible) {
		outline: 2px solid var(--c-focus);
		outline-offset: 2px;
	}
</style>
