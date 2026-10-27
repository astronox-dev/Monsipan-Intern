<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Check from '@lucide/svelte/icons/check';
	import Search from '@lucide/svelte/icons/search';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import ProductAvatar from '$lib/modules/lager/components/ProductAvatar.svelte';
	import { int, packageLabel } from '$lib/format';
	import { lookupScan } from '$lib/modules/lager/scan/lookup';
	import { onScan } from '$lib/modules/lager/scan/wedge';
	import { scanner } from '$lib/modules/lager/scan/scanner.svelte';
	import { feedbackError, feedbackSaved, feedbackSuccess } from '$lib/modules/lager/scan/feedback';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();

	type Item = (typeof data.items)[number];
	/** Gezählte Mengen je Artikel, solange die Inventur läuft */
	let counted = $state<Record<number, string>>({});
	/** Artikel, die am Lagerort keinen Bestand haben, aber gezählt wurden */
	let extra = $state<Item[]>([]);
	let filter = $state('');
	let busy = $state(false);
	let note = $state('');

	const items = $derived([...data.items, ...extra]);
	const shown = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return items;
		return items.filter((i) => `${i.name} ${i.articleNumber ?? ''}`.toLowerCase().includes(q));
	});

	const parse = (v: string | undefined) => {
		const s = String(v ?? '').trim();
		if (!s) return null;
		const n = Number(s.replace(',', '.'));
		return Number.isInteger(n) && n >= 0 ? n : null;
	};
	const countedCount = $derived(items.filter((i) => parse(counted[i.id]) !== null).length);
	const diffCount = $derived(items.filter((i) => parse(counted[i.id]) !== null && parse(counted[i.id]) !== i.quantity).length);
	const lines = $derived(
		items
			.map((i) => ({ productId: i.id, counted: parse(counted[i.id]) }))
			.filter((l): l is { productId: number; counted: number } => l.counted !== null)
	);

	function selectLocation(id: number | null) {
		counted = {};
		extra = [];
		goto(id ? `/lager/inventur?ort=${id}` : '/lager/inventur', { keepFocus: true, noScroll: true });
	}

	/** Alles, was noch leer ist, mit dem Systembestand füllen */
	function takeAll() {
		const next = { ...counted };
		for (const i of items) if (parse(next[i.id]) === null) next[i.id] = String(i.quantity);
		counted = next;
	}

	async function focusRow(id: number) {
		await tick();
		const el = document.getElementById(`zaehl-${id}`) as HTMLInputElement | null;
		el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		el?.focus();
		el?.select();
	}

	/** Scan: Artikel in der Liste suchen, sonst anhängen – gezählt wird von Hand */
	async function handleScan(variants: string[]) {
		if (!data.locationId) {
			feedbackError();
			toast.error('Zuerst den Lagerort wählen');
			return;
		}
		try {
			const r = await lookupScan(variants);
			if (!r.products.length) {
				feedbackError();
				scanner.report(false, 'Unbekannter Code');
				if (!scanner.open) toast.error('Unbekannter Code', r.parsed?.text ?? undefined);
				return;
			}
			if (r.products.length > 1) {
				feedbackError();
				scanner.report(false, 'Mehrere Artikel – bitte in der Liste suchen');
				return;
			}
			const p = r.products[0];
			const known = items.find((i) => i.id === p.id);
			if (!known) {
				extra = [
					...extra,
					{
						id: p.id,
						name: p.name,
						articleNumber: p.articleNumber,
						packageSize: p.packageSize,
						unit: p.unit,
						categoryName: p.categoryName,
						colorHex: p.colorHex,
						quantity: p.locations.find((l) => l.locationId === data.locationId)?.quantity ?? 0
					}
				];
			}
			// Jeder Scan zählt ein Stück mit; die Menge lässt sich danach überschreiben
			const current = parse(counted[p.id]) ?? 0;
			counted = { ...counted, [p.id]: String(current + 1) };
			feedbackSuccess();
			scanner.report(true, `${p.name} – ${current + 1}`);
			focusRow(p.id);
		} catch {
			feedbackError();
			toast.error('Suche fehlgeschlagen', 'Bitte Verbindung prüfen.');
		}
	}

	onMount(() => onScan((s) => handleScan(s.variants)));
</script>

