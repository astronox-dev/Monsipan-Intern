<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash';
	import Barcode from '@lucide/svelte/icons/barcode';
	import FileText from '@lucide/svelte/icons/file-text';
	import FileUp from '@lucide/svelte/icons/file-up';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Dialog from '$lib/components/Dialog.svelte';
	import { DOCUMENT_KIND_LABELS, fileSizeLabel, MAX_DOCUMENT_BYTES, titleFromFileName, type DocumentKind } from '$lib/documents';
	import ProductAvatar from '$lib/modules/lager/components/ProductAvatar.svelte';
	import StockStatus from '$lib/modules/lager/components/StockStatus.svelte';
	import MovementList from '$lib/modules/lager/components/MovementList.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import BarChart from '$lib/components/BarChart.svelte';
	import CodeInput from '$lib/modules/lager/components/CodeInput.svelte';
	import { amountLabel, int, monthLong, monthShort, packageLabel } from '$lib/format';
	import { can } from '$lib/permissions';
	import { displayGtin, pickBestParse } from '$lib/modules/lager/scan/parse';
	import { feedbackError, feedbackSuccess } from '$lib/modules/lager/scan/feedback';
	import { toast } from '$lib/stores/toast.svelte';

	let { data } = $props();
	const p = $derived(data.product);
	const canBook = $derived(can(data.user.role, 'lager.bestand.buchen'));
	const canInventory = $derived(can(data.user.role, 'lager.bestand.inventur'));
	const canManage = $derived(can(data.user.role, 'lager.artikel.bearbeiten'));
	const maxQty = $derived(Math.max(1, ...p.locations.map((l) => l.quantity)));

	const KIND_LABEL = { ean: 'EAN / GTIN', artikel: 'Artikelnummer', sonstige: 'Weiterer Code' } as const;

	let newCode = $state('');
	let adding = $state(false);
	/** Der Code gehört schon zu einem anderen Artikel – erst nachfragen */
	let codeConflict = $state<{ code: string; kind: 'ean' | 'artikel' | 'sonstige'; message: string } | null>(null);

	async function addCode(variants: string[]) {
		const parsed = pickBestParse(variants);
		if (!parsed) return;
		const code = parsed.gtin ? displayGtin(parsed.gtin) : (parsed.fields.ean ?? parsed.fields.article ?? parsed.text);
		const kind = parsed.gtin || parsed.fields.ean ? 'ean' : parsed.fields.article ? 'artikel' : 'sonstige';
		await postCode(code, kind);
	}

	async function postCode(code: string, kind: 'ean' | 'artikel' | 'sonstige', shared = false) {
		adding = true;
		try {
			const res = await fetch('/api/codes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ productId: p.id, code, kind, shared })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				feedbackError();
				if (body.conflict && !shared) {
					codeConflict = { code, kind, message: body.message };
					return;
				}
				toast.error('Code nicht hinzugefügt', body.message);
				return;
			}
			codeConflict = null;
			feedbackSuccess();
			newCode = '';
			toast.success('Code hinzugefügt', code);
			await invalidateAll();
		} finally {
			adding = false;
		}
	}

	// Materialbeschreibungen (PDF)
	let uploadOpen = $state(false);
	let uploadFile = $state<File | null>(null);
	let uploadTitle = $state('');
	let uploadKind = $state<DocumentKind>('materialbeschreibung');
	let uploadError = $state('');
	let uploading = $state(false);
	let removeDoc = $state<(typeof data.documents)[number] | null>(null);
	let removeOpen = $state(false);

	function openUpload() {
		uploadFile = null;
		uploadTitle = '';
		uploadKind = 'materialbeschreibung';
		uploadError = '';
		uploadOpen = true;
	}

	function pickFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		uploadError = '';
		if (file && file.size > MAX_DOCUMENT_BYTES) {
			uploadError = `Die Datei ist zu groß – erlaubt sind ${fileSizeLabel(MAX_DOCUMENT_BYTES)}.`;
			uploadFile = null;
			return;
		}
		uploadFile = file;
		if (file && !uploadTitle.trim()) uploadTitle = titleFromFileName(file.name);
	}

	const consumption = $derived(data.consumption ?? []);
	const chartData = $derived(
		consumption.map((c, i) => ({
			key: c.month,
			label: monthShort(c.month),
			longLabel: monthLong(c.month),
			value: c.qty,
			partial: i === consumption.length - 1
		}))
	);
	const yearTotal = $derived(consumption.reduce((s, c) => s + c.qty, 0));
</script>

<svelte:head><title>{pageTitle(p.name)}</title></svelte:head>

