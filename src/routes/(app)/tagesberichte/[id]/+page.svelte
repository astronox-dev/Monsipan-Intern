<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { onMount, tick } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Printer from '@lucide/svelte/icons/printer';
	import FileText from '@lucide/svelte/icons/file-text';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash from '@lucide/svelte/icons/trash';
	import Undo from '@lucide/svelte/icons/undo-2';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Signature from '@lucide/svelte/icons/signature';
	import CustomerLink from '$lib/components/CustomerLink.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import SignaturePad from '$lib/modules/stunden/components/SignaturePad.svelte';
	import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '$lib/modules/stunden/signature';
	import { MAX_MATERIALS, MAX_POSITIONS, productMaterial, quantityLabel, sumLabel } from '$lib/modules/tagesberichte/sheet';
	import { dateTime } from '$lib/format';
	import { toast } from '$lib/stores/toast.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PdfViewer from '$lib/components/PdfViewer.svelte';
	import ViewSwitch, { preferredView } from '$lib/components/ViewSwitch.svelte';
	import ReportPhotos from '$lib/modules/tagesberichte/components/ReportPhotos.svelte';
	import { hasInk } from '$lib/ink';
	import { spacedNumber } from '$lib/modules/auftraege/offer';
	import HardHat from '@lucide/svelte/icons/hard-hat';
	import ListIcon from '@lucide/svelte/icons/list';
	import { canonicalUnit, unitChoices } from '$lib/units';

	let { data, form } = $props();
	const report = $derived(data.report);

	type Position = { key: number; lbPos: string; unit: string; total: string };
	/** free: Bezeichnung frei eingetippt statt aus den Positionen des Auftrags gewählt */
	type Row = { key: number; id: number | null; label: string; free: boolean; q: string[] };
	type Material = { key: number; productId: string; material: string; code: string; thickness: string };

	/**
	 * Kopf- und Fußfelder gehören dem Formular – nur mit value={…} setzte Svelte sie
	 * bei der ersten Änderung irgendwo im Formular (z. B. einer Unterschrift)
	 * auf den gespeicherten Stand zurück, und Eingaben gingen verloren.
	 */
	// svelte-ignore state_referenced_locally
	let head = $state({
		number: data.report.number,
		date: data.report.date,
		dateTo: data.report.dateTo ?? '',
		orderId: data.report.orderId == null ? '' : String(data.report.orderId),
		road: data.report.road,
		site: data.report.site,
		costCenter: data.report.costCenter,
		dailyOutput: data.report.dailyOutput,
		lvPosition: data.report.lvPosition,
		note: data.report.note
	});

	let nextKey = 1;
	// Der Bericht wird nur beim Öffnen übernommen – danach gehört der Stand dem Formular
	// svelte-ignore state_referenced_locally
	let positions = $state<Position[]>(
		data.report.positions.map((p) => ({ key: nextKey++, lbPos: p.lbPos, unit: canonicalUnit(data.units, p.unit), total: quantityLabel(p.totalQuantity) }))
	);
	/** Bezeichnung der Zeilen: die Positionen des gewählten Auftrags – im Notfall auch frei */
	const choices = $derived(head.orderId ? (data.orderLines[Number(head.orderId)] ?? []) : []);
	const FREE = '__frei__';
	// svelte-ignore state_referenced_locally
	const startChoices = data.report.orderId != null ? (data.orderLines[data.report.orderId] ?? []) : [];
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(
		data.report.rows.map((r) => ({
			key: nextKey++,
			id: r.id,
			label: r.label,
			free: !!r.label.trim() && !startChoices.some((c) => c.text === r.label),
			q: positions.map((_, i) => quantityLabel(r.quantities[i]))
		}))
	);
	/** Frei, wenn so gewählt oder die Bezeichnung (etwa nach einem Auftragswechsel) in der Liste fehlt */
	const isFree = (row: Row) => row.free || (!!row.label && !choices.some((c) => c.text === row.label));
	async function pickLabel(row: Row) {
		if (row.label !== FREE) return;
		row.label = '';
		row.free = true;
		await tick();
		document.querySelector<HTMLInputElement>(`[data-frei="${row.key}"]`)?.focus();
	}
	function backToList(row: Row) {
		row.free = false;
		row.label = '';
	}
	const emptyMaterial = (): Material => ({ key: nextKey++, productId: '', material: '', code: '', thickness: '' });
	// svelte-ignore state_referenced_locally
	let materials = $state<Material[]>(
		data.report.materials.length
			? data.report.materials.map((m) => ({
					key: nextKey++,
					productId: m.productId == null ? '' : String(m.productId),
					material: m.material,
					code: m.code,
					thickness: m.filmThickness
				}))
			: [emptyMaterial()]
	);

	let busy = $state(false);
	let confirmDelete = $state(false);
	let confirmReopen = $state(false);
	let confirmUncheck = $state(false);
	let onSiteOpen = $state(false);
	let confirmRemoveCustomer = $state(false);
	let customerName = $state('');
	let customerSignature = $state('');
	let releaseOpen = $state(false);
	let checkOpen = $state(false);
	let signature = $state('');
	onMount(() => {
		// Wer an diesem Gerät zuletzt handschriftlich ausgefüllt hat, landet gleich wieder dort
		if (data.editable && preferredView() === 'handschrift' && page.url.searchParams.get('ansicht') !== 'digital') {
			void goto(`/tagesberichte/${data.report.id}/handschrift`, { replaceState: true });
		}
	});

	/** Handschrift vom Tablet – das Büro sieht sie hier zum Abtippen */
	const inked = $derived(hasInk(report.ink));
	let inkOpen = $state(true);
	let confirmColumn = $state<number | null>(null);
	let tableBox = $state<HTMLDivElement>();

	function addRow() {
		rows.push({ key: nextKey++, id: null, label: '', free: false, q: positions.map(() => '') });
	}
	function removeRow(key: number) {
		rows = rows.filter((r) => r.key !== key);
	}

	/** Neue LB-Position hinten anfügen – die Tabelle rollt hin, der Cursor steht im neuen Feld */
	async function addPosition() {
		if (positions.length >= MAX_POSITIONS) return;
		positions.push({ key: nextKey++, lbPos: '', unit: '', total: '' });
		for (const r of rows) r.q.push('');
		await tick();
		tableBox?.scrollTo({ left: tableBox.scrollWidth, behavior: 'smooth' });
		tableBox?.querySelector<HTMLInputElement>(`[data-lbpos="${positions.length - 1}"]`)?.focus({ preventScroll: true });
	}
	const columnUsed = (i: number) =>
		!!(positions[i].lbPos.trim() || positions[i].unit.trim() || positions[i].total.trim() || rows.some((r) => r.q[i]?.trim()));
	/** Spalte mit Inhalt erst nach Rückfrage entfernen */
	function askRemovePosition(i: number) {
		if (columnUsed(i)) confirmColumn = i;
		else removePosition(i);
	}
	function removePosition(i: number) {
		positions.splice(i, 1);
		for (const r of rows) r.q.splice(i, 1);
		confirmColumn = null;
	}

	function addMaterial() {
		if (materials.length < MAX_MATERIALS) materials.push(emptyMaterial());
	}
	function removeMaterial(key: number) {
		materials = materials.filter((m) => m.key !== key);
	}

	/** Auftrag gewählt: dessen Ausführungsort (sonst BV) als Baustelle, solange keine eigene drinsteht */
	function pickOrder() {
		const o = data.orders.find((x) => String(x.id) === head.orderId);
		const proposal = o ? o.location || o.title : '';
		if (proposal && (!head.site.trim() || data.orders.some((x) => (x.location || x.title) === head.site))) head.site = proposal;
	}

	const productById = $derived(new Map(data.products.map((p) => [String(p.id), p])));
	/** Kategorien als Gruppen in der Auswahl, in der Reihenfolge der Stammdaten */
	const productGroups = $derived.by(() => {
		const groups = new Map<string, typeof data.products>();
		for (const p of data.products) {
			const name = p.categoryName ?? 'Ohne Materialart';
			groups.set(name, [...(groups.get(name) ?? []), p]);
		}
		return [...groups.entries()];
	});
	/** Artikel, die am Bericht hängen, aber nicht mehr aktiv sind – sonst fiele die Auswahl leer */
	const inactiveLinked = $derived(
		report.materials.filter((m) => m.productId != null && !productById.has(String(m.productId)))
	);

	/** Artikel gewählt: Material (Farbe) und Kenn-Nr. kommen aus den Stammdaten */
	function pickProduct(m: Material) {
		const p = productById.get(m.productId);
		if (!p) return;
		m.material = productMaterial(p);
		m.code = p.name;
	}

	const parse = (v: string) => {
		const n = Number(String(v).replace(',', '.'));
		return Number.isFinite(n) ? n : 0;
	};
	const sums = $derived(positions.map((_, c) => rows.reduce((s, r) => s + parse(r.q[c] ?? ''), 0)));

	const name = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(' ');
	const releaser = $derived(name(report.releasedByFirst, report.releasedByLast));
	const checker = $derived(name(report.checkedByFirst, report.checkedByLast));

	const STATUS: Record<string, { label: string; tone: string; hint: string }> = {
		entwurf: { label: 'In Arbeit', tone: '', hint: '' },
		freigegeben: { label: 'Freigegeben', tone: 'badge-info', hint: 'Freigegeben – wartet auf die Prüfung.' },
		geprueft: { label: 'Geprüft', tone: 'badge-warn', hint: 'Geprüft – wartet auf die Unterschrift des Kunden.' },
		abgeschlossen: { label: 'Abgeschlossen', tone: 'badge-ok', hint: 'Vom Kunden unterschrieben und abgeschlossen.' }
	};
	const status = $derived(STATUS[report.status] ?? STATUS.entwurf);

	/** Was beim Wieder öffnen verfällt – je nach Stand */
	const reopenLoss = $derived(
		report.status === 'abgeschlossen'
			? 'Die Unterschriften der Freigabe und des Kunden verfallen. Der Kunde unterschreibt danach über denselben Link oder vor Ort neu, sobald der Bericht wieder freigegeben ist.'
			: report.status === 'geprueft'
				? 'Freigabe und Prüfung verfallen. Der Kunde kann erst wieder unterschreiben, wenn der Bericht neu freigegeben und geprüft ist.'
				: `Die Unterschrift der Freigabe${report.customerSignature ? ' und die des Kunden' : ''} verfällt – er muss danach neu freigegeben werden.`
	);
	/** Woher die Unterschrift des Kunden stammt */
	const customerVia = $derived(report.customerSignedOnSite ? 'vor Ort' : 'über den Link');
	/** Vom Kunden vor Ort unterschrieben, aber noch nicht geprüft – der Inhalt ist gesperrt */
	const lockedByCustomer = $derived(!!report.customerSignature && (report.status === 'entwurf' || report.status === 'freigegeben'));

