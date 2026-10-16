<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Printer from '@lucide/svelte/icons/printer';
	import FileText from '@lucide/svelte/icons/file-text';
	import Plus from '@lucide/svelte/icons/plus';
	import Heading from '@lucide/svelte/icons/heading';
	import X from '@lucide/svelte/icons/x';
	import Send from '@lucide/svelte/icons/send';
	import Pencil from '@lucide/svelte/icons/pencil';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import Trash from '@lucide/svelte/icons/trash';
	import HardHat from '@lucide/svelte/icons/hard-hat';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import MessageSquare from '@lucide/svelte/icons/message-square-warning';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Upload from '@lucide/svelte/icons/upload';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { fileSizeLabel } from '$lib/documents';
	import CustomerLink from '$lib/components/CustomerLink.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import CustomerFields from '$lib/modules/auftraege/components/CustomerFields.svelte';
	import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '$lib/modules/stunden/signature';
	import {
		amountInput,
		lineNumbers,
		lineTotal,
		MAX_OFFER_LINES,
		money,
		OFFER_STATUS_LABELS,
		OFFER_UNITS,
		offerState,
		offerTotals,
		parseAmount,
		spacedNumber
	} from '$lib/modules/auftraege/offer';
	import { date as dateLabel, dateTime } from '$lib/format';
	import { toast } from '$lib/stores/toast.svelte';
	import { uploadFormPdfs, UploadError } from '$lib/upload';

	let { data, form } = $props();
	const offer = $derived(data.offer);

	type Line = { key: number; kind: 'position' | 'titel'; text: string; quantity: string; unit: string; price: string };

	let nextKey = 1;
	// Das Angebot wird nur beim Öffnen übernommen – danach gehört der Stand dem Formular
	// svelte-ignore state_referenced_locally
	let head = $state({
		number: data.offer.number,
		projectNumber: data.offer.projectNumber,
		date: data.offer.date,
		title: data.offer.title,
		location: data.offer.location,
		customerId: data.offer.customerId == null ? '' : String(data.offer.customerId),
		name: data.offer.customerName,
		addition: data.offer.customerAddition,
		street: data.offer.customerStreet,
		zip: data.offer.customerZip,
		city: data.offer.customerCity,
		uid: data.offer.customerUid,
		intro: data.offer.intro,
		closing: data.offer.closing,
		vat: String(data.offer.vatRate).replace('.', ',')
	});
	// svelte-ignore state_referenced_locally
	let lines = $state<Line[]>(
		data.offer.lines.map((l) => ({
			key: nextKey++,
			kind: l.kind,
			text: l.text,
			quantity: l.quantity == null ? '' : String(l.quantity).replace('.', ','),
			unit: l.unit,
			price: amountInput(l.unitPrice)
		}))
	);

	const numbers = $derived(lineNumbers(lines));
	const parsed = $derived(lines.map((l) => ({ kind: l.kind, quantity: parseAmount(l.quantity), unitPrice: parseAmount(l.price) })));
	const totals = $derived(offerTotals(parsed, parseAmount(head.vat) ?? 0));
	const st = $derived(OFFER_STATUS_LABELS[offerState(offer)] ?? OFFER_STATUS_LABELS.entwurf);

	let busy = $state(false);
	let releaseOpen = $state(false);
	let withdrawOpen = $state(false);
	let reopenOpen = $state(false);
	let acceptOpen = $state(false);
	let deleteOpen = $state(false);
	let customerOpen = $state(false);
	let orderOpen = $state(false);
	let customerBusy = $state(false);
	let orderBusy = $state(false);
	/** Unterlagen: Hochladen in Teilen, mit Fortschritt */
	let docUploading = $state(false);
	let docShare = $state(0);
	let docError = $state('');
	let removeDoc = $state<{ id: number; title: string } | null>(null);
	/** Pläne beim Erstellen des Auftrags: Anteil hochgeladen (null = gerade nicht) */
	let planShare = $state<number | null>(null);
	let planError = $state('');
	let listBox = $state<HTMLElement>();

	/** Kunde gewählt: seine Anschrift kommt ins Angebot (danach hier noch änderbar) */
	function pickCustomer(id = head.customerId) {
		const c = data.customers.find((x) => String(x.id) === id);
		if (!c) return;
		head.customerId = String(c.id);
		head.name = c.name;
		head.addition = c.addition;
		head.street = c.street;
		head.zip = c.zip;
		head.city = c.city;
		head.uid = c.uid;
	}

	async function addLine(kind: 'position' | 'titel') {
		if (lines.length >= MAX_OFFER_LINES) return;
		lines.push({ key: nextKey++, kind, text: '', quantity: kind === 'position' ? '' : '', unit: '', price: '' });
		await tick();
		listBox?.querySelector<HTMLElement>(`[data-zeile="${lines.length - 1}"]`)?.focus();
	}
	function removeLine(key: number) {
		lines = lines.filter((l) => l.key !== key);
	}
	function moveLine(i: number, by: -1 | 1) {
		const j = i + by;
		if (j < 0 || j >= lines.length) return;
		const copy = [...lines];
		[copy[i], copy[j]] = [copy[j], copy[i]];
		lines = copy;
	}

	const name = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(' ');
	const message = $derived(form && 'message' in form ? form.message : '');
	/** Änderungswunsch, der noch nicht mit einer neuen Freigabe beantwortet ist */
	const openRequest = $derived(
		!!offer.changeRequest && (offer.status === 'aenderung' || (offer.status === 'entwurf' && !offer.releasedAt))
	);