<a href="/lager/bestand" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Bestand
</a>

<header class="mt-3 flex flex-col gap-5 pb-6 xl:flex-row xl:items-start xl:justify-between">
	<div class="flex items-start gap-4">
		<ProductAvatar colorHex={p.colorHex} category={p.categoryName} size="lg" />
		<div class="min-w-0">
			<h1 class="text-[1.75rem] leading-tight sm:text-[2rem]">{p.name}</h1>
			<div class="mt-2 flex flex-wrap items-center gap-1.5">
				{#if p.categoryName}<span class="badge">{p.categoryName}</span>{/if}
				{#if p.colorName}
					<span class="badge"
						><span class="size-2.5 rounded-full border border-black/10" style:background={p.colorHex}></span>{p.colorName}{#if p.colorRal}<span
								class="num text-ink-3">RAL {p.colorRal}</span
							>{/if}</span
					>
				{/if}
				{#if p.packageSize}<span class="badge">{packageLabel(p.packageSize, p.unit)} je Stück</span>{/if}
				<StockStatus total={p.total} minStock={p.minStock} active={p.active} />
			</div>
		</div>
	</div>

	<div class="flex flex-wrap gap-2">
		{#if canBook && p.active}
			<a href="/lager/buchen?art=OUT&produkt={p.id}" class="btn btn-primary"><ArrowUpFromLine size={18} aria-hidden="true" />Ausbuchen</a>
			<a href="/lager/buchen?art=IN&produkt={p.id}" class="btn btn-secondary"><ArrowDownToLine size={18} aria-hidden="true" />Einbuchen</a>
			<a href="/lager/buchen?art=TRANSFER&produkt={p.id}" class="btn btn-secondary"><ArrowLeftRight size={18} aria-hidden="true" />Umlagern</a>
		{/if}
		{#if canInventory}
			<a href="/lager/inventur" class="btn btn-secondary"><ClipboardCheck size={18} aria-hidden="true" />Inventur</a>
		{/if}
		{#if canManage}
			<a href="/lager/artikel/{p.id}/bearbeiten" class="btn btn-ghost"><Pencil size={18} aria-hidden="true" />Bearbeiten</a>
		{/if}
	</div>
</header>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
	<div class="min-w-0 space-y-4 lg:col-span-2">
		<!-- Bestand je Lagerort -->
		<section class="card p-4 lg:p-6" aria-labelledby="h-stock">
			<div class="flex items-end justify-between gap-4">
				<h2 id="h-stock" class="text-xl">Bestand je Lagerort</h2>
				<div class="text-right">
					<p class="num font-display text-[2.5rem] leading-none font-semibold">{int(p.total)}</p>
					<p class="mt-1 text-sm text-ink-3">
						Stück{amountLabel(p.total, p.packageSize, p.unit) ? `, ${amountLabel(p.total, p.packageSize, p.unit)}` : ''}
					</p>
				</div>
			</div>
			{#if p.locations.length}
				<ul class="mt-5 space-y-3">
					{#each p.locations as l (l.locationId)}
						<li class="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
							<span class="truncate text-[0.9375rem]">{l.name}</span>
							<span class="h-2 overflow-hidden rounded-full bg-surface-3">
								<span class="block h-full rounded-full bg-ink/80 transition-[width] duration-500" style="width: {(l.quantity / maxQty) * 100}%"></span>
							</span>
							<span class="num w-10 text-right font-semibold">{l.quantity}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-4 text-ink-3">Derzeit an keinem Lagerort vorhanden.</p>
			{/if}
			{#if p.minStock}
				<p class="mt-5 border-t border-line pt-3 text-sm text-ink-2">
					Mindestbestand <span class="num font-semibold text-ink">{p.minStock}</span>{#if p.targetStock}, Sollbestand <span class="num font-semibold text-ink">{p.targetStock}</span>{/if} Stück
				</p>
			{/if}
		</section>

		<!-- Verbrauch -->
		{#if data.consumption}
		<section class="card p-4 lg:p-6" aria-labelledby="h-cons">
			<div class="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 id="h-cons" class="text-xl">Verbrauch</h2>
					<p class="text-sm text-ink-3">Letzte 12 Monate, in Stück</p>
				</div>
				<p class="text-right text-sm text-ink-3">Gesamt <span class="num text-base font-semibold text-ink">{yearTotal}</span></p>
			</div>
			<div class="mt-3"><BarChart data={chartData} title="Verbrauch {p.name}" height={200} /></div>
		</section>
		{/if}
	</div>

	<div class="space-y-4">
		<section class="card p-4 lg:p-6" aria-labelledby="h-data">
			<h2 id="h-data" class="text-xl">Stammdaten</h2>
			<dl class="mt-3 divide-y divide-line text-[0.9375rem]">
				<div class="flex justify-between gap-4 py-2"><dt class="text-ink-3">Artikelnummer</dt><dd class="num text-right">{p.articleNumber || '–'}</dd></div>
				<div class="flex justify-between gap-4 py-2"><dt class="text-ink-3">Hersteller</dt><dd class="text-right">{p.manufacturer || '–'}</dd></div>
				<div class="flex justify-between gap-4 py-2"><dt class="text-ink-3">Inhalt je Stück</dt><dd class="text-right">{packageLabel(p.packageSize, p.unit) || '–'}</dd></div>
				<div class="flex justify-between gap-4 py-2"><dt class="text-ink-3">Mindestbestand</dt><dd class="num text-right">{p.minStock ?? '–'}</dd></div>
				<div class="flex justify-between gap-4 py-2"><dt class="text-ink-3">Sollbestand</dt><dd class="num text-right">{p.targetStock ?? '–'}</dd></div>
			</dl>
			{#if data.notes}<p class="mt-3 rounded-xl bg-surface-2 p-3 text-sm whitespace-pre-line text-ink-2">{data.notes}</p>{/if}
		</section>

		<section class="card p-4 lg:p-6" aria-labelledby="h-docs">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 id="h-docs" class="flex items-center gap-2 text-xl"><FileText size={20} aria-hidden="true" />Materialbeschreibungen</h2>
				{#if canManage}
					<button class="btn btn-secondary btn-sm" onclick={openUpload}><FileUp size={16} aria-hidden="true" />PDF hochladen</button>
				{/if}
			</div>
			<ul class="mt-3 space-y-2">
				{#each data.documents as doc (doc.id)}
					<li class="flex items-center gap-2 rounded-xl bg-surface-2 pr-1">
						<a href="/lager/artikel/{p.id}/dokumente/{doc.id}" class="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-3">
							<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-danger-soft text-[0.6875rem] font-bold text-danger">PDF</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium">{doc.title}</span>
								<span class="block text-[0.8125rem] text-ink-3">{DOCUMENT_KIND_LABELS[doc.kind]} · {fileSizeLabel(doc.size)}</span>
							</span>
							<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
						</a>
						{#if canManage}
							<button
								class="btn btn-ghost btn-sm btn-icon shrink-0 hover:text-danger"
								aria-label="{doc.title} entfernen"
								title="Entfernen"
								onclick={() => ((removeDoc = doc), (removeOpen = true))}
							>
								<Trash size={16} />
							</button>
						{/if}
					</li>
				{:else}
					<li class="text-sm text-ink-3">
						Noch keine PDFs hinterlegt.{#if canManage} Materialbeschreibung oder Sicherheitsdatenblatt über „PDF hochladen“ ergänzen.{/if}
					</li>
				{/each}
			</ul>
		</section>

		<section class="card p-4 lg:p-6" aria-labelledby="h-codes">
			<h2 id="h-codes" class="flex items-center gap-2 text-xl"><Barcode size={20} aria-hidden="true" />Scanbare Codes</h2>
			<ul class="mt-3 space-y-2">
				{#each data.codes as c (c.id)}
					<li class="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
						<div class="min-w-0 flex-1">
							<p class="num truncate font-medium">{c.display}</p>
							<p class="text-[0.8125rem] text-ink-3">
								{KIND_LABEL[c.kind]}{#if c.sharedWith.length}
									· gehört auch zu {#each c.sharedWith as s, i (s.id)}<a href="/lager/artikel/{s.id}" class="underline hover:text-ink">{s.name}</a>{#if i < c.sharedWith.length - 1}, {/if}{/each}
								{/if}
							</p>
						</div>
						{#if canManage && c.kind !== 'artikel'}
							<form method="POST" action="?/removeCode" use:enhance>
								<input type="hidden" name="codeId" value={c.id} />
								<button class="btn btn-ghost btn-sm btn-icon" aria-label="Code {c.display} entfernen"><Trash size={16} /></button>
							</form>
						{/if}
					</li>
				{:else}
					<li class="text-sm text-ink-3">Noch kein Code hinterlegt – der Artikel ist nur über die Suche auffindbar.</li>
				{/each}
			</ul>
			{#if canManage}
				<div class="mt-4">
					<label for="new-code" class="field-label">Code hinzufügen</label>
					<CodeInput id="new-code" bind:value={newCode} placeholder="Scannen oder eintippen" oncode={addCode} disabled={adding} />
					{#if codeConflict}
						<div class="mt-3 rounded-xl bg-warn-soft p-3 text-sm" role="alert">
							<p class="font-medium">{codeConflict.message}</p>
							<p class="mt-1 text-ink-2">Trotzdem auch hier hinterlegen? Beim Scannen fragt die App dann, welcher Artikel gemeint ist.</p>
							<div class="mt-3 flex flex-wrap gap-2">
								<button class="btn btn-secondary btn-sm" disabled={adding} onclick={() => postCode(codeConflict!.code, codeConflict!.kind, true)}>
									Trotzdem hinzufügen
								</button>
								<button class="btn btn-ghost btn-sm" onclick={() => (codeConflict = null)}>Abbrechen</button>
							</div>
						</div>
					{:else}
						<p class="field-hint">Z. B. ein zweiter Barcode vom Lieferanten.</p>
					{/if}
				</div>
			{/if}
		</section>
	</div>
</div>

{#if data.history}
	<section class="card mt-4 overflow-hidden" aria-labelledby="h-hist">
		<div class="px-4 pt-4 pb-3 lg:px-6 lg:pt-5">
			<h2 id="h-hist" class="text-xl">Bewegungen</h2>
		</div>
		<MovementList rows={data.history} showProduct={false} empty="Für diesen Artikel gibt es noch keine Buchungen." />
		<Pagination page={data.page} pageSize={data.pageSize} count={data.historyCount} />
	</section>
{/if}

{#if canManage}
	<Dialog bind:open={uploadOpen} title="PDF hochladen">
		<form
			id="doc-form"
			method="POST"
			action="?/uploadDocument"
			enctype="multipart/form-data"
			class="space-y-4"
			use:enhance={() => {
				uploading = true;
				uploadError = '';
				return async ({ result, update }) => {
					uploading = false;
					if (result.type === 'failure') {
						uploadError = String(result.data?.docError ?? 'Hochladen fehlgeschlagen');
						return;
					}
					if (result.type === 'success') {
						uploadOpen = false;
						toast.success('PDF hochgeladen', String(result.data?.documentAdded ?? ''));
					}
					await update();
				};
			}}
		>
			<div>
				<label for="doc-file" class="field-label">Datei (PDF, bis {fileSizeLabel(MAX_DOCUMENT_BYTES)})</label>
				<input id="doc-file" name="file" type="file" accept="application/pdf,.pdf" required class="input py-2" onchange={pickFile} />
			</div>
			<div>
				<label for="doc-title" class="field-label">Titel</label>
				<input id="doc-title" name="title" class="input" maxlength="120" bind:value={uploadTitle} placeholder="z. B. Technisches Merkblatt" />
			</div>
			<fieldset>
				<legend class="field-label">Art</legend>
				<div class="grid gap-2 sm:grid-cols-3">
					{#each Object.entries(DOCUMENT_KIND_LABELS) as [value, label] (value)}
						<label class="flex cursor-pointer items-center gap-2 rounded-xl border border-line-strong p-2.5 text-sm has-[:checked]:border-ink has-[:checked]:bg-surface-3">
							<input type="radio" name="kind" {value} bind:group={uploadKind} class="accent-[var(--c-ink)]" />{label}
						</label>
					{/each}
				</div>
			</fieldset>
			{#if uploadError}<p class="field-error" role="alert">{uploadError}</p>{/if}
		</form>
		{#snippet footer()}
			<button class="btn btn-secondary" onclick={() => (uploadOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary" form="doc-form" disabled={!uploadFile || uploading}>{uploading ? 'Wird hochgeladen …' : 'Hochladen'}</button>
		{/snippet}
	</Dialog>

	<Dialog bind:open={removeOpen} title="PDF entfernen?">
		{#if removeDoc}
			<p class="text-ink-2"><span class="font-medium text-ink">{removeDoc.title}</span> wird von diesem Artikel entfernt.</p>
		{/if}
		{#snippet footer()}
			<button class="btn btn-secondary" onclick={() => (removeOpen = false)}>Abbrechen</button>
			<form
				method="POST"
				action="?/deleteDocument"
				use:enhance={() =>
					async ({ result, update }) => {
						removeOpen = false;
						if (result.type === 'failure') toast.error(String(result.data?.docError ?? 'Entfernen fehlgeschlagen'));
						else if (result.type === 'success') toast.success('PDF entfernt');
						await update();
					}}
			>
				<input type="hidden" name="documentId" value={removeDoc?.id} />
				<button class="btn btn-danger">Entfernen</button>
			</form>
		{/snippet}
	</Dialog>
{/if}

