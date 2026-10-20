<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import FileText from '@lucide/svelte/icons/file-text';
	import Printer from '@lucide/svelte/icons/printer';
	import Hammer from '@lucide/svelte/icons/hammer';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Undo from '@lucide/svelte/icons/undo-2';
	import Phone from '@lucide/svelte/icons/phone';
	import FilePen from '@lucide/svelte/icons/file-pen-line';
	import Trash from '@lucide/svelte/icons/trash';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Sigma from '@lucide/svelte/icons/sigma';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Lock from '@lucide/svelte/icons/lock';
	import { reportDateLabel } from '$lib/modules/tagesberichte/sheet';
	import { rangeLabel } from '$lib/modules/planung/days';
	import Dialog from '$lib/components/Dialog.svelte';
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';
	import CaseDocuments from '$lib/modules/auftraege/components/CaseDocuments.svelte';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import { date, dateTime } from '$lib/format';
	import { INVOICE_STAGE_LABELS } from '$lib/modules/auftraege/signature';
	import { invoiceNo, addressLines, INVOICE_STATUS_LABELS, invoiceLabel, lineNumbers, money, ORDER_STATUS_LABELS, quantityLabel, spacedNumber } from '$lib/modules/auftraege/offer';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();
	const order = $derived(data.order);
	const st = $derived(ORDER_STATUS_LABELS[order.status] ?? ORDER_STATUS_LABELS.erstellt);
	const numbers = $derived(lineNumbers(order.lines));
	const statusBy = $derived([order.statusByFirst, order.statusByLast].filter(Boolean).join(' '));

	let busy = $state(false);
	let deleteOpen = $state(false);
	let resetOpen = $state(false);

	/** Ausführungsort in der Karten-App öffnen – am Handy gleich mit Navigation */
	const mapUrl = $derived(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.location)}`);
	const REPORT_STATUS: Record<string, { label: string; tone: string }> = {
		entwurf: { label: 'In Arbeit', tone: '' },
		freigegeben: { label: 'Freigegeben', tone: 'badge-info' },
		geprueft: { label: 'Geprüft', tone: 'badge-warn' },
		abgeschlossen: { label: 'Abgeschlossen', tone: 'badge-ok' }
	};

	const STEP_DONE: Record<string, string> = { in_arbeit: 'Auftrag ist in Arbeit', abgeschlossen: 'Auftrag abgeschlossen', erstellt: 'Zurück auf „Auftrag erstellt"' };
	const statusEnhance = () => {
		busy = true;
		return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: () => Promise<void> }) => {
			busy = false;
			resetOpen = false;
			if (result.type === 'success') toast.success(STEP_DONE[String(result.data?.status)] ?? 'Gespeichert');
			await update();
		};
	};
</script>

<svelte:head><title>{pageTitle(`Auftrag ${spacedNumber(order.number)}`)}</title></svelte:head>

<a href="/auftraege" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Aufträge
</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">Auftrag {spacedNumber(order.number)}</h1>
		<p class="text-ink-2">{order.title || 'Ohne BV'}</p>
		{#if order.location}
			<a href={mapUrl} target="_blank" rel="noopener" class="mt-1 inline-flex items-start gap-1.5 font-medium underline-offset-2 hover:underline">
				<MapPin size={17} class="mt-0.5 shrink-0" aria-hidden="true" />{order.location}
			</a>
		{/if}
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<span class="badge {st.tone}">{#if order.status === 'abgeschlossen'}<CircleCheck size={13} aria-hidden="true" />{/if}{st.label}</span>
		<PdfButton href="/auftraege/{order.id}/pdf"><FileText size={18} aria-hidden="true" />PDF</PdfButton>
		<a href="/auftraege/{order.id}/druck" class="btn btn-secondary"><Printer size={18} aria-hidden="true" />Drucken</a>
	</div>
</div>

{#if form && 'message' in form && form.message}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>{/if}

{#if data.canStatus && order.status !== 'abgeschlossen'}
	<!-- Der Stand der Arbeiten – groß, damit es auf der Baustelle mit einem Tipp geht -->
	<form method="POST" action="?/status" class="card mb-4 flex flex-wrap items-center gap-3 p-4" use:enhance={statusEnhance}>
		<p class="min-w-[12rem] flex-1 text-ink-2">
			{order.status === 'erstellt' ? 'Sobald ihr anfangt, auf „In Arbeit" setzen.' : 'Fertig? Dann auf „Abgeschlossen" setzen.'}
			{#if data.closeBlocker}
				<span class="mt-1 block text-sm text-warn">{data.closeBlocker} <a href="/auftraege/{order.id}/arbeitsauftrag#checkliste" class="font-medium underline">Zur Checkliste</a></span>
			{/if}
		</p>
		{#if order.status === 'erstellt'}
			<button class="btn btn-primary" name="status" value="in_arbeit" disabled={busy}><Hammer size={18} aria-hidden="true" />In Arbeit</button>
		{/if}
		<button class="btn {order.status === 'in_arbeit' ? 'btn-primary' : 'btn-secondary'}" name="status" value="abgeschlossen" disabled={busy || !!data.closeBlocker}>
			<CircleCheck size={18} aria-hidden="true" />Abgeschlossen
		</button>
	</form>
{/if}

{#if order.statusAt}
	<p class="mb-4 text-sm text-ink-3">Stand zuletzt gesetzt{statusBy ? ` von ${statusBy}` : ''} am {dateTime(order.statusAt)}.</p>
{/if}

<div class="grid gap-4 lg:grid-cols-2">
	<section class="card p-4 lg:p-5">
		<h2 class="text-lg">Kunde</h2>
		<p class="mt-2 leading-relaxed">
			{#each addressLines({ name: order.customerName, addition: order.customerAddition, street: order.customerStreet, zip: order.customerZip, city: order.customerCity }) as l, i (i)}
				<span class="block {i === 0 ? 'font-medium' : ''}">{l}</span>
			{/each}
		</p>
		{#if order.customerContact || order.customerPhone}
			<p class="mt-3 text-sm">
				{#if order.customerContact}<span class="block">Ansprechpartner: {order.customerContact}</span>{/if}
				{#if order.customerPhone}
					<a href="tel:{order.customerPhone.replace(/[^\d+]/g, '')}" class="mt-1 inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline">
						<Phone size={15} aria-hidden="true" />{order.customerPhone}
					</a>
				{/if}
			</p>
		{/if}
	</section>

	<section class="card p-4 lg:p-5">
		<h2 class="text-lg">Auftrag</h2>
		<dl class="mt-2 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
			<dt class="text-ink-3">Auftragsnummer</dt>
			<dd class="num">{order.number}</dd>
			<dt class="text-ink-3">Partie</dt>
			<dd>{order.partyName ?? 'Nicht zugeteilt'}</dd>
			<dt class="text-ink-3">Erstellt</dt>
			<dd>{dateTime(order.createdAt)}{order.creatorFirst || order.creatorLast ? ` · ${[order.creatorFirst, order.creatorLast].filter(Boolean).join(' ')}` : ''}</dd>
		</dl>
		{#if data.canSeeOffer}
			<a href="/angebote/{order.offerId}" class="btn btn-ghost btn-sm mt-3"><FilePen size={16} aria-hidden="true" />Zum Angebot</a>
		{/if}
	</section>
</div>

{#if order.note.trim()}
	<section class="card mt-4 border-warn/50 p-4 lg:p-5">
		<h2 class="text-lg">Hinweis für die Partie</h2>
		<p class="mt-2 whitespace-pre-line">{order.note}</p>
	</section>
{/if}

{#if data.workOrder || data.canManage}
	<!-- Arbeitsauftrag nach dem Vordruck: das Büro legt ihn an, die Partie füllt ihn auf der Baustelle aus -->
	<section class="card mt-4 flex flex-wrap items-center gap-3 p-4 lg:p-5">
		<ClipboardList size={22} class="shrink-0 text-ink-3" aria-hidden="true" />
		<div class="min-w-[12rem] flex-1">
			<h2 class="text-lg">Arbeitsauftrag</h2>
			<p class="text-sm text-ink-2">
				{#if data.workOrder?.customerSigned}
					<Lock size={13} class="mr-1 inline align-[-1px]" aria-hidden="true" />Vom Auftraggeber unterschrieben am {dateTime(data.workOrder.customerSigned)}
				{:else if data.workOrder}
					Zuletzt geändert {dateTime(data.workOrder.updatedAt)}
				{:else}
					Formular für die Baustelle. Die Partie sieht den Auftrag erst, wenn es ihn gibt – und dann nur den Arbeitsauftrag.
				{/if}
			</p>
		</div>
		{#if data.workOrder}
			<PdfButton href="/auftraege/{order.id}/arbeitsauftrag/pdf" class="btn btn-secondary btn-sm"><FileText size={16} aria-hidden="true" />PDF</PdfButton>
			<a href="/auftraege/{order.id}/arbeitsauftrag/druck" class="btn btn-secondary btn-sm"><Printer size={16} aria-hidden="true" />Drucken</a>
			<a href="/auftraege/{order.id}/arbeitsauftrag" class="btn btn-primary btn-sm">Öffnen<ChevronRight size={16} aria-hidden="true" /></a>
		{:else}
			<a href="/auftraege/{order.id}/arbeitsauftrag/neu" class="btn btn-primary btn-sm"><Plus size={16} aria-hidden="true" />Arbeitsauftrag erstellen</a>
		{/if}
	</section>
{/if}

<section class="card mt-4 overflow-hidden">
	<h2 class="px-4 pt-4 text-lg lg:px-5">Positionen</h2>
	<ul class="mt-2 divide-y divide-line">
		{#each order.lines as l, i (l.id)}
			{#if l.kind === 'titel'}
				<li class="bg-surface-2 px-4 py-2 font-semibold lg:px-5"><span class="num mr-2">{numbers[i]}</span>{l.text}</li>
			{:else}
				<li class="flex items-start gap-3 px-4 py-3 lg:px-5">
					<span class="num w-9 shrink-0 text-sm text-ink-3">{numbers[i]}</span>
					<span class="min-w-0 flex-1">
						<span class="block font-medium whitespace-pre-line">{l.text}</span>
						{#if l.note}<span class="mt-0.5 block text-sm whitespace-pre-line text-ink-2">{l.note}</span>{/if}
					</span>
					<span class="num shrink-0 text-right">{quantityLabel(l.quantity)} <span class="text-ink-3">{l.unit}</span></span>
				</li>
			{/if}
		{:else}
			<li class="px-4 py-3 text-ink-3">Keine Positionen.</li>
		{/each}
	</ul>
</section>

<div class="grid gap-x-4 xl:grid-cols-2">
	<CaseDocuments
		documents={data.documents}
		here="auftrag"
		hrefBase="/auftraege/{order.id}/unterlagen"
		canManage={data.canManage}
		message={form && 'docError' in form ? String(form.docError ?? '') : ''}
	/>
	<PhotoGallery
		base="/auftraege/{order.id}/fotos"
		photos={data.photos}
		editable={data.canManage}
		hint="Gehören zum ganzen Vorgang – an Anfrage, Angebot und Auftrag stehen dieselben. Die Partie sieht sie beim Arbeitsauftrag."
		empty="Noch keine Fotos – z. B. vom Besichtigungstermin."
	/>
</div>

<section class="card mt-4 p-4 lg:p-5">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="flex items-center gap-2 text-lg"><NotebookPen size={18} aria-hidden="true" />Tagesberichte</h2>
		<div class="flex flex-wrap gap-2">
			{#if data.reportCount >= 2}
				<a href="/auftraege/{order.id}/summenblatt" class="btn btn-secondary btn-sm"><Sigma size={16} aria-hidden="true" />Summenblatt</a>
			{/if}
			{#if data.canCreateReport}
				<a href="/tagesberichte?auftrag={order.id}" class="btn btn-secondary btn-sm"><Plus size={16} aria-hidden="true" />Neuer Tagesbericht</a>
			{/if}
		</div>
	</div>
	{#if data.reports.length}
		<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
			{#each data.reports as r (r.id)}
				{@const rs = REPORT_STATUS[r.status] ?? REPORT_STATUS.entwurf}
				<li>
					<a href="/tagesberichte/{r.id}" class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
						<span class="num w-14 shrink-0 font-semibold">{r.number || '–'}</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate">{reportDateLabel(r.date, r.dateTo)}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">{[r.site, r.partyName, r.dailyOutput, r.invoiceId && data.invoices.length ? 'abgerechnet' : ''].filter(Boolean).join(' · ')}</span>
						</span>
						<span class="badge {rs.tone}">{rs.label}</span>
						<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-ink-3">Noch kein Tagesbericht zu diesem Auftrag.</p>
	{/if}
</section>

{#if data.invoices.length || data.canCreateInvoice}
	<section class="card mt-4 p-4 lg:p-5">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="flex items-center gap-2 text-lg"><ReceiptText size={18} aria-hidden="true" />{data.invoices.length > 1 ? 'Rechnungen' : 'Rechnung'}</h2>
			{#if data.canCreateInvoice}
				<a href="/rechnungen/neu?auftrag={order.id}" class="btn btn-primary btn-sm">
					<Plus size={16} aria-hidden="true" />{data.invoices.length ? 'Weitere Rechnung' : order.status === 'abgeschlossen' ? 'Rechnung erstellen' : 'Teilrechnung erstellen'}
				</a>
			{/if}
		</div>
		{#if data.invoices.length}
			<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
				{#each data.invoices as i (i.id)}
					{@const st = INVOICE_STATUS_LABELS[i.status]}
					<li>
						<a href="/rechnungen/{i.id}" class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
							<span class="min-w-0 flex-1">
								<span class="block font-medium">{invoiceLabel(i.kind)} <span class="num">{invoiceNo(i)}</span></span>
								<span class="num block truncate text-[0.8125rem] text-ink-3">
									{date(i.date)}{i.reports ? ` · ${i.reports} ${i.reports === 1 ? 'Tagesbericht' : 'Tagesberichte'}` : ''}
								</span>
							</span>
							<span class="num hidden font-medium sm:block">{money(i.gross)}</span>
							{#if i.stage === 'entwurf' || i.stage === 'fehlgeschlagen' || i.stage === 'storniert' || i.stage === 'importiert'}
								<span class="badge {INVOICE_STAGE_LABELS[i.stage].tone}">{i.stage === 'fehlgeschlagen' ? 'Nicht signiert' : INVOICE_STAGE_LABELS[i.stage].label}</span>
							{/if}
							{#if st && i.stage !== 'storniert' && i.kind !== 'storno'}<span class="badge {st.tone}">{st.label}</span>{/if}
							<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
						</a>
					</li>
				{/each}
			</ul>
			{#if data.unbilled}
				<p class="mt-2 text-sm text-ink-2">
					{data.unbilled}
					{data.unbilled === 1 ? 'geprüfter Tagesbericht ist' : 'geprüfte Tagesberichte sind'} noch nicht abgerechnet.
				</p>
			{/if}
		{:else}
			<p class="mt-2 text-sm text-ink-2">
				{order.status === 'abgeschlossen'
					? 'Abgeschlossen – Preise aus dem Angebot, Mengen aus den Tagesberichten. Alles in einer Rechnung oder in Teilrechnungen.'
					: 'Noch in Arbeit – geprüfte Tagesberichte lassen sich schon als Teilrechnung abrechnen.'}
			</p>
		{/if}
	</section>
{/if}

{#if data.canManage}
	<section class="card mt-4 p-4 lg:p-5">
		<h2 class="text-lg">Partie, Ausführungsort und Hinweis</h2>
		<form
			method="POST"
			action="?/update"
			class="mt-3 space-y-3"
			use:enhance={() => async ({ result, update }) => {
				if (result.type === 'success') {
					// Mit der Partie steht der Termin aus dem Arbeitsauftrag jetzt in der Wochenplanung
					const p = result.data?.planned as { partyName: string; days: string[] } | null | undefined;
					toast.success('Gespeichert', p ? `In der Wochenplanung bei ${p.partyName}: ${rangeLabel(p.days[0], p.days[p.days.length - 1])}` : undefined);
				}
				await update({ reset: false });
			}}
		>
			<label class="block max-w-sm">
				<span class="field-label">Partie</span>
				<select class="select" name="partie" value={order.partyId ? String(order.partyId) : ''}>
					<option value="">Keine – nicht zugeteilt</option>
					{#each data.parties as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
				</select>
			</label>
			<label class="block">
				<span class="field-label">Ausführungsort</span>
				<input class="input" name="ort" maxlength="300" value={order.location} placeholder="z. B. Flughafen Wien, Werkstättenring Süd" />
			</label>
			<label class="block">
				<span class="field-label">Hinweis für die Partie</span>
				<textarea class="textarea" name="hinweis" rows="3" maxlength="2000" value={order.note}></textarea>
			</label>
			<button class="btn btn-secondary">Speichern</button>
		</form>
	</section>
{/if}

<div class="mt-4 flex flex-wrap gap-2">
	{#if data.canStatus && order.status === 'abgeschlossen'}
		<form method="POST" action="?/status" use:enhance={statusEnhance}>
			<button class="btn btn-ghost" name="status" value="in_arbeit" disabled={busy}><Undo size={18} aria-hidden="true" />Wieder in Arbeit</button>
		</form>
	{/if}
	{#if data.canReset && order.status !== 'erstellt'}
		<button type="button" class="btn btn-ghost" onclick={() => (resetOpen = true)}><Undo size={18} aria-hidden="true" />Zurück auf „Auftrag erstellt"</button>
	{/if}
	{#if data.canDelete}
		<button type="button" class="btn btn-ghost ml-auto text-danger hover:bg-danger-soft" onclick={() => (deleteOpen = true)}>
			<Trash size={18} aria-hidden="true" />Auftrag löschen
		</button>
	{/if}
</div>

<Dialog bind:open={resetOpen} title="Zurück auf „Auftrag erstellt“?">
	<p class="text-ink-2">Der Auftrag gilt dann wieder als nicht begonnen. Die Partie setzt ihn erneut auf „in Arbeit".</p>
	<form method="POST" action="?/status" class="mt-5 flex justify-end gap-2" use:enhance={statusEnhance}>
		<button type="button" class="btn btn-ghost" onclick={() => (resetOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary" name="status" value="erstellt">Zurücksetzen</button>
	</form>
</Dialog>


<Dialog bind:open={deleteOpen} title="Auftrag löschen?">
	<p class="text-ink-2">
		Der Auftrag {spacedNumber(order.number)} wird samt Positionen{order.documents.length ? ' und Unterlagen' : ''} gelöscht.{data.reports.length
			? ` ${data.reports.length === 1 ? 'Sein Tagesbericht bleibt' : `Seine ${data.reports.length} Tagesberichte bleiben`} erhalten, nur ohne Auftrag.`
			: ''}
		{order.offerId ? 'Das Angebot bleibt angenommen – daraus lässt sich wieder ein Auftrag erstellen, etwa für eine andere Partie.' : ''}
	</p>
	<form method="POST" action="?/delete" class="mt-5 flex justify-end gap-2" use:enhance>
		<button type="button" class="btn btn-ghost" onclick={() => (deleteOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary"><Trash size={18} aria-hidden="true" />Löschen</button>
	</form>
</Dialog>