</script>

{#snippet field(label: string, nameAttr: string, value: string, set: (v: string) => void, opts: { cls?: string; max?: number; list?: string; mode?: 'decimal' } = {})}
	<label class="block {opts.cls ?? ''}">
		<span class="field-label">{label}</span>
		<input
			class="input {opts.mode ? 'num' : ''}"
			name={nameAttr}
			maxlength={opts.max ?? 160}
			list={opts.list}
			inputmode={opts.mode}
			{value}
			oninput={(e) => set(e.currentTarget.value)}
		/>
	</label>
{/snippet}

<svelte:head><title>{pageTitle(`Angebot ${spacedNumber(offer.number)}`)}</title></svelte:head>

<a href="/angebote" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Angebote
</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">Angebot {spacedNumber(offer.number)}</h1>
		<p class="text-ink-2">{[offer.title || 'Ohne BV', offer.customerName].filter(Boolean).join(' · ')}</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<span class="badge {st.tone}">{#if offer.status === 'angenommen'}<CircleCheck size={13} aria-hidden="true" />{/if}{st.label}</span>
		<PdfButton href="/angebote/{offer.id}/pdf"><FileText size={18} aria-hidden="true" />PDF</PdfButton>
		<a href="/angebote/{offer.id}/druck" class="btn btn-secondary"><Printer size={18} aria-hidden="true" />Drucken</a>
	</div>
</div>

{#if message}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{message}</p>{/if}

{#if openRequest}
	<section class="card mb-4 border-warn/50 p-4 lg:p-5">
		<h2 class="flex items-center gap-2 text-lg"><MessageSquare size={18} aria-hidden="true" />Änderungswunsch des Kunden</h2>
		<p class="mt-1 text-sm text-ink-2">
			{offer.changeRequestName}{offer.changeRequestedAt ? `, ${dateTime(offer.changeRequestedAt)}` : ''}
		</p>
		<blockquote class="mt-3 rounded-xl bg-surface-2 px-4 py-3 whitespace-pre-line">{offer.changeRequest}</blockquote>
		{#if offer.status === 'aenderung' && data.canWithdraw}
			<p class="mt-3 text-sm text-ink-2">Zum Ändern das Angebot überarbeiten und danach neu freigeben – der Kunde sieht es dann über denselben Link.</p>
			<button type="button" class="btn btn-primary mt-3" onclick={() => (withdrawOpen = true)}><Pencil size={18} aria-hidden="true" />Überarbeiten</button>
		{:else if offer.status === 'entwurf'}
			<p class="mt-3 text-sm text-ink-2">Nach dem Überarbeiten wieder freigeben – der Kunde sieht es dann über denselben Link.</p>
		{/if}
	</section>
{/if}

{#if data.inquiry}
	<!-- Die E-Mail der Anfrage daneben – beim Schreiben offen, danach zugeklappt -->
	<details class="card mb-4 p-4 lg:p-5" open={offer.status === 'entwurf'}>
		<summary class="flex cursor-pointer items-center gap-2 font-display text-lg font-semibold">
			<Inbox size={18} aria-hidden="true" />Anfrage vom {dateLabel(data.inquiry.receivedOn)}
		</summary>
		<p class="mt-1 text-sm text-ink-2">
			{[data.inquiry.subject, data.inquiry.senderName || data.inquiry.senderEmail].filter(Boolean).join(' · ')} ·
			<a href="/anfragen/{data.inquiry.id}" class="font-medium underline-offset-2 hover:underline">Zur Anfrage</a>
		</p>
		{#if data.inquiry.body}
			<p class="mt-3 max-h-80 overflow-y-auto rounded-xl bg-surface-2 px-4 py-3 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap">{data.inquiry.body}</p>
		{/if}
	</details>
{/if}

{#if offer.status === 'angenommen'}
	<section class="card mb-4 grid gap-4 p-4 sm:grid-cols-[auto_1fr] lg:p-5">
		{#if offer.acceptedSignature}
			<svg viewBox="0 0 {SIGNATURE_WIDTH} {SIGNATURE_HEIGHT}" class="h-16 w-48 rounded-lg bg-white" role="img" aria-label="Unterschrift des Kunden">
				<path d={offer.acceptedSignature} fill="none" stroke="#1d2127" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		{/if}
		<div>
			{#if offer.acceptedSignature}
				<p class="flex items-center gap-2 font-medium"><CircleCheck size={18} class="text-ok" aria-hidden="true" />Vom Kunden angenommen</p>
				<p class="text-sm text-ink-2">{offer.acceptedName}{offer.acceptedAt ? `, ${dateTime(offer.acceptedAt)}` : ''}</p>
			{:else}
				<!-- Intern markiert (Zusage am Telefon o. Ä.) oder aus dem bisherigen Programm übernommen -->
				<p class="flex items-center gap-2 font-medium">
					<CircleCheck size={18} class="text-ok" aria-hidden="true" />{offer.acceptedAt ? 'Intern als angenommen markiert' : 'Angenommen'}
				</p>
				{#if offer.acceptedAt}
					<p class="text-sm text-ink-2">
						{[
							offer.acceptedName && `Zusage von ${offer.acceptedName}`,
							`am ${dateTime(offer.acceptedAt)}`,
							name(offer.acceptedByFirst, offer.acceptedByLast) && `eingetragen von ${name(offer.acceptedByFirst, offer.acceptedByLast)}`
						]
							.filter(Boolean)
							.join(' · ')}
					</p>
				{/if}
			{/if}
			{#if offer.billedAt}
				<p class="mt-1 text-sm text-ink-2">Abgerechnet am {dateTime(offer.billedAt)} – Auftrag abgeschlossen, Rechnungen bezahlt.</p>
			{/if}
			{#if offer.order}
				<a href="/auftraege/{offer.order.id}" class="btn btn-secondary mt-3"><HardHat size={18} aria-hidden="true" />Zum Auftrag {spacedNumber(offer.number)}</a>
			{:else if data.canCreateOrder}
				<button type="button" class="btn btn-primary mt-3" onclick={() => (orderOpen = true)}><HardHat size={18} aria-hidden="true" />Auftrag erstellen</button>
			{:else}
				<p class="mt-2 text-sm text-ink-3">Noch kein Auftrag erstellt.</p>
			{/if}
		</div>
	</section>
{/if}

{#if data.canLink}
	<CustomerLink
		url={data.customerUrl}
		description={offer.status === 'angenommen'
			? 'Der Kunde hat angenommen. Über denselben Link kann er das Angebot jederzeit wieder ansehen und als PDF laden.'
			: 'Über diesen Link sieht der Kunde das Angebot und nimmt es mit Name und Unterschrift an – oder schickt Änderungswünsche. Der Link bleibt dauerhaft gleich.'}
		shareTitle={`Angebot ${spacedNumber(offer.number)}`}
		shareText={offer.status === 'angenommen' ? 'Ihr angenommenes Angebot:' : 'Unser Angebot – bitte ansehen und annehmen:'}
		mailConfigured={data.mailConfigured}
		email={String((form && 'email' in form && form.email) || offer.customerEmail || offer.masterEmail || '')}
		sentTo={offer.customerEmail}
		sentAt={offer.customerLinkSentAt}
	/>
{/if}

<form
	id="angebot"
	method="POST"
	action="?/save"
	use:enhance={({ action }) => {
		busy = true;
		const release = action.search.includes('release');
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				if (release) {
					toast.success('Angebot freigegeben', 'Der Link für den Kunden ist bereit.');
					releaseOpen = false;
				} else toast.success('Gespeichert');
			}
			await update({ reset: false });
		};
	}}
>
	<fieldset disabled={!data.editable} class="contents">
		<div class="grid gap-4 lg:grid-cols-2">
			<section class="card p-4 lg:p-5">
				<div class="flex flex-wrap items-end justify-between gap-2">
					<h2 class="text-lg">Kunde</h2>
					{#if data.canAddCustomer}
						<button type="button" class="btn btn-ghost btn-sm" onclick={() => (customerOpen = true)}><UserPlus size={16} aria-hidden="true" />Neuer Kunde</button>
					{/if}
				</div>
				{#if data.editable}
					<label class="mt-2 block">
						<span class="field-label">Aus dem Kundenstamm</span>
						<select class="select" bind:value={head.customerId} onchange={() => pickCustomer()}>
							<option value="">– von Hand –</option>
							{#each data.customers as c (c.id)}<option value={String(c.id)}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>{/each}
						</select>
					</label>
				{/if}
				<input type="hidden" name="kunde" value={head.customerId} />
				<div class="mt-3 grid grid-cols-6 gap-3">
					{@render field('Firma bzw. Name', 'k_name', head.name, (v) => (head.name = v), { cls: 'col-span-6' })}
					{@render field('Zusatz', 'k_zusatz', head.addition, (v) => (head.addition = v), { cls: 'col-span-6' })}
					{@render field('Straße bzw. Postfach', 'k_strasse', head.street, (v) => (head.street = v), { cls: 'col-span-6' })}
					{@render field('PLZ', 'k_plz', head.zip, (v) => (head.zip = v), { cls: 'col-span-2', max: 12 })}
					{@render field('Ort', 'k_ort', head.city, (v) => (head.city = v), { cls: 'col-span-4', max: 120 })}
					{@render field('Kunden UID-Nummer', 'k_uid', head.uid, (v) => (head.uid = v), { cls: 'col-span-6', max: 30 })}
				</div>
			</section>

			<section class="card p-4 lg:p-5">
				<h2 class="text-lg">Angebot</h2>
				<div class="mt-2 grid grid-cols-2 gap-3">
					{@render field('Angebotsnummer', 'nummer', head.number, (v) => (head.number = v), { max: 30 })}
					{@render field('Projektnummer', 'projekt', head.projectNumber, (v) => (head.projectNumber = v), { max: 30 })}
					<label class="block">
						<span class="field-label">Angebotsdatum</span>
						<input class="input num" type="date" name="datum" required bind:value={head.date} />
					</label>
					{@render field('Umsatzsteuer in %', 'ust', head.vat, (v) => (head.vat = v), { max: 6, mode: 'decimal' })}
					<label class="col-span-2 block">
						<span class="field-label">Bauvorhaben (BV)</span>
						<textarea class="textarea auto" name="titel" rows="2" maxlength="300" bind:value={head.title}></textarea>
					</label>
					<label class="col-span-2 block">
						<span class="field-label">Ausführungsort</span>
						<input class="input" name="ort" maxlength="300" placeholder="z. B. Flughafen Wien, Werkstättenring Süd" bind:value={head.location} />
					</label>
				</div>
			</section>
		</div>

		<section class="card mt-4 p-4 lg:p-5">
			<label class="block">
				<span class="field-label">Einleitung</span>
				<textarea class="textarea auto" name="einleitung" rows="2" maxlength="3000" bind:value={head.intro}></textarea>
			</label>
		</section>

		<section class="card mt-4 p-4 lg:p-5" bind:this={listBox}>
			<h2 class="text-lg">Positionen</h2>
			<div class="mt-3 hidden gap-2 text-[0.8125rem] text-ink-3 md:grid md:grid-cols-[2.5rem_minmax(0,1fr)_5rem_7.5rem_7rem_7rem_5.5rem]">
				<span>Nr.</span><span>Bezeichnung</span><span class="text-right">Menge</span><span>Einheit</span><span class="text-right">EP in €</span><span class="text-right">GP</span><span></span>
			</div>
			<ul class="mt-1 divide-y divide-line">
				{#each lines as l, i (l.key)}
					<li class="py-2.5">
						<input type="hidden" name="z.{i}.art" value={l.kind} />
						{#if l.kind === 'titel'}
							<div class="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2">
								<span class="num font-semibold">{numbers[i]}</span>
								<input
									class="input font-semibold"
									name="z.{i}.text"
									maxlength="300"
									placeholder="Überschrift, z. B. Werkstättenring Süd"
									data-zeile={i}
									bind:value={l.text}
									aria-label="Überschrift Zeile {i + 1}"
								/>
								{@render tools(i, l.key)}
							</div>
						{:else}
							<div class="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 md:grid-cols-[2.5rem_minmax(0,1fr)_5rem_7.5rem_7rem_7rem_5.5rem] md:items-start">
								<span class="num pt-2 text-sm">{numbers[i]}</span>
								<textarea
									class="textarea auto min-h-10 py-2 font-medium"
									name="z.{i}.text"
									rows="1"
									maxlength="4000"
									placeholder="Bezeichnung, z. B. Linie 10 – 15 cm, weiß, MSK D refl."
									data-zeile={i}
									bind:value={l.text}
									aria-label="Bezeichnung Zeile {i + 1}"
								></textarea>
								<div class="md:hidden">{@render tools(i, l.key)}</div>
								<div class="col-span-3 grid grid-cols-4 gap-2 md:contents">
									<label class="block">
										<span class="field-label md:sr-only">Menge</span>
										<input class="input num text-right" name="z.{i}.menge" inputmode="decimal" maxlength="14" bind:value={l.quantity} />
									</label>
									<label class="block">
										<span class="field-label md:sr-only">Einheit</span>
										<input class="input" name="z.{i}.einheit" maxlength="20" list="einheiten" bind:value={l.unit} />
									</label>
									<label class="block">
										<span class="field-label md:sr-only">EP in €</span>
										<input class="input num text-right" name="z.{i}.preis" inputmode="decimal" maxlength="14" bind:value={l.price} />
									</label>
									<div class="block">
										<span class="field-label md:sr-only">GP</span>
										<p class="num py-2 text-right font-medium">{money(lineTotal(parsed[i])) || '–'}</p>
									</div>
								</div>
								<div class="hidden md:block">{@render tools(i, l.key)}</div>
							</div>
						{/if}
					</li>
				{:else}
					<li class="py-3 text-sm text-ink-3">Noch keine Position.</li>
				{/each}
			</ul>
			<datalist id="einheiten">{#each OFFER_UNITS as u (u)}<option value={u}></option>{/each}</datalist>
			{#if data.editable}
				<div class="mt-3 flex flex-wrap gap-2">
					<button type="button" class="btn btn-secondary btn-sm" onclick={() => addLine('position')} disabled={lines.length >= MAX_OFFER_LINES}>
						<Plus size={16} aria-hidden="true" />Position
					</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => addLine('titel')} disabled={lines.length >= MAX_OFFER_LINES}>
						<Heading size={16} aria-hidden="true" />Überschrift
					</button>
				</div>
			{/if}

			<dl class="num mt-4 ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 border-t border-line pt-3">
				<dt>Gesamt Netto</dt>
				<dd class="text-right">{money(totals.net)}</dd>
				<dt>{head.vat || '0'} % Umsatzsteuer</dt>
				<dd class="text-right">{money(totals.vat)}</dd>
				<dt class="border-t border-ink pt-1.5 text-lg font-semibold">Gesamtbetrag</dt>
				<dd class="border-t border-ink pt-1.5 text-right text-lg font-semibold">{money(totals.gross)}</dd>
			</dl>
		</section>

		<section class="card mt-4 p-4 lg:p-5">
			<label class="block">
				<span class="field-label">Schlusstext</span>
				<textarea class="textarea auto" name="schluss" rows="3" maxlength="5000" bind:value={head.closing}></textarea>
			</label>
		</section>
	</fieldset>

	{#if data.editable || data.canRelease || data.canWithdraw || data.canAccept}
		<div class="card sticky bottom-24 mt-4 flex flex-wrap items-center gap-2 p-3 lg:bottom-6">
			{#if data.editable}
				<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Speichern'}</button>
			{/if}
			{#if data.canRelease}
				<button type="button" class="btn {data.editable ? 'btn-secondary' : 'btn-primary'}" disabled={busy} onclick={() => (releaseOpen = true)}>
					<Send size={18} aria-hidden="true" />Freigeben
				</button>
			{/if}
			{#if data.canAccept}
				<button type="button" class="btn btn-primary" disabled={busy} onclick={() => (acceptOpen = true)}>
					<CircleCheck size={18} aria-hidden="true" />Als angenommen markieren
				</button>
			{/if}
			{#if data.canWithdraw && offer.status === 'freigegeben'}
				<button type="button" class="btn btn-secondary" disabled={busy} onclick={() => (withdrawOpen = true)}>
					<Pencil size={18} aria-hidden="true" />Überarbeiten
				</button>
			{/if}
			<span class="ml-auto text-sm text-ink-2">
				{offer.status === 'freigegeben'
					? `Ausstehend seit ${offer.releasedAt ? dateTime(offer.releasedAt) : '–'}`
					: `${lines.filter((l) => l.kind === 'position').length} Positionen · ${money(totals.gross)} brutto`}
			</span>
		</div>
	{:else}
		<p class="field-hint mt-4">
			{offer.status === 'angenommen' ? 'Das Angebot ist angenommen und lässt sich nicht mehr ändern.' : 'Dieses Angebot kannst du nur ansehen.'}
		</p>
	{/if}
</form>

<section class="card mt-4 p-4 lg:p-5" aria-labelledby="h-unterlagen">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<h2 id="h-unterlagen" class="text-lg">Unterlagen</h2>
			<p class="text-sm text-ink-2">
				PDFs zum Angebot – auch wenn es schon beauftragt ist. Mit <span class="font-medium text-ink">Partie</span> angehakt erscheinen sie auch beim Auftrag; sonst
				sieht sie nur das Büro.
			</p>
		</div>
		{#if data.canManageDocuments}
			<form
				method="POST"
				action="?/docUpload"
				enctype="multipart/form-data"
				class="flex flex-wrap items-center gap-3"
				use:enhance={async ({ formData, formElement, cancel }) => {
					docUploading = true;
					docShare = 0;
					docError = '';
					// Große PDFs in Teilen vorab – ins Formular kommen nur noch die Kennungen
					try {
						await uploadFormPdfs(formData, 'dateien', (share) => (docShare = share));
					} catch (err) {
						docUploading = false;
						docError = err instanceof UploadError ? err.message : 'Das Hochladen hat nicht geklappt – bitte noch einmal versuchen.';
						formElement.reset();
						cancel();
						return;
					}
					return async ({ result, update }) => {
						docUploading = false;
						if (result.type === 'success') toast.success(Number(result.data?.added) === 1 ? 'PDF hochgeladen' : `${result.data?.added} PDFs hochgeladen`);
						await update();
					};
				}}
			>
				<label class="flex items-center gap-2 text-sm" title="Erscheint auch beim Auftrag – die Partie sieht es">
					<input type="checkbox" name="partie" class="size-4 accent-current" />
					für die Partie
				</label>
				<label class="upload btn btn-secondary btn-sm {docUploading ? 'pointer-events-none opacity-50' : ''}">
					<Upload size={16} aria-hidden="true" />{docUploading ? `Wird hochgeladen … ${Math.floor(docShare * 100)} %` : 'PDF hochladen'}
					<input
						type="file"
						name="dateien"
						accept="application/pdf,.pdf"
						multiple
						class="sr-only"
						onchange={(e) => e.currentTarget.files?.length && e.currentTarget.form?.requestSubmit()}
					/>
				</label>
			</form>
		{/if}
	</div>
	{#if docError}<p class="field-error mt-2" role="alert">{docError}</p>
	{:else if form && 'docError' in form && form.docError}<p class="field-error mt-2" role="alert">{form.docError}</p>{/if}
	{#if data.documents.length}
		<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
			{#each data.documents as d (d.id)}
				<li class="flex items-center gap-2">
					<a href="/angebote/{offer.id}/unterlagen/{d.id}" class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
						<FileText size={20} class="shrink-0 text-ink-3" aria-hidden="true" />
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{d.title}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">{d.fileName} · {fileSizeLabel(d.size)}</span>
						</span>
						<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
					</a>
					{#if data.canManageDocuments}
						<form
							method="POST"
							action="?/docCrew"
							use:enhance={() => async ({ result, update }) => {
								if (result.type === 'success') toast.success(result.data?.forCrew ? 'Erscheint jetzt auch beim Auftrag' : 'Nur noch fürs Büro');
								await update({ reset: false });
							}}
						>
							<input type="hidden" name="dokument" value={d.id} />
							<input type="hidden" name="an" value={d.forCrew ? '0' : '1'} />
							<button
								class="badge {d.forCrew ? 'badge-info' : ''} cursor-pointer"
								title={d.forCrew ? 'Erscheint beim Auftrag – klicken für nur Büro' : 'Nur fürs Büro – klicken, damit es die Partie beim Auftrag sieht'}
							>
								{d.forCrew ? 'Partie' : 'Nur Büro'}
							</button>
						</form>
						<button
							type="button"
							class="mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-danger"
							aria-label="{d.title} entfernen"
							onclick={() => (removeDoc = d)}
						>
							<X size={16} />
						</button>
					{:else}
						<span class="badge mr-3 {d.forCrew ? 'badge-info' : ''}">{d.forCrew ? 'Partie' : 'Nur Büro'}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-ink-3">Noch keine Unterlagen.</p>
	{/if}
</section>

<Dialog open={!!removeDoc} onclose={() => (removeDoc = null)} title="Unterlage entfernen?">
	{#if removeDoc}
		<p class="text-ink-2">„{removeDoc.title}“ wird vom Angebot entfernt{offer.order ? ' – und erscheint dann auch beim Auftrag nicht mehr' : ''}.</p>
		<form
			method="POST"
			action="?/docDelete"
			class="mt-5 flex justify-end gap-2"
			use:enhance={() => async ({ update }) => {
				removeDoc = null;
				await update();
			}}
		>
			<input type="hidden" name="dokument" value={removeDoc.id} />
			<button type="button" class="btn btn-ghost" onclick={() => (removeDoc = null)}>Abbrechen</button>
			<button class="btn btn-primary">Entfernen</button>
		</form>
	{/if}
</Dialog>

{#snippet tools(i: number, key: number)}
	{#if data.editable}
		<div class="flex items-center justify-end gap-0.5">
			<button type="button" class="tool" aria-label="Zeile {i + 1} nach oben" disabled={i === 0} onclick={() => moveLine(i, -1)}><ArrowUp size={15} /></button>
			<button type="button" class="tool" aria-label="Zeile {i + 1} nach unten" disabled={i === lines.length - 1} onclick={() => moveLine(i, 1)}><ArrowDown size={15} /></button>
			<button type="button" class="tool hover:text-danger" aria-label="Zeile {i + 1} entfernen" onclick={() => removeLine(key)}><X size={15} /></button>
		</div>
	{/if}
{/snippet}

<div class="mt-4 flex flex-wrap gap-2">
	{#if data.canReopen}
		<button type="button" class="btn btn-ghost" onclick={() => (reopenOpen = true)}><LockOpen size={18} aria-hidden="true" />Wieder öffnen</button>
	{/if}
	{#if data.canDelete}
		<button type="button" class="btn btn-ghost ml-auto text-danger hover:bg-danger-soft" onclick={() => (deleteOpen = true)}>
			<Trash size={18} aria-hidden="true" />Löschen
		</button>
	{/if}
</div>

<p class="field-hint mt-4">
	Angelegt {offer.creatorFirst || offer.creatorLast ? `von ${name(offer.creatorFirst, offer.creatorLast)} ` : ''}am {dateTime(offer.createdAt)}{offer.releasedAt
		? ` · freigegeben von ${name(offer.releasedByFirst, offer.releasedByLast) || 'Unbekannt'} am ${dateTime(offer.releasedAt)}`
		: ''}
</p>

<Dialog bind:open={releaseOpen} title="Angebot freigeben">
	<p class="text-ink-2">
		Das Angebot {spacedNumber(head.number)} wird freigegeben{data.editable ? ' – was im Formular steht, wird vorher gespeichert' : ''}. Danach gibt es den
		Link für den Kunden: Er sieht das Angebot, nimmt es mit Name und Unterschrift an oder schickt Änderungswünsche.
	</p>
	{#if message}<p class="field-error mt-3" role="alert">{message}</p>{/if}
	<div class="mt-5 flex flex-wrap justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (releaseOpen = false)}>Abbrechen</button>
		<button type="submit" form="angebot" formaction="?/release" class="btn btn-primary" disabled={busy}><Send size={18} aria-hidden="true" />Freigeben</button>
	</div>
</Dialog>

<Dialog bind:open={withdrawOpen} title="Angebot überarbeiten?">
	<p class="text-ink-2">
		Das Angebot geht zurück in Arbeit. Solange sieht der Kunde über seinen Link nur „wird überarbeitet". Nach dem Ändern wieder freigeben – der
		Link bleibt derselbe.
	</p>
	<form
		method="POST"
		action="?/withdraw"
		class="mt-5 flex justify-end gap-2"
		use:enhance={() => async ({ update }) => {
			withdrawOpen = false;
			await update();
		}}
	>
		<button type="button" class="btn btn-ghost" onclick={() => (withdrawOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary"><Pencil size={18} aria-hidden="true" />Überarbeiten</button>
	</form>
</Dialog>

<Dialog bind:open={acceptOpen} title="Als angenommen markieren?">
	<p class="text-ink-2">
		Für eine Zusage ohne Unterschrift über den Link – etwa am Telefon, per E-Mail oder unterschrieben zurückgeschickt. Danach lässt sich der Auftrag
		erstellen.
	</p>
	<form
		method="POST"
		action="?/accept"
		class="mt-4 space-y-4"
		use:enhance={() => async ({ result, update }) => {
			acceptOpen = false;
			if (result.type === 'success') toast.success('Angebot angenommen');
			await update();
		}}
	>
		<label class="block">
			<span class="field-label">Zusage von</span>
			<input class="input" name="name" maxlength="120" placeholder="z. B. Hr. Maier, telefonisch" />
			<span class="field-hint">Freiwillig – steht beim Angebot und auf der Seite des Kunden.</span>
		</label>
		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (acceptOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary"><CircleCheck size={18} aria-hidden="true" />Angenommen</button>
		</div>
	</form>
</Dialog>

<Dialog bind:open={reopenOpen} title="Angenommenes Angebot wieder öffnen?">
	<p class="text-ink-2">Die Annahme durch den Kunden verfällt. Nach dem Ändern muss das Angebot neu freigegeben und vom Kunden neu angenommen werden.</p>
	<form method="POST" action="?/reopen" class="mt-5 flex justify-end gap-2" use:enhance={() => async ({ update }) => {
			reopenOpen = false;
			await update();
		}}>
		<button type="button" class="btn btn-ghost" onclick={() => (reopenOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary"><LockOpen size={18} aria-hidden="true" />Wieder öffnen</button>
	</form>
</Dialog>

<Dialog bind:open={deleteOpen} title="Angebot löschen?">
	<form method="POST" action="?/delete" use:enhance>
		<p class="text-ink-2">
			Das Angebot {spacedNumber(offer.number)} wird samt allen Positionen gelöscht{offer.status === 'angenommen' ? ' – auch die Annahme und Unterschrift des Kunden' : ''}.{offer.customerToken
				? ' Der Link des Kunden funktioniert danach nicht mehr.'
				: ''} Das lässt sich nicht rückgängig machen.
		</p>
		{#if offer.order}
			{#if data.canDeleteOrder}
				<label class="mt-4 flex items-start gap-3 rounded-xl border border-line-strong p-3 has-[:checked]:border-danger">
					<input type="checkbox" name="auftrag" value="ja" class="mt-0.5 size-5 shrink-0 accent-[var(--c-danger)]" />
					<span>
						<span class="block font-medium">Auftrag {spacedNumber(offer.number)} ebenfalls löschen</span>
						<span class="block text-sm text-ink-2">Samt Plänen und Unterlagen. Seine Tagesberichte bleiben, nur ohne Auftrag. Ohne Haken bleibt der Auftrag bestehen.</span>
					</span>
				</label>
			{:else}
				<p class="mt-3 text-sm text-ink-2">Der Auftrag {spacedNumber(offer.number)} bleibt bestehen – nur ohne Verbindung zum Angebot.</p>
			{/if}
		{/if}
		<div class="mt-5 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (deleteOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary"><Trash size={18} aria-hidden="true" />Löschen</button>
		</div>
	</form>
</Dialog>

<Dialog bind:open={customerOpen} title="Neuer Kunde" wide>
	<form
		method="POST"
		action="?/newCustomer"
		class="space-y-4"
		use:enhance={() => {
			customerBusy = true;
			return async ({ result, update }) => {
				customerBusy = false;
				await update({ reset: false });
				if (result.type === 'success' && result.data?.customer) {
					const c = result.data.customer as { id: number };
					pickCustomer(String(c.id));
					customerOpen = false;
					toast.success('Kunde angelegt und ausgewählt');
				}
			};
		}}
	>
		<CustomerFields />
		{#if form && 'customerMessage' in form && form.customerMessage}<p class="field-error" role="alert">{form.customerMessage}</p>{/if}
		<div class="flex justify-end gap-2 pt-1">
			<button type="button" class="btn btn-ghost" onclick={() => (customerOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary" disabled={customerBusy}>Anlegen</button>
		</div>
	</form>
</Dialog>

<Dialog bind:open={orderOpen} title="Auftrag erstellen">
	<form
		method="POST"
		action="?/createOrder"
		enctype="multipart/form-data"
		class="space-y-4"
		use:enhance={async ({ formData, cancel }) => {
			orderBusy = true;
			planError = '';
			// Pläne in Teilen vorab – ohne Größengrenze; ist eine kein PDF, entsteht kein Auftrag
			try {
				planShare = 0;
				await uploadFormPdfs(formData, 'plaene', (share) => (planShare = share));
			} catch (err) {
				planError = err instanceof UploadError ? err.message : 'Das Hochladen hat nicht geklappt – bitte noch einmal versuchen.';
				orderBusy = false;
				cancel();
				return;
			} finally {
				planShare = null;
			}
			return async ({ update }) => {
				orderBusy = false;
				await update({ reset: false });
			};
		}}
	>
		<p class="text-ink-2">
			Der Auftrag bekommt die Nummer {spacedNumber(offer.number)}, die Anschrift und alle Positionen – ohne Preise. Die Partie sieht ihn danach unter
			Aufträge und setzt ihn auf „in Arbeit" und „abgeschlossen". Ohne Partie bleibt er „nicht zugeteilt" und steht in der Wochenplanung zum Einplanen.
		</p>
		<label class="block">
			<span class="field-label">Partie</span>
			<select class="select" name="partie">
				<option value="">Noch keine – später zuteilen</option>
				{#each data.parties as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
		</label>
		<label class="block">
			<span class="field-label">Hinweis für die Partie</span>
			<textarea class="textarea" name="hinweis" rows="3" maxlength="2000" placeholder="z. B. Zufahrt über Tor 3, Ansprechpartner vor Ort …"></textarea>
		</label>
		<label class="block">
			<span class="field-label">Pläne und Unterlagen <span class="font-normal text-ink-3">(PDF, freiwillig – auch später im Auftrag)</span></span>
			<input class="input py-2" type="file" name="plaene" accept="application/pdf,.pdf" multiple />
		</label>
		{#if planError}<p class="field-error" role="alert">{planError}</p>
		{:else if form && 'orderMessage' in form && form.orderMessage}<p class="field-error" role="alert">{form.orderMessage}</p>{/if}
		<div class="flex justify-end gap-2 pt-1">
			<button type="button" class="btn btn-ghost" onclick={() => (orderOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary" disabled={orderBusy}><HardHat size={18} aria-hidden="true" />{planShare !== null ? `Pläne hochladen … ${Math.floor(planShare * 100)} %` : orderBusy ? 'Wird erstellt …' : 'Auftrag erstellen'}</button>
		</div>
	</form>
</Dialog>

<style>
	/* Der Knopf ist ein Label um das Dateifeld – den Fokus zeigt er selbst */
	.upload:has(input:focus-visible) {
		outline: 2px solid var(--c-focus);
		outline-offset: 2px;
	}
	/* Textfelder wachsen mit dem Inhalt, wo der Browser das kann */
	.auto {
		field-sizing: content;
		min-height: 2.5rem;
		resize: vertical;
	}
	.tool {
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		border-radius: 0.5rem;
		color: var(--c-ink-3);
	}
	.tool:hover:not(:disabled) {
		background: var(--c-surface-3);
	}
	.tool:disabled {
		opacity: 0.3;
	}
</style>