<svelte:head><title>{pageTitle('Inventur')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><ClipboardCheck size={26} aria-hidden="true" />Inventur</h1>
		<p class="text-ink-2">Lagerort wählen, zählen, buchen. Gebucht wird nur, was eingetragen ist.</p>
	</div>
	<button class="btn btn-secondary" onclick={() => scanner.openCamera({ mode: 'continuous', title: 'Artikel zählen' })}>
		<ScanLine size={18} aria-hidden="true" />Mit Kamera zählen
	</button>
</div>

<section class="card flex flex-wrap items-end gap-3 p-4">
	<div class="min-w-[14rem] flex-1">
		<label for="ort" class="field-label">Lagerort *</label>
		<select
			id="ort"
			class="select"
			value={data.locationId}
			onchange={(e) => selectLocation(Number((e.currentTarget as HTMLSelectElement).value) || null)}
		>
			<option value={null}>Bitte wählen</option>
			{#each data.locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
		</select>
	</div>
	{#if data.locationId}
		<div class="min-w-[12rem] flex-1">
			<label for="suche" class="field-label">Suche</label>
			<input id="suche" class="input" bind:value={filter} placeholder="Name oder Artikelnummer" />
		</div>
		<button type="button" class="btn btn-secondary" onclick={takeAll}><Check size={18} aria-hidden="true" />Alle übernehmen</button>
	{/if}
</section>

{#if !data.locationId}
	<div class="card mt-4 p-10 text-center">
		<p class="font-medium">Zuerst den Lagerort wählen</p>
		<p class="mt-1 text-sm text-ink-3">Danach erscheinen alle Artikel, die dort Bestand haben.</p>
	</div>
{:else}
	<form
		method="POST"
		action="?/save"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'success') {
					feedbackSaved();
					toast.success('Inventur gebucht', `${lines.length} Artikel gezählt`);
					counted = {};
					extra = [];
					await invalidate('app:stock');
				}
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="payload" value={JSON.stringify({ locationId: data.locationId, note, lines })} />

		{#if form && 'message' in form && form.message}
			<div class="mt-4 flex gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger" role="alert">
				<TriangleAlert size={18} class="mt-px shrink-0" aria-hidden="true" />
				<p class="font-medium">{form.message}</p>
			</div>
		{/if}

		<div class="card mt-4 overflow-hidden">
			<ul>
				{#each shown as item (item.id)}
					{@const value = parse(counted[item.id])}
					{@const diff = value === null ? null : value - item.quantity}
					<li class="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0 {value !== null ? 'bg-surface-2/60' : ''}">
						<ProductAvatar colorHex={item.colorHex} category={item.categoryName} size="sm" />
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{item.name}</p>
							<p class="truncate text-[0.8125rem] text-ink-3">
								{[item.articleNumber && `Art.-Nr. ${item.articleNumber}`, packageLabel(item.packageSize, item.unit)]
									.filter(Boolean)
									.join(' · ')}
							</p>
						</div>
						<div class="w-16 text-right">
							<p class="num font-semibold">{int(item.quantity)}</p>
							<p class="text-[0.75rem] text-ink-3">Bestand</p>
						</div>
						<div class="w-24">
							<input
								id="zaehl-{item.id}"
								class="input input-sm num text-right"
								inputmode="numeric"
								placeholder="–"
								aria-label="Gezählte Menge {item.name}"
								bind:value={counted[item.id]}
							/>
						</div>
						<div class="num w-16 text-right text-sm font-semibold {diff ? (diff > 0 ? 'text-ok' : 'text-danger') : 'text-ink-3'}">
							{diff === null ? '' : diff > 0 ? `+${diff}` : diff}
						</div>
					</li>
				{:else}
					<li class="p-10 text-center text-ink-3">
						{filter ? 'Kein Artikel passt zur Suche.' : 'An diesem Lagerort liegt nichts. Artikel lassen sich durch Scannen ergänzen.'}
					</li>
				{/each}
			</ul>
		</div>

		<div class="card lg:sticky mt-4 flex flex-wrap items-center gap-3 p-3 lg:bottom-6">
			<button class="btn btn-primary" disabled={busy || !lines.length}>
				{busy ? 'Wird gebucht …' : `Inventur buchen (${lines.length})`}
			</button>
			<input class="input input-sm max-w-[16rem] flex-1" maxlength="500" placeholder="Notiz, z. B. Stichtag" bind:value={note} />
			<p class="num ml-auto text-sm text-ink-2">
				{countedCount} von {items.length} gezählt{diffCount ? ` · ${diffCount} mit Abweichung` : ''}
			</p>
		</div>
	</form>
{/if}
