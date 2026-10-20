<script lang="ts" module>
	export interface EditorHead {
		kind: 'rechnung' | 'teilrechnung';
		/** Fürs Summenblatt */
		state: string;
		section: string;
		date: string;
		dueDate: string;
		serviceFrom: string;
		serviceTo: string;
		title: string;
		location: string;
		/** Steht hinter der Rechnungsnummer: „Nummer/Kostenstelle" */
		costCenter: string;
		customerName: string;
		customerAddition: string;
		customerStreet: string;
		customerZip: string;
		customerCity: string;
		customerUid: string;
		intro: string;
		closing: string;
		vatRate: number;
		reverseCharge: boolean;
	}

	export interface EditorLine {
		number: string;
		kind: 'position' | 'titel';
		text: string;
		note?: string;
		quantity: number | null;
		unit: string;
		unitPrice: number | null;
		offerLineId?: number | null;
		offerQuantity?: number | null;
		source?: string;
		/** Eigene Position aus den Berichten (nicht im Auftrag) */
		columnKey?: string | null;
		ownTitle?: boolean;
	}
</script>

<script lang="ts">
	/**
	 * Rechnung schreiben bzw. ändern: Kopf (Datum, Zahlungsziel, Leistungszeitraum,
	 * Kunde), Positionen mit Menge und Einheitspreis, Texte und Summen.
	 *
	 * Bei einer neuen Rechnung stehen oben die Tagesberichte, die noch nicht
	 * abgerechnet sind – alle oder nur ein Teil davon kommen in diese Rechnung –
	 * und die Zuordnung: je Mengenspalte die Angebotsposition, deren Preis gilt.
	 * Ändert sich Auswahl oder Zuordnung, bekommen die Positionen ihre Menge neu.
	 */
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { addDays, isValidIsoDate } from '$lib/modules/stunden/week';
	import { reportDateLabel } from '$lib/modules/tagesberichte/sheet';
	import { amountInput, INVOICE_KIND_LABELS, invoiceTotals, lineTotal, money, parseAmount, quantityLabel, REVERSE_CHARGE_NOTE } from '../offer';
	import {
		columnLabel,
		invoiceLines,
		OWN_LINE,
		selectedColumns,
		selectedPeriod,
		suggestKind,
		type InvoiceLineDraft,
		type Mapping,
		type PricedLine,
		type SummaryColumn,
		type SummaryReport
	} from '../summary';

	interface Props {
		head: EditorHead;
		lines: EditorLine[];
		paymentDays: number;
		/** Vorschläge für die Einheit – aus den Stammdaten; frei eintippen geht weiter */
		units?: string[];
		/** Nur bei einer neuen Rechnung: Spalten aus den Tagesberichten und die Angebotspositionen */
		mapping?: { columns: SummaryColumn[]; priced: PricedLine[]; initial: Mapping } | null;
		/** Nur bei einer neuen Rechnung: die Berichte zur Wahl und was es zum Auftrag schon gibt */
		selection?: { reports: SummaryReport[]; pending: number; previous: number; closed: boolean; flatBilled: number[] } | null;
		busy?: boolean;
		submitLabel: string;
		message?: string;
	}
	let { head: initialHead, lines: initialLines, paymentDays, units = [], mapping = null, selection = null, busy = false, submitLabel, message = '' }: Props = $props();

	type Line = {
		key: number;
		number: string;
		kind: 'position' | 'titel';
		text: string;
		note: string;
		quantity: string;
		unit: string;
		price: string;
		offerLineId: number | null;
		offerQuantity: number | null;
		source: string;
		columnKey: string | null;
		ownTitle: boolean;
	};

	let nextKey = 1;
	const qtyInput = (v: number | null) => (v == null ? '' : String(v).replace('.', ','));
	// Die Vorgaben werden nur beim Öffnen übernommen – danach gehört der Stand dem Formular
	// svelte-ignore state_referenced_locally
	let head = $state({ ...initialHead, vat: String(initialHead.vatRate).replace('.', ',') });
	// svelte-ignore state_referenced_locally
	const toLine = (l: EditorLine | InvoiceLineDraft): Line => ({
		key: nextKey++,
		number: l.number,
		kind: l.kind,
		text: l.text,
		note: l.note ?? '',
		quantity: qtyInput(l.quantity),
		unit: l.unit,
		price: amountInput(l.unitPrice),
		offerLineId: l.offerLineId ?? null,
		offerQuantity: l.offerQuantity ?? null,
		source: l.source ?? '',
		columnKey: l.columnKey ?? null,
		ownTitle: !!l.ownTitle
	});
	// svelte-ignore state_referenced_locally
	let lines = $state<Line[]>(initialLines.map(toLine));
	// svelte-ignore state_referenced_locally
	let assigned = $state<Record<string, string>>(
		Object.fromEntries(
			(mapping?.columns ?? []).map((c) => {
				const v = mapping!.initial[c.key];
				return [c.key, v === null ? 'nein' : v == null ? '' : String(v)];
			})
		)
	);
	/** Zahlbar bis folgt dem Rechnungsdatum, bis es jemand selbst ändert */
	let dueTouched = $state(false);
	/** Art und Leistungszeitraum folgen der Auswahl der Berichte, bis jemand sie selbst ändert */
	let kindTouched = $state(false);
	let periodTouched = $state(false);
	// svelte-ignore state_referenced_locally
	let picked = $state<Record<number, boolean>>(Object.fromEntries((selection?.reports ?? []).map((r) => [r.id, true])));
	const chosen = $derived(new Set((selection?.reports ?? []).filter((r) => picked[r.id]).map((r) => r.id)));
	/** Spalten mit den Summen der gewählten Berichte */
	const columns = $derived(mapping ? (selection ? selectedColumns(mapping.columns, selection.reports, chosen) : mapping.columns) : []);

	const parsed = $derived(lines.map((l) => ({ kind: l.kind, quantity: parseAmount(l.quantity), unitPrice: parseAmount(l.price) })));
	const totals = $derived(invoiceTotals(parsed, parseAmount(head.vat) ?? 0, head.reverseCharge));
	const openColumns = $derived(columns.filter((c) => !assigned[c.key]).length);

	function onDate() {
		if (!dueTouched && isValidIsoDate(head.date)) head.dueDate = addDays(head.date, paymentDays);
	}

	/**
	 * Mengen neu: bei geänderter Zuordnung nur die betroffenen Positionen, bei
	 * geänderter Auswahl der Berichte alle, deren Menge aus den Berichten kommt.
	 */
	function remap(all = false) {
		if (!mapping) return;
		const current: Mapping = {};
		for (const [k, v] of Object.entries(assigned)) current[k] = v === 'nein' ? null : v === OWN_LINE ? OWN_LINE : v ? Number(v) : undefined;
		const all_ = invoiceLines(mapping.priced, columns, current, selection?.flatBilled);
		const drafts = new Map(all_.filter((d) => d.offerLineId != null).map((d) => [d.offerLineId, d]));
		for (const l of lines) {
			if (l.offerLineId == null || l.kind !== 'position') continue;
			const d = drafts.get(l.offerLineId);
			if (!d || (d.source === l.source && !(all && d.source))) continue;
			l.quantity = qtyInput(d.quantity);
			l.source = d.source;
		}

		// Eigene Positionen: dazu, weg oder mit neuer Menge – der eingetragene Preis bleibt
		const own = all_.filter((d) => d.columnKey);
		const keys = new Set(own.map((d) => d.columnKey));
		lines = lines.filter((l) => !l.columnKey || keys.has(l.columnKey));
		for (const d of own) {
			const l = lines.find((x) => x.columnKey === d.columnKey);
			if (!l) lines.push(toLine(d));
			else if (all || l.source !== d.source) {
				l.quantity = qtyInput(d.quantity);
				l.source = d.source;
			}
		}
		const hasTitle = lines.some((l) => l.ownTitle);
		if (own.length && !hasTitle) {
			const title = all_.find((d) => d.ownTitle);
			const at = lines.findIndex((l) => l.columnKey);
			if (title) lines.splice(at < 0 ? lines.length : at, 0, toLine(title));
		} else if (!own.length && hasTitle) {
			lines = lines.filter((l) => !l.ownTitle);
		}
	}

	/** Auswahl der Berichte geändert: Mengen, Zeitraum und Art folgen */
	function reselect() {
		if (!selection) return;
		remap(true);
		const period = selectedPeriod(selection.reports, chosen);
		if (!periodTouched && period) {
			head.serviceFrom = period.from;
			head.serviceTo = period.to;
		}
		if (!kindTouched) {
			head.kind = suggestKind({ closed: selection.closed, previous: selection.previous, available: selection.reports.length, selected: chosen.size, pending: selection.pending });
		}
	}
	function pickAll(on: boolean) {
		for (const r of selection?.reports ?? []) picked[r.id] = on;
		reselect();
	}

	function addLine() {
		lines.push({ key: nextKey++, number: '', kind: 'position', text: '', note: '', quantity: '', unit: '', price: '', offerLineId: null, offerQuantity: null, source: '', columnKey: null, ownTitle: false });
	}
	function removeLine(key: number) {
		lines = lines.filter((l) => l.key !== key);
	}

	const positionLabel = (p: PricedLine, nr: string) => `${nr} ${p.text.split('\n')[0].slice(0, 60)}${p.unit ? ` (${p.unit})` : ''}`;
	const pricedNumbers = $derived.by(() => {
		const map = new Map<number, string>();
		for (const l of initialLines) if (l.offerLineId != null) map.set(l.offerLineId, l.number);
		return map;
	});