</script>

{#snippet signed(label: string, path: string | null, text: string)}
	<div>
		<p class="text-[0.75rem] font-medium tracking-wide text-ink-3 uppercase">{label}</p>
		{#if path}
			<svg viewBox="0 0 {SIGNATURE_WIDTH} {SIGNATURE_HEIGHT}" class="mt-1.5 h-14 w-40 rounded-lg bg-white" role="img" aria-label="Unterschrift – {label}">
				<path d={path} fill="none" stroke="#1d2127" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		{/if}
		<p class="mt-1 text-sm text-ink-2">{text}</p>
	</div>
{/snippet}

<svelte:head><title>{pageTitle(`Tagesbericht ${report.number || ''}`.trim())}</title></svelte:head>

<a href="/tagesberichte" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Tagesberichte
</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-[2rem] leading-tight">Tagesbericht {report.number}</h1>
		<p class="text-ink-2">
			{report.road || report.site || 'Ohne Bezeichnung'}{report.partyName ? ` · ${report.partyName}` : ''}
		</p>
		{#if report.orderId && report.orderNumber}
			<a href="/auftraege/{report.orderId}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
				<HardHat size={15} aria-hidden="true" />Auftrag {spacedNumber(report.orderNumber)}{report.orderTitle ? ` · ${report.orderTitle}` : ''}
			</a>
		{/if}
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<span class="badge {status.tone}">
			{#if report.status === 'abgeschlossen'}<CircleCheck size={13} aria-hidden="true" />{/if}{status.label}
		</span>
		<PdfButton href="/tagesberichte/{report.id}/pdf"><FileText size={18} aria-hidden="true" />PDF</PdfButton>
		<a href="/tagesberichte/{report.id}/druck" class="btn btn-secondary"><Printer size={18} aria-hidden="true" />Drucken</a>
		<ViewSwitch digital="/tagesberichte/{report.id}" handschrift="/tagesberichte/{report.id}/handschrift" current="digital" />
	</div>
</div>

{#if form && 'message' in form && form.message}
	<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>
{/if}

{#if report.status !== 'entwurf' || report.customerSignature}
	<!-- Wer wann freigegeben, geprüft und (als Kunde) unterschrieben hat -->
	<section class="card mb-4 grid gap-4 p-4 lg:grid-cols-3 lg:p-5">
		{@render signed(
			'Freigabe · für den Auftragnehmer',
			report.releaseSignature,
			report.releasedAt ? `${releaser || 'Unbekannt'}, ${dateTime(report.releasedAt)}` : '–'
		)}
		{@render signed('Prüfung', null, report.checkedAt ? `${checker || 'Unbekannt'}, ${dateTime(report.checkedAt)}` : 'noch nicht geprüft')}
		{@render signed(
			'Kunde · für den Auftraggeber',
			report.customerSignature,
			report.customerSignedAt
				? `${report.customerName ?? ''}, ${dateTime(report.customerSignedAt)} · ${customerVia}`
				: report.status === 'geprueft'
					? 'wartet auf die Unterschrift'
					: 'nach der Prüfung'
		)}
	</section>
{/if}

{#if inked}
	<!-- Handschriftlich ausgefüllt: so wie im Ausdruck, daneben die Felder zum Abtippen -->
	<details class="card mb-4 overflow-hidden" bind:open={inkOpen}>
		<summary class="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 font-medium">
			<PenLine size={18} aria-hidden="true" />Handschriftlich ausgefüllt
			<span class="text-sm font-normal text-ink-3">– so steht es im Ausdruck. Werte für Summen und Auswertungen unten eintragen.</span>
		</summary>
		{#if inkOpen}
			<div class="border-t border-line p-3"><PdfViewer url="/tagesberichte/{report.id}/pdf" title="Tagesbericht mit Handschrift" /></div>
		{/if}
	</details>
{/if}

{#if data.canLink}
	<CustomerLink
		url={data.customerUrl}
		description={report.status === 'abgeschlossen'
			? 'Der Kunde hat unterschrieben. Über denselben Link kann er den fertigen Bericht jederzeit wieder als PDF laden.'
			: 'Über diesen Link sieht der Kunde den Bericht, trägt seinen Namen ein und unterschreibt. Danach kann er ihn jederzeit als PDF laden – der Link bleibt dauerhaft gleich.'}
		shareTitle={`Tagesbericht ${report.number}`.trim()}
		shareText={report.status === 'abgeschlossen' ? 'Ihr unterschriebener Tagesbericht:' : 'Bitte den Tagesbericht ansehen und unterschreiben:'}
		mailConfigured={data.mailConfigured}
		email={String((form && 'email' in form && form.email) || report.customerEmail || '')}
		sentTo={report.customerEmail}
		sentAt={report.customerLinkSentAt}
	/>
{/if}

<form
	id="bericht"
	method="POST"
	action="?/save"
	use:enhance={({ action }) => {
		busy = true;
		const step = action.search.includes('kundeVorOrt')
			? 'onsite'
			: action.search.includes('release')
				? 'release'
				: action.search.includes('check')
					? 'check'
					: 'save';
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				if (step === 'release') {
					toast.success('Bericht freigegeben');
					releaseOpen = false;
					signature = '';
				} else if (step === 'check') {
					const done = !!(result.data && 'done' in result.data && result.data.done);
					toast.success(done ? 'Bericht geprüft und abgeschlossen' : 'Bericht geprüft', done ? 'Der Link zum Herunterladen ist bereit.' : 'Der Link für den Kunden ist bereit.');
					checkOpen = false;
				} else if (step === 'onsite') {
					toast.success('Unterschrift des Kunden gespeichert');
					onSiteOpen = false;
					customerName = '';
					customerSignature = '';
				} else toast.success('Gespeichert');
			}
			await update({ reset: false });
		};
	}}
>
	<!-- Außerhalb des fieldset, damit sie auch bei gesperrtem Bericht mitkommen -->
	<input type="hidden" name="unterschrift" value={signature} />
	<input type="hidden" name="kunde_name" value={customerName} />
	<input type="hidden" name="kunde_unterschrift" value={customerSignature} />

	<fieldset disabled={!data.editable} class="contents">
		<section class="card grid grid-cols-2 gap-4 p-4 lg:grid-cols-6 lg:p-5">
			<label class="col-span-2 block lg:col-span-1">
				<span class="field-label">Nummer</span>
				<input class="input num" name="nummer" bind:value={head.number} maxlength="40" />
			</label>
			<label class="block">
				<span class="field-label">Datum</span>
				<input class="input num" type="date" name="datum" bind:value={head.date} required />
			</label>
			<label class="block">
				<span class="field-label">bis <span class="font-normal text-ink-3">(mehrere Tage)</span></span>
				<input class="input num" type="date" name="datum_bis" bind:value={head.dateTo} min={head.date} />
			</label>
			<label class="block">
				<span class="field-label">Bundesstraße Nr.</span>
				<input class="input" name="strasse" bind:value={head.road} maxlength="120" list="strassen" />
			</label>
			{#if data.orders.length || head.orderId}
				<label class="order-last col-span-2 block lg:col-span-6">
					<span class="field-label">Auftrag <span class="font-normal text-ink-3">(freiwillig)</span></span>
					<select class="select" name="auftrag" bind:value={head.orderId} onchange={pickOrder}>
						<option value="">Ohne Auftrag</option>
						{#if head.orderId && !data.orders.some((o) => String(o.id) === head.orderId)}
							<option value={head.orderId}>Auftrag {report.orderNumber ? spacedNumber(report.orderNumber) : ''}</option>
						{/if}
						{#each data.orders as o (o.id)}<option value={String(o.id)}>{spacedNumber(o.number)} – {o.title || o.location || 'ohne BV'}</option>{/each}
					</select>
				</label>
			{/if}
			<label class="order-last col-span-2 block lg:order-none lg:col-span-1">
				<span class="field-label">Baustelle</span>
				<input class="input" name="baustelle" bind:value={head.site} maxlength="200" list="baustellen" />
			</label>
			<label class="block">
				<span class="field-label">Kostenstelle</span>
				<input class="input" name="kostenstelle" bind:value={head.costCenter} maxlength="60" />
			</label>
		</section>
		<datalist id="strassen">{#each data.places.roads as r (r)}<option value={r}></option>{/each}</datalist>
		<datalist id="baustellen">{#each data.places.sites as s (s)}<option value={s}></option>{/each}</datalist>

		<!-- relative: sonst ragen die unsichtbaren Beschriftungen (sr-only) aus der Rollfläche und verbreitern die Seite -->
		<div class="card relative mt-4 overflow-x-auto" bind:this={tableBox}>
			<table class="w-full border-collapse text-sm" style="min-width: {10 + positions.length * 7 + 2.5}rem">
				<thead>
					<tr class="border-b border-line">
						<th scope="col" class="sticky left-0 w-[10rem] bg-surface px-3 py-2 text-left align-bottom sm:w-[16rem]">Ortsbezeichnungen und Markierungsarten</th>
						{#each positions as p, i (p.key)}
							<th scope="col" class="w-[7rem] px-1.5 py-1.5 align-bottom">
								<div class="mb-1 flex h-6 items-center justify-between gap-1">
									<span class="num text-[0.6875rem] font-normal text-ink-3">Spalte {i + 1}</span>
									{#if data.editable}
										<button
											type="button"
											class="grid size-6 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-danger"
											aria-label="LB-Position Spalte {i + 1} entfernen"
											onclick={() => askRemovePosition(i)}
										>
											<X size={13} />
										</button>
									{/if}
								</div>
								<input
									class="input input-sm num text-center"
									name="pos.lbpos"
									placeholder="LB-Pos."
									maxlength="40"
									data-lbpos={i}
									bind:value={p.lbPos}
									aria-label="LB-Position Spalte {i + 1}"
								/>
								<select class="select input-sm mt-1 pr-8 text-center font-semibold" name="pos.einheit" bind:value={p.unit} aria-label="Einheit Spalte {i + 1}">
									<option value="">Einheit</option>
									{#each unitChoices(data.units, p.unit) as u (u)}<option value={u}>{u}</option>{/each}
								</select>
							</th>
						{/each}
						<th scope="col" class="w-10"><span class="sr-only">Zeile entfernen</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row, i (row.key)}
						<tr class="border-b border-line">
							<td class="sticky left-0 bg-surface px-3 py-1.5">
								<input type="hidden" name="zeile.{i}.id" value={row.id ?? 'neu'} />
								{#if data.editable && choices.length && !isFree(row)}
									<!-- Aus dem Auftrag wählen; die Auswahl selbst hat keinen Namen, gespeichert wird der Text -->
									<input type="hidden" name="zeile.{i}.text" value={row.label} />
									<select
										class="select min-h-9 w-full py-1 text-[0.9375rem]"
										bind:value={row.label}
										onchange={() => pickLabel(row)}
										aria-label="Position Zeile {i + 1}"
									>
										<option value="">Position wählen …</option>
										{#each choices as c, n (n)}<option value={c.text}>{c.number} {c.text}</option>{/each}
										<option value={FREE}>Sonstiges (frei eingeben) …</option>
									</select>
								{:else}
									<div class="flex items-center gap-1">
										<input
											class="input input-sm min-w-0 flex-1"
											name="zeile.{i}.text"
											maxlength="200"
											bind:value={row.label}
											data-frei={row.key}
											placeholder={choices.length ? 'Sonstiges' : ''}
											aria-label="Ortsbezeichnung Zeile {i + 1}"
										/>
										{#if data.editable && choices.length}
											<button
												type="button"
												class="grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink"
												title="Aus den Positionen des Auftrags wählen"
												aria-label="Zeile {i + 1}: aus den Positionen des Auftrags wählen"
												onclick={() => backToList(row)}
											>
												<ListIcon size={15} />
											</button>
										{/if}
									</div>
								{/if}
							</td>
							{#each positions as p, c (p.key)}
								<td class="px-1.5 py-1.5">
									<input
										class="input input-sm num text-center"
										name="zeile.{i}.menge"
										inputmode="decimal"
										bind:value={row.q[c]}
										aria-label="Menge Zeile {i + 1} Spalte {c + 1}"
									/>
								</td>
							{/each}
							<td class="px-1 py-1.5 text-center">
								{#if data.editable}
									<button
										type="button"
										class="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-danger"
										aria-label="Zeile {i + 1} entfernen"
										onclick={() => removeRow(row.key)}
									>
										<X size={15} />
									</button>
								{/if}
							</td>
						</tr>
					{/each}
					<tr class="border-b border-line bg-surface-2 font-semibold">
						<th scope="row" class="sticky left-0 bg-surface-2 px-3 py-2 text-left">Einheitssumme</th>
						{#each sums as s, c (c)}
							<td class="num px-1.5 py-2 text-center">{sumLabel(s)}</td>
						{/each}
						<td></td>
					</tr>
					<tr class="bg-surface-2">
						<th scope="row" class="sticky left-0 bg-surface-2 px-3 py-1.5 text-left font-semibold">
							Gesamtmenge
							<span class="block text-[0.75rem] font-normal text-ink-3">von Hand eintragen</span>
						</th>
						{#each positions as p, c (p.key)}
							<td class="px-1.5 py-1.5">
								<input
									class="input input-sm num text-center"
									name="pos.gesamt"
									inputmode="decimal"
									bind:value={p.total}
									aria-label="Gesamtmenge Spalte {c + 1}"
								/>
							</td>
						{/each}
						<td></td>
					</tr>
				</tbody>
			</table>
		</div>

		{#if data.editable}
			<div class="mt-3 flex flex-wrap gap-2">
				<button type="button" class="btn btn-secondary btn-sm" onclick={addRow}><Plus size={16} aria-hidden="true" />Zeile hinzufügen</button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={addPosition} disabled={positions.length >= MAX_POSITIONS}>
					<Plus size={16} aria-hidden="true" />LB-Pos. hinzufügen
				</button>
			</div>
		{/if}

		<section class="card mt-4 p-4 lg:p-5">
			<h2 class="text-lg">Material</h2>
			{#if data.editable}
				<p class="field-hint">Artikel aus dem Lager wählen – Material (die Farbe) und Kenn-Nr. (der Artikelname) füllen sich selbst aus, dazu nur noch die Filmdicke.</p>
			{/if}
			<div class="mt-3 hidden gap-2 text-[0.8125rem] text-ink-3 md:grid md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)_minmax(0,1.7fr)_7rem_2.25rem]">
				<span>Artikel aus dem Lager</span><span>Material</span><span>Kenn-Nr.</span><span>Filmdicke in mm</span><span></span>
			</div>
			<ul class="mt-1 space-y-3 md:space-y-2">
				{#each materials as m, i (m.key)}
					<li class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 border-b border-line pb-3 md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)_minmax(0,1.7fr)_7rem_2.25rem] md:border-0 md:pb-0">
						<label class="col-span-3 block md:col-span-1">
							<span class="field-label md:sr-only">Artikel aus dem Lager</span>
							<select
								class="select min-h-9 py-1 text-[0.9375rem]"
								name="material.artikel"
								bind:value={m.productId}
								onchange={() => pickProduct(m)}
							>
								<option value="">Ohne Artikel – von Hand</option>
								{#each inactiveLinked.filter((x) => String(x.productId) === m.productId) as x (x.productId)}
									<option value={String(x.productId)}>{x.productName ?? 'Gelöschter Artikel'} (nicht mehr aktiv)</option>
								{/each}
								{#each productGroups as [group, list] (group)}
									<optgroup label={group}>
										{#each list as p (p.id)}
											<option value={String(p.id)}>{p.name}{p.articleNumber ? ` · ${p.articleNumber}` : ''}</option>
										{/each}
									</optgroup>
								{/each}
							</select>
						</label>
						<label class="order-2 block md:order-none">
							<span class="field-label md:sr-only">Material</span>
							<input class="input input-sm" name="material.name" maxlength="60" bind:value={m.material} aria-label="Material Zeile {i + 1}" />
						</label>
						<!-- Am Handy steht der Artikelname gleich unter der Auswahl, über die volle Breite -->
						<label class="order-1 col-span-3 block md:order-none md:col-span-1">
							<span class="field-label md:sr-only">Kenn-Nr.</span>
							<input class="input input-sm" name="material.nr" maxlength="120" bind:value={m.code} aria-label="Kenn-Nr. Zeile {i + 1}" />
						</label>
						<label class="order-2 block md:order-none">
							<span class="field-label md:sr-only">Filmdicke in mm</span>
							<input
								class="input input-sm num"
								name="material.dicke"
								maxlength="30"
								bind:value={m.thickness}
								aria-label="Filmdicke in mm Zeile {i + 1}"
							/>
						</label>
						<div class="order-2 flex items-end justify-end md:order-none md:items-center">
							{#if data.editable}
								<button
									type="button"
									class="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-danger"
									aria-label="Material Zeile {i + 1} entfernen"
									onclick={() => removeMaterial(m.key)}
								>
									<X size={15} />
								</button>
							{/if}
						</div>
					</li>
				{:else}
					<li class="text-sm text-ink-3">Kein Material eingetragen.</li>
				{/each}
			</ul>
			{#if data.editable}
				<button type="button" class="btn btn-secondary btn-sm mt-3" onclick={addMaterial} disabled={materials.length >= MAX_MATERIALS}>
					<Plus size={16} aria-hidden="true" />Material hinzufügen
				</button>
			{/if}
		</section>

		<div class="mt-4 grid gap-4 lg:grid-cols-2">
			<section class="card space-y-3 p-4 lg:p-5">
				<label class="block">
					<span class="field-label">Tagesleistung</span>
					<input class="input" name="tagesleistung" bind:value={head.dailyOutput} maxlength="200" />
				</label>
				<label class="block">
					<span class="field-label">LV-Position Nr.</span>
					<input class="input" name="lvposition" bind:value={head.lvPosition} maxlength="200" />
				</label>
			</section>

			<section class="card p-4 lg:p-5">
				<h2 class="text-lg">Notiz</h2>
				<textarea class="textarea mt-2" name="notiz" rows="4" maxlength="2000" bind:value={head.note}></textarea>
			</section>
		</div>
	</fieldset>

	<!-- Außerhalb des fieldset: Fotos gehen auch, wenn der Kunde schon vor Ort unterschrieben hat. Die Dateifelder haben keinen Namen und gehen beim Speichern nicht mit. -->
	<ReportPhotos reportId={report.id} photos={data.photos} editable={data.canPhotos} />

	{#if data.editable || data.canRelease || data.canCheck || data.canSignOnSite || data.canRemoveCustomer}
		<div class="card lg:sticky mt-4 flex flex-wrap items-center gap-2 p-3 lg:bottom-6">
			{#if data.editable}
				<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Speichern'}</button>
			{/if}
			{#if data.canRelease}
				<button type="button" class="btn {data.editable ? 'btn-secondary' : 'btn-primary'}" disabled={busy} onclick={() => (releaseOpen = true)}>
					<PenLine size={18} aria-hidden="true" />Freigeben
				</button>
			{/if}
			{#if data.canCheck}
				<button type="button" class="btn {data.editable ? 'btn-secondary' : 'btn-primary'}" disabled={busy} onclick={() => (checkOpen = true)}>
					<Check size={18} aria-hidden="true" />Geprüft
				</button>
			{/if}
			{#if data.canSignOnSite}
				<button type="button" class="btn btn-secondary" disabled={busy} onclick={() => (onSiteOpen = true)}>
					<Signature size={18} aria-hidden="true" />Kunde unterschreibt vor Ort
				</button>
			{/if}
			{#if data.canRemoveCustomer}
				<button type="button" class="btn btn-ghost" disabled={busy} onclick={() => (confirmRemoveCustomer = true)}>
					<X size={18} aria-hidden="true" />Unterschrift des Kunden entfernen
				</button>
			{/if}
			<span class="ml-auto text-sm text-ink-2">
				{lockedByCustomer
					? 'Vom Kunden vor Ort unterschrieben – zum Ändern erst seine Unterschrift entfernen.'
					: report.status === 'freigegeben'
						? 'Freigegeben – du kannst vor dem Prüfen noch korrigieren.'
						: `${rows.length} Zeilen · ${positions.length} LB-Pos.`}
			</span>
		</div>
	{:else}
		<p class="field-hint mt-4">
			{status.hint || 'Diesen Bericht kannst du nur ansehen.'}
			{#if report.status !== 'entwurf'}Ändern geht erst nach dem Wieder öffnen.{/if}
		</p>
	{/if}
</form>

<div class="mt-4 flex flex-wrap gap-2">
	{#if data.canUncheck}
		<button type="button" class="btn btn-ghost" onclick={() => (confirmUncheck = true)}><Undo size={18} aria-hidden="true" />Zurück auf freigegeben</button>
	{/if}
	{#if data.canReopen}
		<button type="button" class="btn btn-ghost" onclick={() => (confirmReopen = true)}><LockOpen size={18} aria-hidden="true" />Wieder öffnen</button>
	{/if}
	{#if data.canDelete}
		<button type="button" class="btn btn-ghost ml-auto text-danger hover:bg-danger-soft" onclick={() => (confirmDelete = true)}>
			<Trash size={18} aria-hidden="true" />Löschen
		</button>
	{/if}
</div>

<Dialog bind:open={releaseOpen} title="Bericht freigeben">
	<p class="text-ink-2">
		Mit deiner Unterschrift gibst du den Bericht {report.number} frei. Sie steht im Ausdruck bei
		<span class="font-medium text-ink">„Für den Auftragnehmer"</span>. Danach wird er geprüft – ändern kannst du ihn dann nicht mehr.
		Was im Formular steht, wird vorher gespeichert.
	</p>
	<div class="mt-4">
		<SignaturePad bind:path={signature} />
	</div>
	{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
	<div class="mt-4 flex flex-wrap justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (releaseOpen = false)}>Abbrechen</button>
		<button type="submit" form="bericht" formaction="?/release" class="btn btn-primary" disabled={busy || !signature}>
			<PenLine size={18} aria-hidden="true" />Unterschreiben und freigeben
		</button>
	</div>
</Dialog>

<Dialog bind:open={checkOpen} title="Bericht prüfen">
	<p class="text-ink-2">
		Der Bericht {report.number} wird als geprüft markiert{data.editable ? ' – deine Änderungen werden vorher gespeichert' : ''}.
		{#if report.customerSignature}
			Der Kunde hat schon vor Ort unterschrieben – damit ist der Bericht <span class="font-medium text-ink">abgeschlossen</span>. Den Link
			zum Herunterladen kannst du ihm danach schicken.
		{:else}
			Danach kannst du dem Kunden den Link zum Unterschreiben schicken.
		{/if}
	</p>
	{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
	<div class="mt-5 flex flex-wrap justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (checkOpen = false)}>Abbrechen</button>
		<button type="submit" form="bericht" formaction="?/check" class="btn btn-primary" disabled={busy}>
			<Check size={18} aria-hidden="true" />Als geprüft markieren
		</button>
	</div>
</Dialog>

<Dialog bind:open={onSiteOpen} title="Kunde unterschreibt vor Ort">
	<p class="text-ink-2">
		Gib das Gerät dem Kunden: Er trägt seinen Namen ein und unterschreibt für den Auftraggeber. Was im Formular steht, wird
		vorher gespeichert – danach lässt sich der Bericht nicht mehr ändern, bis die Unterschrift wieder entfernt wird.
	</p>
	<label class="mt-4 block">
		<span class="field-label">Name des Kunden</span>
		<input class="input" bind:value={customerName} maxlength="120" autocomplete="off" />
	</label>
	<div class="mt-3">
		<SignaturePad bind:path={customerSignature} label="Unterschrift des Kunden" />
	</div>
	{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
	<div class="mt-4 flex flex-wrap justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (onSiteOpen = false)}>Abbrechen</button>
		<button
			type="submit"
			form="bericht"
			formaction="?/kundeVorOrt"
			class="btn btn-primary"
			disabled={busy || !customerSignature || customerName.trim().length < 2}
		>
			<Signature size={18} aria-hidden="true" />Unterschrift speichern
		</button>
	</div>
</Dialog>

<Dialog bind:open={confirmRemoveCustomer} title="Unterschrift des Kunden entfernen?">
	<p class="text-ink-2">
		Die Unterschrift von <span class="font-medium text-ink">{report.customerName}</span> wird entfernt. Danach lässt sich der Bericht
		wieder ändern; der Kunde unterschreibt später neu – vor Ort oder nach der Prüfung über den Link.
	</p>
	<form
		method="POST"
		action="?/kundeEntfernen"
		class="mt-5 flex justify-end gap-2"
		use:enhance={() => async ({ result, update }) => {
			confirmRemoveCustomer = false;
			if (result.type === 'success') toast.info('Unterschrift des Kunden entfernt');
			await update();
		}}
	>
		<button type="button" class="btn btn-ghost" onclick={() => (confirmRemoveCustomer = false)}>Abbrechen</button>
		<button class="btn btn-primary"><X size={18} aria-hidden="true" />Entfernen</button>
	</form>
</Dialog>

<Dialog bind:open={confirmUncheck} title="Zurück auf freigegeben?">
	<p class="text-ink-2">
		Die Prüfung von Bericht {report.number} wird zurückgenommen, die Freigabe samt Unterschrift bleibt. Bis er wieder geprüft ist,
		kann der Kunde nicht unterschreiben.
	</p>
	<form
		method="POST"
		action="?/uncheck"
		class="mt-5 flex justify-end gap-2"
		use:enhance={() => async ({ result, update }) => {
			confirmUncheck = false;
			if (result.type === 'success') toast.info('Zurück auf freigegeben');
			await update();
		}}
	>
		<button type="button" class="btn btn-ghost" onclick={() => (confirmUncheck = false)}>Abbrechen</button>
		<button class="btn btn-primary"><Undo size={18} aria-hidden="true" />Zurück auf freigegeben</button>
	</form>
</Dialog>

<Dialog bind:open={confirmReopen} title="Bericht wieder öffnen?">
	<p class="text-ink-2">Der Bericht {report.number} wird wieder bearbeitbar. {reopenLoss}</p>
	<form
		method="POST"
		action="?/reopen"
		class="mt-5 flex justify-end gap-2"
		use:enhance={() => async ({ result, update }) => {
			confirmReopen = false;
			if (result.type === 'success') toast.info('Bericht wieder geöffnet');
			await update();
		}}
	>
		<button type="button" class="btn btn-ghost" onclick={() => (confirmReopen = false)}>Abbrechen</button>
		<button class="btn btn-primary"><LockOpen size={18} aria-hidden="true" />Wieder öffnen</button>
	</form>
</Dialog>

<Dialog open={confirmColumn !== null} onclose={() => (confirmColumn = null)} title="LB-Position entfernen?">
	{#if confirmColumn !== null}
		{@const p = positions[confirmColumn]}
		<p class="text-ink-2">
			Spalte {confirmColumn + 1}{p?.lbPos ? ` (LB-Pos. ${p.lbPos})` : ''} wird samt ihren Mengen entfernt. Erst mit „Speichern" ist es endgültig.
		</p>
		<div class="mt-5 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (confirmColumn = null)}>Abbrechen</button>
			<button type="button" class="btn btn-primary" onclick={() => confirmColumn !== null && removePosition(confirmColumn)}>Entfernen</button>
		</div>
	{/if}
</Dialog>

<Dialog bind:open={confirmDelete} title="Tagesbericht löschen?">
	<p class="text-ink-2">Der Bericht {report.number} wird samt allen Zeilen gelöscht. Das lässt sich nicht rückgängig machen.</p>
	<form method="POST" action="?/delete" class="mt-5 flex justify-end gap-2" use:enhance>
		<button type="button" class="btn btn-ghost" onclick={() => (confirmDelete = false)}>Abbrechen</button>
		<button class="btn btn-primary">Löschen</button>
	</form>
</Dialog>
