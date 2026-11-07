<script lang="ts" module>
	export interface EditorHead {
		/** Rechnungsnummer – von Hand, nicht die des Auftrags */
		number: string;
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
		/** Eigener Text dieser Rechnung, unter der Einleitung */
		extraText: string;
		closing: string;
		vatRate: number;
		reverseCharge: boolean;
		skontoPercent: number;
		skontoDays: number;
		discountPercent: number;
		discountAmount: number;
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
		/** Im Angebot eine Alternativposition – kommt nur mit Menge auf die Rechnung */
		alternative?: boolean;
		/** Gespeicherte Zeile: ID und feste Kennung (fürs gleichzeitige Bearbeiten) */
		id?: number;
		uid?: string | null;
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
	import Plus from '@lucide/svelte/icons/plus';
	import Heading from '@lucide/svelte/icons/heading';
	import { tick, untrack, type Snippet } from 'svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { addDays, daysBetween, isValidIsoDate } from '$lib/modules/stunden/week';
	import { date as dateLabel } from '$lib/format';
	import TaxSelect from './TaxSelect.svelte';
	import PaymentTermsFields from './PaymentTermsFields.svelte';
	import DiscountRow from './DiscountRow.svelte';
	import { reportDateLabel } from '$lib/modules/tagesberichte/sheet';
	import {
		amountInput,
		discountFrom,
		discountInput,
		INVOICE_KIND_LABELS,
		invoiceTotals,
		lineTotal,
		MAX_OFFER_LINES,
		money,
		moveItem,
		nextLineNumber,
		parseAmount,
		quantityLabel,
		spacedNumber,
		vatLabel
	} from '../offer';
	import LineTools from './LineTools.svelte';
	import RichTextarea from '$lib/components/RichTextarea.svelte';
	import { applyRows, assignFields, LiveDoc } from '$lib/livedoc.svelte';
	import { newUid } from '$lib/merge';
	import type { Autosave } from '$lib/autosave.svelte';
	import { dropzone, type DragItem } from '$lib/dnd';
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
		/** Zahlungsziel einer neuen Rechnung – eine bestehende hat ihres über „zahlbar bis" */
		paymentDays: number;
		/** Vorschläge für die Einheit – aus den Stammdaten; frei eintippen geht weiter */
		units?: string[];
		/** Nur bei einer neuen Rechnung: Spalten aus den Tagesberichten und die Angebotspositionen; `legacy`: Zählung 1.1, 1.2 … */
		mapping?: { columns: SummaryColumn[]; priced: PricedLine[]; initial: Mapping; legacy?: boolean } | null;
		/** Nur bei einer neuen Rechnung: die Berichte zur Wahl und was es zum Auftrag schon gibt */
		selection?: { reports: SummaryReport[]; pending: number; previous: number; closed: boolean; flatBilled: number[] } | null;
		/** Nur bei einer neuen Rechnung: die zuletzt vergebene Nummer, als Hilfe für die nächste */
		lastNumber?: string | null;
		busy?: boolean;
		submitLabel: string;
		message?: string;
		/** Etwas wurde geändert – fürs automatische Speichern */
		onchange?: () => void;
		/** Neben dem Knopf: Stand des automatischen Speicherns */
		status?: Snippet;
		/**
		 * Gemeinsam bearbeiten (bestehender Entwurf): der Stand vom Server, wie er
		 * gerade geladen ist – fremde Änderungen kommen damit ins Formular.
		 */
		live?: { source: () => { head: EditorHead; lines: EditorLine[] }; saver: Autosave } | null;
		/** Für die Anzeige „Änderung von … übernommen" */
		doc?: { lastRemote: { by: string; at: Date } | null } | null;
	}
	let {
		head: initialHead,
		lines: initialLines,
		paymentDays,
		units = [],
		mapping = null,
		selection = null,
		lastNumber = null,
		busy = false,
		submitLabel,
		message = '',
		onchange,
		status,
		live = null,
		doc = $bindable(null)
	}: Props = $props();

	type Line = {
		key: number;
		uid: string;
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
		alternative: boolean;
	};

	let nextKey = 1;
	const qtyInput = (v: number | null) => (v == null ? '' : String(v).replace('.', ','));
	/** Der Kopf, wie er im Formular steht */
	const headState = (h: EditorHead) => ({
		...h,
		vat: String(h.vatRate).replace('.', ','),
		// Zahlungsziel in Tagen – bei einer bestehenden Rechnung aus „zahlbar bis"
		days: String(isValidIsoDate(h.dueDate) && isValidIsoDate(h.date) ? Math.max(0, daysBetween(h.date, h.dueDate)) : paymentDays),
		skonto: h.skontoPercent ? String(h.skontoPercent).replace('.', ',') : '',
		skontoDays: h.skontoDays ? String(h.skontoDays) : '',
		discount: discountInput(h).value,
		discountKind: discountInput(h).kind
	});
	// Die Vorgaben werden beim Öffnen übernommen – danach gehört der Stand dem Formular (fremde Änderungen führt LiveDoc ein)
	// svelte-ignore state_referenced_locally
	let head = $state(headState(initialHead));
	// svelte-ignore state_referenced_locally
	const toLine = (l: EditorLine | InvoiceLineDraft): Line => ({
		key: nextKey++,
		// Gespeicherte Zeilen ohne Kennung: aus der ID – für alle gleich
		uid: ('uid' in l && l.uid) || ('id' in l && l.id ? `p${l.id}` : newUid()),
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
		ownTitle: !!l.ownTitle,
		alternative: !!l.alternative
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
	/** Art und Leistungszeitraum folgen der Auswahl der Berichte, bis jemand sie selbst ändert */
	let kindTouched = $state(false);
	let periodTouched = $state(false);
	// Gemeinsam bearbeiten: fremde Änderungen Feld für Feld, Zeile für Zeile ins Formular
	type LineModel = Omit<Line, 'key'>;
	const lineModel = ({ key: _key, ...l }: Line): LineModel => l;
	// svelte-ignore state_referenced_locally
	const liveDoc = live
		? new LiveDoc({
				read: () => {
					const s = live.source();
					return { head: headState(s.head), lines: s.lines.map(toLine).map(lineModel) };
				},
				get: () => ({ head: { ...head }, lines: lines.map(lineModel) }),
				set: (m) => {
					assignFields(head, m.head);
					const next = applyRows(lines, m.lines, (r) => ({ ...r, key: nextKey++ }), (t, r) => assignFields(t, r));
					if (next) lines = next;
				},
				saver: live.saver
			})
		: null;
	// svelte-ignore state_referenced_locally
	doc = liveDoc;
	// Jede Änderung melden – die Seite speichert dann von selbst
	let watching = false;
	$effect(() => {
		JSON.stringify(head);
		JSON.stringify(lines);
		// Mit LiveDoc zählt, ob etwas vom Server abweicht – sonst jede Änderung nach dem Öffnen
		if (liveDoc) {
			untrack(() => {
				if (liveDoc.dirty()) onchange?.();
			});
			return;
		}
		if (!watching) {
			watching = true;
			return;
		}
		untrack(() => onchange?.());
	});
	// svelte-ignore state_referenced_locally
	let picked = $state<Record<number, boolean>>(Object.fromEntries((selection?.reports ?? []).map((r) => [r.id, true])));
	const chosen = $derived(new Set((selection?.reports ?? []).filter((r) => picked[r.id]).map((r) => r.id)));
	/** Spalten mit den Summen der gewählten Berichte */
	const columns = $derived(mapping ? (selection ? selectedColumns(mapping.columns, selection.reports, chosen) : mapping.columns) : []);

	const parsed = $derived(lines.map((l) => ({ kind: l.kind, quantity: parseAmount(l.quantity), unitPrice: parseAmount(l.price) })));
	const totals = $derived(invoiceTotals(parsed, parseAmount(head.vat) ?? 0, head.reverseCharge, discountFrom(head.discount, head.discountKind)));
	const openColumns = $derived(columns.filter((c) => !assigned[c.key]).length);

	/** „Zahlbar bis" und „Skonto bis" folgen Rechnungsdatum und Zahlungsbedingungen */
	const dates = $derived.by(() => {
		if (!isValidIsoDate(head.date)) return null;
		const at = (d: string) => dateLabel(addDays(head.date, Math.max(0, Math.trunc(Number(d) || 0))));
		return { due: at(head.days), skonto: at(head.skontoDays) };
	});

	/**
	 * Mengen neu: bei geänderter Zuordnung nur die betroffenen Positionen, bei
	 * geänderter Auswahl der Berichte alle, deren Menge aus den Berichten kommt.
	 */
	function remap(all = false) {
		if (!mapping) return;
		const current: Mapping = {};
		for (const [k, v] of Object.entries(assigned)) current[k] = v === 'nein' ? null : v === OWN_LINE ? OWN_LINE : v ? Number(v) : undefined;
		const all_ = invoiceLines(mapping.priced, columns, current, selection?.flatBilled, mapping.legacy);
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

	/**
	 * Nummer für eine neue Zeile nach `prev`: unter einer Überschrift „2" → „2.1",
	 * sonst die nächste („2.1" → „2.2", „3" → „4"); eine Überschrift bekommt die
	 * nächste ganze Nummer. Bleibt änderbar.
	 */
	function suggestNumber(prev: Line | undefined, kind: 'position' | 'titel'): string {
		if (!prev) return '1';
		if (kind === 'titel') {
			const top = Number(prev.number.split('.')[0]);
			return Number.isInteger(top) && top > 0 ? String(top + 1) : '';
		}
		return prev.kind === 'titel' && prev.number ? `${prev.number}.1` : nextLineNumber(prev.number);
	}
	const blank = (kind: 'position' | 'titel', number: string): Line => ({
		key: nextKey++,
		uid: newUid(),
		number,
		kind,
		text: '',
		note: '',
		quantity: '',
		unit: '',
		price: '',
		offerLineId: null,
		offerQuantity: null,
		source: '',
		columnKey: null,
		ownTitle: false,
		alternative: false
	});
	async function insertLine(at: number, kind: 'position' | 'titel') {
		if (lines.length >= MAX_OFFER_LINES) return;
		lines.splice(at, 0, blank(kind, suggestNumber(lines[at - 1], kind)));
		await tick();
		document.querySelector<HTMLElement>(`[data-rechnung-zeile="${at}"]`)?.focus();
	}
	const addLine = (kind: 'position' | 'titel' = 'position') => insertLine(lines.length, kind);
	/** Kopie direkt darunter – ohne Bezug zum Angebot und zu den Berichten, die gehören zum Original */
	function copyLine(i: number) {
		if (lines.length >= MAX_OFFER_LINES) return;
		const l = lines[i];
		lines.splice(i + 1, 0, { ...l, key: nextKey++, uid: newUid(), number: nextLineNumber(l.number), offerLineId: null, offerQuantity: null, source: '', columnKey: null, ownTitle: false });
	}
	function removeLine(key: number) {
		lines = lines.filter((l) => l.key !== key);
	}
	function moveLine(i: number, by: -1 | 1) {
		const j = i + by;
		if (j >= 0 && j < lines.length) lines = moveItem(lines, i, j);
	}
	const dropOn = (i: number) => (item: DragItem, at: { y: number; zone: Element }) => {
		const from = lines.findIndex((l) => l.key === item.data);
		if (from < 0) return;
		const rect = at.zone.getBoundingClientRect();
		let to = at.y > rect.top + rect.height / 2 ? i + 1 : i;
		if (from < to) to--;
		lines = moveItem(lines, from, to);
	};

	const positionLabel = (p: PricedLine, nr: string) => `${nr} ${p.text.split('\n')[0].slice(0, 60)}${p.unit ? ` (${p.unit})` : ''}${p.alternative ? ' – Alternativposition' : ''}`;
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
			<label class="block">
				<span class="field-label">Rechnungsnummer *</span>
				<input class="input num" name="nummer" required maxlength="40" autocomplete="off" bind:value={head.number} />
				{#if lastNumber}<span class="field-hint">Zuletzt vergeben: <span class="num">{spacedNumber(lastNumber)}</span></span>{/if}
			</label>
			<label class="block">
				<span class="field-label">Art</span>
				<select class="select" name="rechnungsart" bind:value={head.kind} onchange={() => (kindTouched = true)}>
					<!-- Stornorechnungen entstehen nur beim Stornieren einer ausgestellten Rechnung -->
					{#each Object.entries(INVOICE_KIND_LABELS).filter(([value]) => value !== 'storno') as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
			</label>
			<label class="block">
				<span class="field-label">Rechnungsdatum *</span>
				<input class="input num" type="date" name="datum" required bind:value={head.date} />
			</label>
			<div class="block">
				<span class="field-label">Zahlbar bis</span>
				<p class="num py-2 font-medium">{dates?.due ?? '–'}</p>
				<span class="field-hint">Aus dem Zahlungsziel – unten bei den Zahlungsbedingungen.</span>
			</div>
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
			<TaxSelect bind:vat={head.vat} bind:reverse={head.reverseCharge} class="col-span-2" />
		</div>
	</section>
</div>

<section class="card mt-4 grid gap-4 p-4 lg:p-5">
	<label class="block">
		<span class="field-label">Einleitung</span>
		<textarea class="textarea auto" name="einleitung" rows="2" maxlength="3000" bind:value={head.intro}></textarea>
	</label>
	<RichTextarea name="zusatztext" label="Text zu dieser Rechnung" rows={2} maxlength={5000} placeholder="Steht unter der Einleitung – etwa ein Hinweis nur für diese Rechnung" bind:value={head.extraText} />
</section>

<section class="card mt-4 p-4 lg:p-5">
	<h2 class="text-lg">Positionen</h2>
	<p class="mt-1 text-sm text-ink-2">Positionen ohne Menge kommen nicht auf die Rechnung, Überschriften nur, wenn darunter etwas steht.</p>
	<div class="mt-3 hidden gap-2 text-[0.8125rem] text-ink-3 xl:grid xl:grid-cols-[3.75rem_minmax(0,1fr)_6rem_6.5rem_7rem_7rem_9.5rem]">
		<span>Nr.</span><span>Bezeichnung</span><span class="text-right">Menge</span><span>Einheit</span><span class="text-right">EP in €</span><span class="text-right">GP</span><span></span>
	</div>
	<ul class="mt-1 divide-y divide-line">
		{#each lines as l, i (l.key)}
			{@const empty = l.kind === 'position' && !parsed[i].quantity}
			<li
				class={l.kind === 'titel' ? 'heading-row' : `py-2.5 ${empty ? 'opacity-60 focus-within:opacity-100' : ''}`}
				use:dropzone={{ accepts: ['rechnung-zeile'], onDrop: dropOn(i) }}
			>
				<input type="hidden" name="z.{i}.art" value={l.kind} />
				<input type="hidden" name="z.{i}.uid" value={l.uid} />
				{#if l.kind === 'titel'}
					<div class="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-2">
						<input class="input num px-2 font-bold" name="z.{i}.nr" maxlength="12" bind:value={l.number} aria-label="Nummer Zeile {i + 1}" />
						<input class="input text-[1.0625rem] font-bold" name="z.{i}.text" maxlength="300" data-rechnung-zeile={i} bind:value={l.text} aria-label="Überschrift Zeile {i + 1}" />
						{@render tools(i, l.key)}
					</div>
				{:else}
					<div class="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] gap-2 xl:grid-cols-[3.75rem_minmax(0,1fr)_6rem_6.5rem_7rem_7rem_9.5rem] xl:items-start">
						<input class="input num px-2 text-sm" name="z.{i}.nr" maxlength="12" bind:value={l.number} aria-label="Nummer Zeile {i + 1}" />
						<div class="min-w-0">
							<textarea
								class="textarea auto min-h-10 py-2 font-medium"
								name="z.{i}.text"
								rows="1"
								maxlength="4000"
								data-rechnung-zeile={i}
								bind:value={l.text}
								aria-label="Bezeichnung Zeile {i + 1}"
							></textarea>
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
									{[
									l.source && `Menge aus ${l.source}`,
									l.offerQuantity != null && `lt. Angebot ${quantityLabel(l.offerQuantity)} ${l.unit}`,
									l.alternative && 'im Angebot Alternativposition'
								]
									.filter(Boolean)
									.join(' · ')}
									{#if l.columnKey}
										· <span class={parsed[i].unitPrice == null ? 'font-medium text-warn' : ''}>nicht im Auftrag{parsed[i].unitPrice == null ? ' – bitte Einheitspreis eintragen' : ''}</span>
									{/if}
								</p>
							{/if}
						</div>
						<div class="xl:hidden">{@render tools(i, l.key)}</div>
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
						<div class="hidden xl:block">{@render tools(i, l.key)}</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
	<datalist id="rechnung-einheiten">{#each units as u (u)}<option value={u}></option>{/each}</datalist>
	<div class="mt-3 flex flex-wrap gap-2">
		<button type="button" class="btn btn-secondary btn-sm" disabled={lines.length >= MAX_OFFER_LINES} onclick={() => addLine('position')}><Plus size={16} aria-hidden="true" />Position</button>
		<button type="button" class="btn btn-ghost btn-sm" disabled={lines.length >= MAX_OFFER_LINES} onclick={() => addLine('titel')}><Heading size={16} aria-hidden="true" />Überschrift</button>
	</div>

	<dl class="num mt-4 ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 border-t border-line pt-3">
		<dt>Gesamt Netto</dt>
		<dd class="text-right">{money(totals.net)}</dd>
		<DiscountRow bind:value={head.discount} bind:kind={head.discountKind} discount={totals.discount} taxable={totals.taxable} />
		{#if !head.reverseCharge}
			<dt>{vatLabel(parseAmount(head.vat) ?? 0, false)}</dt>
			<dd class="text-right">{money(totals.vat)}</dd>
		{/if}
		<dt class="border-t border-ink pt-1.5 text-lg font-semibold">Gesamtbetrag</dt>
		<dd class="border-t border-ink pt-1.5 text-right text-lg font-semibold">{money(totals.gross)}</dd>
	</dl>
	{#if head.reverseCharge}<p class="mt-2 text-right text-sm text-ink-2">Ohne Umsatzsteuer – Übergang der Steuerschuld (§ 19 Abs. 1a UStG).</p>{/if}
</section>

<PaymentTermsFields bind:days={head.days} bind:percent={head.skonto} bind:skontoDays={head.skontoDays} gross={totals.gross} {dates} />

<section class="card mt-4 p-4 lg:p-5">
	<RichTextarea name="schluss" label="Schlusstext" rows={2} maxlength={5000} bind:value={head.closing} />
	<p class="mt-2 text-[0.8125rem] text-ink-3">Darüber stehen auf der Rechnung die Zahlungsbedingungen; die Bankverbindung steht in der Fußzeile.</p>
</section>

<div class="card lg:sticky mt-4 flex flex-wrap items-center gap-3 p-3 lg:bottom-6">
	<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : submitLabel}</button>
	{@render status?.()}
	<span class="num text-sm text-ink-2">Gesamtbetrag {money(totals.gross)}</span>
	{#if message}<p class="w-full text-sm text-danger" role="alert">{message}</p>{/if}
</div>

{#snippet tools(i: number, key: number)}
	<LineTools
		index={i}
		count={lines.length}
		dragKind="rechnung-zeile"
		dragKey={key}
		canAdd={lines.length < MAX_OFFER_LINES}
		onmove={(by) => moveLine(i, by)}
		oninsert={(kind) => insertLine(i + 1, kind)}
		oncopy={() => copyLine(i)}
		onremove={() => removeLine(key)}
	/>
{/snippet}