</script>

{#if selection}
	<section class="card mb-4 p-4 lg:p-5">
		<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
			<h2 class="text-lg">Tagesberichte</h2>
			{#if selection.reports.length > 1}
				<span class="flex gap-1">
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => pickAll(true)}>Alle</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => pickAll(false)}>Keine</button>
				</span>
			{/if}
		</div>
		{#if selection.reports.length}
			<p class="mt-1 text-sm text-ink-2">
				Alle angekreuzten kommen in diese Rechnung – die übrigen bleiben für eine spätere Teilrechnung. Jeder Bericht wird nur einmal abgerechnet.
				<span class="num font-medium text-ink">{chosen.size} von {selection.reports.length} gewählt.</span>
			</p>
			<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
				{#each selection.reports as r (r.id)}
					<li>
						<label class="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-surface-2">
							<input type="checkbox" class="mt-0.5 size-5 shrink-0 accent-[var(--c-ink)]" name="bericht" value={r.id} bind:checked={picked[r.id]} onchange={reselect} />
							<span class="min-w-0">
								<span class="block font-medium"><span class="num">Nr. {r.number || '–'}</span> · <span class="num">{reportDateLabel(r.date, r.dateTo)}</span></span>
								<span class="block truncate text-sm text-ink-3">{[r.site, r.partyName].filter(Boolean).join(' · ') || 'ohne Baustelle'}</span>
							</span>
						</label>
					</li>
				{/each}
			</ul>
			{#if !chosen.size}<p class="mt-2 text-sm font-medium text-warn">Ohne Bericht kommt nur, was unten von Hand eingetragen ist.</p>{/if}
		{:else}
			<p class="mt-1 text-sm text-ink-2">Keine geprüften Tagesberichte – die Mengen unten selbst eintragen.</p>
		{/if}
		{#if selection.pending}
			<p class="mt-2 text-sm text-ink-3">
				{selection.pending}
				{selection.pending === 1 ? 'weiterer Bericht ist' : 'weitere Berichte sind'} noch nicht geprüft und {selection.pending === 1 ? 'kommt' : 'kommen'} erst danach zur Wahl.
			</p>
		{/if}
	</section>
{/if}

{#if mapping}
	<section class="card mb-4 p-4 lg:p-5">
		<h2 class="text-lg">Mengen aus den Tagesberichten</h2>
		{#if columns.length}
			<p class="mt-1 text-sm text-ink-2">
				Je Menge aus den Berichten die Position aus dem Angebot wählen – deren Preis gilt. Steht etwas nicht im Auftrag, wurde aber
				gemacht: „Eigene Position" – dann den Einheitspreis unten selbst eintragen. Die Zuordnung merkt sich der Auftrag.
				{#if openColumns}<span class="font-medium text-warn">Noch {openColumns} ohne Zuordnung.</span>{/if}
			</p>
			<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
				{#each columns as c (c.key)}
					<li class="grid items-center gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)]">
						<span class="min-w-0">
							<span class="num font-semibold">{columnLabel(c)}</span>
							<span class="text-ink-3"> · {c.unit || 'ohne Einheit'}</span>
							<span class="num block text-sm text-ink-2">Summe {quantityLabel(c.total)} {c.unit}</span>
						</span>
						<ArrowRight size={16} class="hidden text-ink-3 sm:block" aria-hidden="true" />
						<select class="select {assigned[c.key] ? '' : 'border-warn'}" name="m.{c.key}" bind:value={assigned[c.key]} onchange={() => remap()} aria-label="Position für {columnLabel(c)} {c.unit}">
							<option value="">Bitte wählen …</option>
							{#each mapping.priced.filter((p) => p.kind === 'position') as p (p.id)}
								<option value={String(p.id)}>{positionLabel(p, pricedNumbers.get(p.id) ?? '')}</option>
							{/each}
							<option value={OWN_LINE}>Eigene Position – nicht im Auftrag, Preis selbst eintragen</option>
							<option value="nein">Nicht abrechnen</option>
						</select>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-sm text-ink-2">Keine geprüften Tagesberichte mit Mengen – die Mengen hier unten selbst eintragen.</p>
		{/if}
	</section>
{/if}

<div class="grid gap-4 lg:grid-cols-2">
	<section class="card p-4 lg:p-5">
		<h2 class="text-lg">Kunde</h2>
		<div class="mt-3 grid gap-3 sm:grid-cols-6">
			<label class="block sm:col-span-6">
				<span class="field-label">Firma bzw. Name *</span>
				<input class="input" name="k_name" required maxlength="160" bind:value={head.customerName} />
			</label>
			<label class="block sm:col-span-6">
				<span class="field-label">Zusatz</span>
				<input class="input" name="k_zusatz" maxlength="160" bind:value={head.customerAddition} />
			</label>
			<label class="block sm:col-span-6">
				<span class="field-label">Straße</span>
				<input class="input" name="k_strasse" maxlength="160" bind:value={head.customerStreet} />
			</label>
			<label class="block sm:col-span-2">
				<span class="field-label">PLZ</span>
				<input class="input num" name="k_plz" maxlength="12" bind:value={head.customerZip} />
			</label>
			<label class="block sm:col-span-4">
				<span class="field-label">Ort</span>
				<input class="input" name="k_ort" maxlength="120" bind:value={head.customerCity} />
			</label>
			<label class="block sm:col-span-3">
				<span class="field-label">UID-Nummer{head.reverseCharge ? ' *' : ''}</span>
				<input class="input num" name="k_uid" maxlength="30" required={head.reverseCharge} bind:value={head.customerUid} />
			</label>
		</div>
	</section>

	<section class="card p-4 lg:p-5">
		<h2 class="text-lg">Rechnung</h2>
		<div class="mt-3 grid grid-cols-2 gap-3">
			<label class="col-span-2 block">
				<span class="field-label">Art</span>
				<select class="select" name="rechnungsart" bind:value={head.kind} onchange={() => (kindTouched = true)}>
					<!-- Stornorechnungen entstehen nur beim Stornieren einer ausgestellten Rechnung -->
					{#each Object.entries(INVOICE_KIND_LABELS).filter(([value]) => value !== 'storno') as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
			</label>
			<label class="block">
				<span class="field-label">Rechnungsdatum *</span>
				<input class="input num" type="date" name="datum" required bind:value={head.date} oninput={onDate} />
			</label>
			<label class="block">
				<span class="field-label">Zahlbar bis *</span>
				<input class="input num" type="date" name="faellig" required bind:value={head.dueDate} oninput={() => (dueTouched = true)} />
			</label>
			<label class="block">
				<span class="field-label">Leistung von</span>
				<input class="input num" type="date" name="von" bind:value={head.serviceFrom} oninput={() => (periodTouched = true)} />
			</label>
			<label class="block">
				<span class="field-label">Leistung bis</span>
				<input class="input num" type="date" name="bis" bind:value={head.serviceTo} oninput={() => (periodTouched = true)} />
			</label>
			<label class="col-span-2 block">
				<span class="field-label">Bauvorhaben (BV)</span>
				<textarea class="textarea auto" name="titel" rows="1" maxlength="300" bind:value={head.title}></textarea>
			</label>
			<label class="col-span-2 block">
				<span class="field-label">Ausführungsort</span>
				<input class="input" name="ort" maxlength="300" bind:value={head.location} />
			</label>
			<label class="block">
				<span class="field-label">Bundesland <span class="text-ink-3">· Summenblatt</span></span>
				<input class="input" name="bundesland" maxlength="60" list="bundeslaender" bind:value={head.state} />
			</label>
			<label class="block">
				<span class="field-label">Abschnitt <span class="text-ink-3">· Summenblatt</span></span>
				<input class="input" name="abschnitt" maxlength="120" bind:value={head.section} />
			</label>
			<datalist id="bundeslaender">
				{#each ['Burgenland', 'Kärnten', 'Niederösterreich', 'Oberösterreich', 'Salzburg', 'Steiermark', 'Tirol', 'Vorarlberg', 'Wien'] as b (b)}<option value={b}></option>{/each}
			</datalist>
			<label class="block">
				<span class="field-label">Kostenstelle</span>
				<input class="input num" name="kostenstelle" maxlength="30" bind:value={head.costCenter} />
				<span class="field-hint">Die Rechnungsnummer lautet dann „Nummer/Kostenstelle".</span>
			</label>
			<label class="block">
				<span class="field-label">Umsatzsteuer in %</span>
				<input class="input num" name="ust" inputmode="decimal" maxlength="6" required bind:value={head.vat} disabled={head.reverseCharge} />
				{#if head.reverseCharge}<input type="hidden" name="ust" value={head.vat} />{/if}
			</label>
			<label class="col-span-2 flex items-start gap-2.5 rounded-xl bg-surface-2 p-3">
				<input type="checkbox" class="mt-0.5 size-5 shrink-0 accent-[var(--c-ink)]" name="reverse" bind:checked={head.reverseCharge} />
				<span>
					<span class="block font-medium">Übergang der Steuerschuld (Reverse Charge)</span>
					<span class="block text-[0.8125rem] text-ink-3">Bauleistung an ein Bauunternehmen – ohne Umsatzsteuer, mit Hinweis und UID des Kunden: „{REVERSE_CHARGE_NOTE}"</span>
				</span>
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

<section class="card mt-4 p-4 lg:p-5">
	<h2 class="text-lg">Positionen</h2>
	<p class="mt-1 text-sm text-ink-2">Positionen ohne Menge kommen nicht auf die Rechnung, Überschriften nur, wenn darunter etwas steht.</p>
	<div class="mt-3 hidden gap-2 text-[0.8125rem] text-ink-3 xl:grid xl:grid-cols-[2.5rem_minmax(0,1fr)_6rem_6.5rem_7rem_7rem_2.25rem]">
		<span>Nr.</span><span>Bezeichnung</span><span class="text-right">Menge</span><span>Einheit</span><span class="text-right">EP in €</span><span class="text-right">GP</span><span></span>
	</div>
	<ul class="mt-1 divide-y divide-line">
		{#each lines as l, i (l.key)}
			{@const empty = l.kind === 'position' && !parsed[i].quantity}
			<li class="py-2.5 {empty ? 'opacity-60 focus-within:opacity-100' : ''}">
				<input type="hidden" name="z.{i}.art" value={l.kind} />
				<input type="hidden" name="z.{i}.nr" value={l.number} />
				{#if l.kind === 'titel'}
					<div class="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
						<span class="num font-semibold">{l.number}</span>
						<input class="input font-semibold" name="z.{i}.text" maxlength="300" bind:value={l.text} aria-label="Überschrift Zeile {i + 1}" />
					</div>
				{:else}
					<div class="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 xl:grid-cols-[2.5rem_minmax(0,1fr)_6rem_6.5rem_7rem_7rem_2.25rem] xl:items-start">
						<span class="num pt-2 text-sm">{l.number}</span>
						<div class="min-w-0">
							<textarea class="textarea auto min-h-10 py-2 font-medium" name="z.{i}.text" rows="1" maxlength="4000" bind:value={l.text} aria-label="Bezeichnung Zeile {i + 1}"></textarea>
							<!-- Bemerkung: steht im PDF unter der Bezeichnung, nicht fett -->
							<textarea
								class="textarea auto mt-1.5 min-h-8 py-1.5 text-sm"
								name="z.{i}.notiz"
								rows="1"
								maxlength="2000"
								placeholder="Bemerkung (optional)"
								bind:value={l.note}
								aria-label="Bemerkung Zeile {i + 1}"
							></textarea>
							{#if l.source || l.offerQuantity != null}
								<p class="mt-1 text-[0.75rem] text-ink-3">
									{[l.source && `Menge aus ${l.source}`, l.offerQuantity != null && `lt. Angebot ${quantityLabel(l.offerQuantity)} ${l.unit}`].filter(Boolean).join(' · ')}
									{#if l.columnKey}
										· <span class={parsed[i].unitPrice == null ? 'font-medium text-warn' : ''}>nicht im Auftrag{parsed[i].unitPrice == null ? ' – bitte Einheitspreis eintragen' : ''}</span>
									{/if}
								</p>
							{/if}
						</div>
						<button type="button" class="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-danger xl:hidden" aria-label="Zeile {i + 1} entfernen" onclick={() => removeLine(l.key)}>
							<X size={16} />
						</button>
						<div class="col-span-3 grid grid-cols-4 gap-2 xl:contents">
							<label class="block">
								<span class="field-label xl:sr-only">Menge</span>
								<input class="input num text-right" name="z.{i}.menge" inputmode="decimal" maxlength="14" bind:value={l.quantity} />
							</label>
							<label class="block">
								<span class="field-label xl:sr-only">Einheit</span>
								<input class="input" name="z.{i}.einheit" maxlength="20" list="rechnung-einheiten" bind:value={l.unit} />
							</label>
							<label class="block">
								<span class="field-label xl:sr-only">EP in €</span>
								<input class="input num text-right" name="z.{i}.preis" inputmode="decimal" maxlength="14" bind:value={l.price} />
							</label>
							<div class="block">
								<span class="field-label xl:sr-only">GP</span>
								<p class="num py-2 text-right font-medium">{money(lineTotal(parsed[i])) || '–'}</p>
							</div>
						</div>
						<button type="button" class="hidden size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-danger xl:grid" aria-label="Zeile {i + 1} entfernen" onclick={() => removeLine(l.key)}>
							<X size={16} />
						</button>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
	<datalist id="rechnung-einheiten">{#each units as u (u)}<option value={u}></option>{/each}</datalist>
	<button type="button" class="btn btn-secondary btn-sm mt-3" onclick={addLine}><Plus size={16} aria-hidden="true" />Position</button>

	<dl class="num mt-4 ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 border-t border-line pt-3">
		<dt>Gesamt Netto</dt>
		<dd class="text-right">{money(totals.net)}</dd>
		{#if !head.reverseCharge}
			<dt>{head.vat || '0'} % Umsatzsteuer</dt>
			<dd class="text-right">{money(totals.vat)}</dd>
		{/if}
		<dt class="border-t border-ink pt-1.5 text-lg font-semibold">Gesamtbetrag</dt>
		<dd class="border-t border-ink pt-1.5 text-right text-lg font-semibold">{money(totals.gross)}</dd>
	</dl>
</section>

<section class="card mt-4 p-4 lg:p-5">
	<label class="block">
		<span class="field-label">Schlusstext</span>
		<textarea class="textarea auto" name="schluss" rows="2" maxlength="5000" bind:value={head.closing}></textarea>
	</label>
	<p class="mt-2 text-[0.8125rem] text-ink-3">Darüber steht auf der Rechnung „Zahlbar bis … ohne Abzug"; die Bankverbindung steht in der Fußzeile.</p>
</section>

<div class="card sticky bottom-24 mt-4 flex flex-wrap items-center gap-3 p-3 lg:bottom-6">
	<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : submitLabel}</button>
	<span class="num text-sm text-ink-2">Gesamtbetrag {money(totals.gross)}</span>
	{#if message}<p class="w-full text-sm text-danger" role="alert">{message}</p>{/if}
</div>
