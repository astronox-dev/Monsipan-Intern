<script lang="ts">
	/**
	 * Eine Rechnung: als Entwurf änderbar, dann endgültig ausgestellt (archiviert,
	 * signiert, gesperrt) – Korrekturen nur noch per Storno. Dazu Zahlung,
	 * Tagesberichte, Positionen und der Abschnitt „Digitale Signatur & Sicherheit".
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import FileText from '@lucide/svelte/icons/file-text';
	import Printer from '@lucide/svelte/icons/printer';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash';
	import HardHat from '@lucide/svelte/icons/hard-hat';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import Undo from '@lucide/svelte/icons/undo-2';
	import Sigma from '@lucide/svelte/icons/sigma';
	import Stamp from '@lucide/svelte/icons/stamp';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ScanSearch from '@lucide/svelte/icons/scan-search';
	import Download from '@lucide/svelte/icons/download';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import BadgeInfo from '@lucide/svelte/icons/badge-info';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Ban from '@lucide/svelte/icons/ban';
	import History from '@lucide/svelte/icons/history';
	import Dialog from '$lib/components/Dialog.svelte';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import { date as dateLabel, dateTime } from '$lib/format';
	import {
		addressLines,
		INVOICE_STATUS_LABELS,
		invoiceLabel,
		invoiceTotals,
		lineNumbers,
		lineTotal,
		money,
		priceLabel,
		quantityLabel,
		REVERSE_CHARGE_NOTE,
		spacedNumber
	} from '$lib/modules/auftraege/offer';
	import { AUDIT_LABELS, CHECK_LABELS, INVOICE_STAGE_LABELS, PADES_LEVEL_LABELS, PROVIDER_LABELS, type CheckResult } from '$lib/modules/auftraege/signature';
	import { reportDateLabel } from '$lib/modules/tagesberichte/sheet';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();
	const invoice = $derived(data.invoice);
	const draft = $derived(invoice.stage === 'entwurf');
	const cancelled = $derived(invoice.stage === 'storniert');
	const isStorno = $derived(invoice.kind === 'storno');
	const st = $derived(INVOICE_STATUS_LABELS[invoice.status] ?? INVOICE_STATUS_LABELS.offen);
	const stage = $derived(INVOICE_STAGE_LABELS[invoice.stage]);
	const overdue = $derived(invoice.status === 'offen' && !cancelled && !isStorno && invoice.dueDate < data.today);
	const numbers = $derived(lineNumbers(invoice.lines));
	const totals = $derived(invoiceTotals(invoice.lines, invoice.vatRate, invoice.reverseCharge));
	const name = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(' ');
	const label = $derived(`${invoiceLabel(invoice.kind)} ${spacedNumber(invoice.number)}`);
	const original = $derived(data.files.find((f) => f.kind === 'original'));
	const signed = $derived(data.files.find((f) => f.kind === 'signiert'));
	const check = $derived(invoice.checkResult ? CHECK_LABELS[invoice.checkResult as CheckResult] : null);
	const CHECK_ICONS = { ok: CircleCheck, danger: CircleX, warn: CircleAlert, muted: CircleHelp } as const;
	const CHECK_TONES = { ok: 'text-ok', danger: 'text-danger', warn: 'text-warn', muted: 'text-ink-3' } as const;

	let deleteOpen = $state(false);
	let deleteIssuedOpen = $state(false);
	let issueOpen = $state(false);
	let cancelOpen = $state(false);
	let infoOpen = $state(false);
	let paidOn = $state('');
	let busy = $state('');
	$effect(() => {
		paidOn = data.today;
	});

	function run(key: string, success: (data: Record<string, unknown> | undefined) => string): SubmitFunction {
		return () => {
			busy = key;
			return async ({ result, update }) => {
				busy = '';
				if (result.type === 'success') {
					const warning = result.data?.warning;
					if (result.data?.issued === 'fehlgeschlagen') toast.error('Ausgestellt, aber nicht signiert', String(warning ?? ''));
					else if (warning) toast.success(success(result.data), String(warning));
					else toast.success(success(result.data));
				}
				await update();
			};
		};
	}
	const stageText = (d: Record<string, unknown> | undefined) => (d?.issued === 'signiert' ? 'Ausgestellt und signiert' : 'Ausgestellt');
</script>

<svelte:head><title>{pageTitle(label)}</title></svelte:head>

<a href="/rechnungen" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Rechnungen
</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">{label}</h1>
		<p class="text-ink-2">{invoice.title || 'Ohne BV'}</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<span class="badge {stage.tone}">{stage.label}</span>
		{#if !cancelled && !isStorno}
			{#if overdue}<span class="badge badge-danger">Überfällig</span>{:else}<span class="badge {st.tone}">{st.label}</span>{/if}
		{/if}
		<PdfButton href="/rechnungen/{invoice.id}/pdf"><FileText size={18} aria-hidden="true" />{draft ? 'PDF (Entwurf)' : 'PDF'}</PdfButton>
		<a href="/rechnungen/{invoice.id}/druck" class="btn btn-secondary"><Printer size={18} aria-hidden="true" />Drucken</a>
		{#if invoice.reports.length}
			<a href="/rechnungen/{invoice.id}/summenblatt" class="btn btn-secondary"><Sigma size={18} aria-hidden="true" />Summenblatt</a>
		{/if}
		{#if data.canEdit}<a href="/rechnungen/{invoice.id}/bearbeiten" class="btn btn-secondary"><Pencil size={18} aria-hidden="true" />Bearbeiten</a>{/if}
	</div>
</div>

{#if form && 'message' in form && form.message}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>{/if}

<!-- Entwurf: endgültig ausstellen -->
{#if draft}
	<section class="card mb-4 flex flex-wrap items-center gap-3 border-info/50 p-4 lg:p-5">
		<Stamp size={22} class="shrink-0 text-info" aria-hidden="true" />
		<p class="min-w-[14rem] flex-1">
			<span class="font-medium">Entwurf – noch nicht ausgestellt.</span>
			<span class="block text-sm text-ink-2">
				Das PDF trägt „ENTWURF". Erst die endgültig ausgestellte Rechnung wird archiviert{data.signing.enabled ? ' und digital signiert' : ''} und geht an den Kunden.
			</span>
		</p>
		{#if data.canIssue}
			<button type="button" class="btn btn-primary" onclick={() => (issueOpen = true)}><Stamp size={18} aria-hidden="true" />Rechnung endgültig ausstellen</button>
		{/if}
	</section>
{/if}

<!-- Storno -->
{#if cancelled}
	<section class="card mb-4 flex flex-wrap items-center gap-3 border-warn/50 p-4 lg:p-5">
		<Ban size={22} class="shrink-0 text-warn" aria-hidden="true" />
		<p class="min-w-[14rem] flex-1">
			<span class="font-medium">Storniert am {invoice.cancelledAt ? dateTime(invoice.cancelledAt) : '–'}</span>{name(invoice.cancellerFirst, invoice.cancellerLast)
				? ` von ${name(invoice.cancellerFirst, invoice.cancellerLast)}`
				: ''}
			{#if invoice.cancelReason}<span class="block text-sm text-ink-2">Grund: {invoice.cancelReason}</span>{/if}
		</p>
		{#if invoice.stornoId}
			<a href="/rechnungen/{invoice.stornoId}" class="btn btn-secondary">Stornorechnung {spacedNumber(invoice.stornoNumber ?? '')}</a>
		{/if}
	</section>
{/if}
{#if isStorno && invoice.cancelsId}
	<section class="card mb-4 flex flex-wrap items-center gap-3 p-4 lg:p-5">
		<Ban size={22} class="shrink-0 text-ink-3" aria-hidden="true" />
		<p class="min-w-[14rem] flex-1">
			Storno zu {invoiceLabel(invoice.cancelsKind ?? 'rechnung')} Nr. {spacedNumber(invoice.cancelsNumber ?? '')}{invoice.cancelsDate ? ` vom ${dateLabel(invoice.cancelsDate)}` : ''}
		</p>
		<a href="/rechnungen/{invoice.cancelsId}" class="btn btn-secondary">Zur stornierten Rechnung</a>
	</section>
{/if}

<!-- Zahlung: offen → bezahlt und zurück -->
{#if !cancelled && !isStorno}
	<section class="card mb-4 flex flex-wrap items-center gap-3 p-4 lg:p-5 {invoice.status === 'bezahlt' ? '' : overdue ? 'border-danger/50' : 'border-warn/50'}">
		{#if invoice.status === 'bezahlt'}
			<CircleCheck size={22} class="text-ok" aria-hidden="true" />
			<p class="min-w-0 flex-1">
				Bezahlt am <span class="font-medium">{invoice.paidOn ? dateLabel(invoice.paidOn) : '–'}</span>{name(invoice.paidByFirst, invoice.paidByLast)
					? ` · eingetragen von ${name(invoice.paidByFirst, invoice.paidByLast)}`
					: ''}
			</p>
			{#if data.canPay}
				<form method="POST" action="?/open" use:enhance={() => async ({ update }) => (toast.success('Wieder offen'), await update())}>
					<button class="btn btn-ghost btn-sm"><Undo size={16} aria-hidden="true" />Wieder offen</button>
				</form>
			{/if}
		{:else}
			<p class="min-w-[12rem] flex-1">
				{overdue ? 'Überfällig seit' : 'Zahlbar bis'} <span class="font-medium">{dateLabel(invoice.dueDate)}</span> · {money(totals.gross)}
			</p>
			{#if data.canPay}
				<form
					method="POST"
					action="?/paid"
					class="flex flex-wrap items-center gap-2"
					use:enhance={() => {
						busy = 'paid';
						return async ({ result, update }) => {
							busy = '';
							if (result.type === 'success') toast.success('Als bezahlt markiert');
							await update();
						};
					}}
				>
					<label class="flex items-center gap-2 text-sm">
						Bezahlt am
						<input class="input num w-auto" type="date" name="am" required max={data.today} bind:value={paidOn} />
					</label>
					<button class="btn btn-primary" disabled={busy === 'paid'}><CircleCheck size={18} aria-hidden="true" />Bezahlt</button>
				</form>
			{/if}
		{/if}
	</section>
{/if}

<div class="grid gap-4 lg:grid-cols-2">
	<section class="card p-4 lg:p-5">
		<h2 class="text-lg">Kunde</h2>
		<p class="mt-2 leading-relaxed">
			{#each addressLines( { name: invoice.customerName, addition: invoice.customerAddition, street: invoice.customerStreet, zip: invoice.customerZip, city: invoice.customerCity } ) as l, i (i)}
				<span class="block {i === 0 ? 'font-medium' : ''}">{l}</span>
			{/each}
		</p>
		{#if invoice.customerUid}<p class="mt-2 text-sm text-ink-2">UID {invoice.customerUid}</p>{/if}
	</section>
	<section class="card p-4 lg:p-5">
		<h2 class="text-lg">Rechnung</h2>
		<dl class="mt-2 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1 text-sm">
			<dt class="text-ink-3">Rechnungsdatum</dt>
			<dd>{dateLabel(invoice.date)}</dd>
			{#if !isStorno}
				<dt class="text-ink-3">Zahlbar bis</dt>
				<dd>{dateLabel(invoice.dueDate)}</dd>
			{/if}
			{#if invoice.serviceFrom}
				<dt class="text-ink-3">Leistungszeitraum</dt>
				<dd>{reportDateLabel(invoice.serviceFrom, invoice.serviceTo)}</dd>
			{/if}
			{#if invoice.location}
				<dt class="text-ink-3">Ausführungsort</dt>
				<dd>{invoice.location}</dd>
			{/if}
			{#if invoice.projectNumber}
				<dt class="text-ink-3">Projektnummer</dt>
				<dd class="num">{invoice.projectNumber}</dd>
			{/if}
			{#if invoice.state}
				<dt class="text-ink-3">Bundesland</dt>
				<dd>{invoice.state}</dd>
			{/if}
			{#if invoice.section}
				<dt class="text-ink-3">Abschnitt</dt>
				<dd>{invoice.section}</dd>
			{/if}
			<dt class="text-ink-3">Erstellt</dt>
			<dd>{dateTime(invoice.createdAt)}{name(invoice.creatorFirst, invoice.creatorLast) ? ` · ${name(invoice.creatorFirst, invoice.creatorLast)}` : ''}</dd>
			{#if invoice.issuedAt}
				<dt class="text-ink-3">Ausgestellt</dt>
				<dd>{dateTime(invoice.issuedAt)}{name(invoice.issuerFirst, invoice.issuerLast) ? ` · ${name(invoice.issuerFirst, invoice.issuerLast)}` : ''}</dd>
			{/if}
		</dl>
		{#if data.canSeeOrder}
			<a href="/auftraege/{invoice.orderId}" class="btn btn-ghost btn-sm mt-3"><HardHat size={16} aria-hidden="true" />Zum Auftrag</a>
		{/if}
	</section>
</div>

<!-- Altbestand aus einem anderen Programm -->
{#if invoice.stage === 'importiert'}
	<section class="card mt-4 flex flex-wrap items-center gap-3 p-4 lg:p-5">
		<History size={22} class="shrink-0 text-ink-3" aria-hidden="true" />
		<p class="min-w-[14rem] flex-1">
			<span class="font-medium">Altbestand – aus einem anderen Programm importiert.</span>
			<span class="block text-sm text-ink-2">
				Gesperrt wie eine ausgestellte Rechnung, aber ohne Archiv, Signatur und Prüfcode – maßgeblich ist das ursprünglich ausgestellte Dokument. Offen/bezahlt
				lässt sich ändern; Korrekturen per Storno.
			</span>
		</p>
		{#if data.canCancel}
			<button type="button" class="btn btn-ghost text-danger hover:bg-danger-soft" onclick={() => (cancelOpen = true)}><Ban size={18} aria-hidden="true" />Stornieren</button>
		{/if}
	</section>
{/if}

<!-- Digitale Signatur & Sicherheit -->
{#if !draft && invoice.stage !== 'importiert'}
	<section class="card mt-4 p-4 lg:p-5" aria-labelledby="h-security">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 id="h-security" class="flex items-center gap-2 text-lg"><ShieldCheck size={20} aria-hidden="true" />Digitale Signatur & Sicherheit</h2>
			<span class="badge {stage.tone}">{stage.label}</span>
		</div>

		{#if invoice.stage === 'fehlgeschlagen' && invoice.signError}
			<p class="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">Signierung fehlgeschlagen: {invoice.signError}</p>
		{/if}

		<dl class="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
			<dt class="text-ink-3">Signaturstatus</dt>
			<dd>
				{#if data.signature}
					Digital signiert – {data.signature.certOrganization || data.signature.certName}
				{:else if invoice.stage === 'signierung'}
					Signierung läuft …
				{:else}
					Nicht signiert{data.signing.enabled ? '' : ' – die digitale Signatur ist in den Einstellungen aus'}
				{/if}
			</dd>
			{#if data.signature}
				<dt class="text-ink-3">Signaturstandard</dt>
				<dd>
					{PADES_LEVEL_LABELS[data.signature.level] ?? data.signature.level}
					{#if data.signature.level !== data.signature.requestedLevel}<span class="block text-ink-2">eingestellt war {data.signature.requestedLevel}: {data.signature.notes}</span>{/if}
				</dd>
				<dt class="text-ink-3">Signaturdatum</dt>
				<dd>
					{dateTime(data.signature.timestampAt ?? data.signature.signedAt)}
					{#if data.signature.timestampAt}<span class="text-ink-2"> · Zeitstempel {data.signature.tsa}</span>{/if}
				</dd>
				<dt class="text-ink-3">Zertifikat</dt>
				<dd>
					{data.signature.certName} · ausgestellt von {data.signature.certIssuer} · gültig bis {dateLabel(data.signature.certNotAfter)}
					<span class="block text-ink-2">{data.signature.qualification}</span>
				</dd>
			{/if}
			<dt class="text-ink-3">Letzte Prüfung</dt>
			<dd>
				{#if check && invoice.checkedAt}
					{@const Icon = CHECK_ICONS[check.tone as keyof typeof CHECK_ICONS]}
					<span class="inline-flex items-center gap-1.5 font-medium {CHECK_TONES[check.tone as keyof typeof CHECK_TONES]}"><Icon size={16} aria-hidden="true" />{check.label}</span>
					<span class="text-ink-2"> · {dateTime(invoice.checkedAt)}</span>
					{#if invoice.checkDetail}<span class="block text-ink-2">{invoice.checkDetail}</span>{/if}
				{:else}
					Noch nicht geprüft
				{/if}
			</dd>
			<dt class="text-ink-3">SHA-256</dt>
			<dd class="space-y-1">
				{#if original}<span class="block"><span class="text-ink-3">Original:</span> <span class="num break-all text-xs">{original.sha256}</span></span>{/if}
				{#if signed}<span class="block"><span class="text-ink-3">Signiert:</span> <span class="num break-all text-xs">{signed.sha256}</span></span>{/if}
				{#if !original}<span class="text-danger">Kein Archiv vorhanden</span>{/if}
			</dd>
			{#if invoice.retainUntil}
				<dt class="text-ink-3">Aufbewahren bis</dt>
				<dd>mindestens {dateLabel(invoice.retainUntil)}</dd>
			{/if}
		</dl>

		<div class="mt-4 flex flex-wrap gap-2">
			<form method="POST" action="?/verify" use:enhance={run('verify', (d) => CHECK_LABELS[d?.verified as CheckResult]?.label ?? 'Geprüft')}>
				<button class="btn btn-secondary" disabled={busy === 'verify'}><ScanSearch size={18} aria-hidden="true" />Digitale Signatur überprüfen</button>
			</form>
			{#if signed}
				<a href="/rechnungen/{invoice.id}/archiv?datei=signiert" class="btn btn-secondary" data-sveltekit-reload><Download size={18} aria-hidden="true" />Signierte Rechnung herunterladen</a>
			{:else if original}
				<a href="/rechnungen/{invoice.id}/archiv?datei=original" class="btn btn-secondary" data-sveltekit-reload><Download size={18} aria-hidden="true" />Archivierte Rechnung herunterladen</a>
			{/if}
			{#if data.verifyUrl}
				<a href={data.verifyUrl} target="_blank" rel="noopener" class="btn btn-secondary"><QrCode size={18} aria-hidden="true" />Rechnung verifizieren</a>
			{/if}
			{#if data.signature}
				<button type="button" class="btn btn-secondary" onclick={() => (infoOpen = true)}><BadgeInfo size={18} aria-hidden="true" />Signaturinformationen anzeigen</button>
			{/if}
			{#if data.canSign && !data.signature}
				<form method="POST" action="?/sign" use:enhance={run('sign', stageText)}>
					<button class="btn btn-primary" disabled={busy === 'sign'}><RotateCw size={18} aria-hidden="true" />{busy === 'sign' ? 'Wird signiert …' : invoice.stage === 'fehlgeschlagen' ? 'Signierung erneut versuchen' : 'Jetzt signieren'}</button>
				</form>
			{/if}
			{#if data.canCancel}
				<button type="button" class="btn btn-ghost text-danger hover:bg-danger-soft sm:ml-auto" onclick={() => (cancelOpen = true)}><Ban size={18} aria-hidden="true" />Stornieren</button>
			{/if}
		</div>
	</section>
{/if}

{#if invoice.reports.length}
	<section class="card mt-4 p-4 lg:p-5">
		<h2 class="text-lg">Abgerechnete Tagesberichte</h2>
		<ul class="mt-2 flex flex-wrap gap-2">
			{#each invoice.reports as r (r.id)}
				{@const text = `Nr. ${r.number || '–'} · ${reportDateLabel(r.date, r.dateTo)}`}
				<li>
					{#if data.canSeeReports}
						<a href="/tagesberichte/{r.id}" class="num inline-block rounded-lg border border-line px-2.5 py-1 text-sm hover:bg-surface-2" title={r.site}>{text}</a>
					{:else}
						<span class="num inline-block rounded-lg border border-line px-2.5 py-1 text-sm" title={r.site}>{text}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="card mt-4 overflow-hidden">
	<h2 class="px-4 pt-4 text-lg lg:px-5">Positionen</h2>
	{#if invoice.intro}<p class="px-4 pt-1 text-sm whitespace-pre-line text-ink-2 lg:px-5">{invoice.intro}</p>{/if}
	<ul class="mt-2 divide-y divide-line">
		{#each invoice.lines as l, i (l.id)}
			{#if l.kind === 'titel'}
				<li class="bg-surface-2 px-4 py-2 font-semibold lg:px-5"><span class="num mr-2">{l.number || numbers[i]}</span>{l.text}</li>
			{:else}
				<li class="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] gap-x-3 px-4 py-3 lg:px-5">
					<span class="num text-sm text-ink-3">{l.number || numbers[i]}</span>
					<span class="min-w-0 font-medium whitespace-pre-line">{l.text}</span>
					<span class="num text-right font-medium">{money(lineTotal(l))}</span>
					<span class="num col-start-2 text-sm text-ink-2">{quantityLabel(l.quantity)} {l.unit} × {priceLabel(l.unitPrice)}</span>
				</li>
			{/if}
		{/each}
	</ul>
	<dl class="num mx-4 mt-2 mb-4 ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 border-t border-line pt-3 lg:mx-5 lg:ml-auto">
		<dt>Gesamt Netto</dt>
		<dd class="text-right">{money(totals.net)}</dd>
		{#if !invoice.reverseCharge}
			<dt>{String(invoice.vatRate).replace('.', ',')} % Umsatzsteuer</dt>
			<dd class="text-right">{money(totals.vat)}</dd>
		{/if}
		<dt class="border-t border-ink pt-1.5 text-lg font-semibold">Gesamtbetrag</dt>
		<dd class="border-t border-ink pt-1.5 text-right text-lg font-semibold">{money(totals.gross)}</dd>
	</dl>
	{#if invoice.reverseCharge}<p class="px-4 pb-4 text-sm text-ink-2 lg:px-5">{REVERSE_CHARGE_NOTE} UID des Kunden: {invoice.customerUid}</p>{/if}
	{#if invoice.closing}<p class="border-t border-line px-4 py-3 text-sm whitespace-pre-line text-ink-2 lg:px-5">{invoice.closing}</p>{/if}
</section>

{#if data.trail.length}
	<details class="card mt-4 p-4 lg:p-5">
		<summary class="flex cursor-pointer items-center gap-2 text-lg font-semibold"><History size={20} aria-hidden="true" />Protokoll ({data.trail.length})</summary>
		<ol class="mt-3 space-y-2 text-sm">
			{#each data.trail as t (t.id)}
				<li class="grid grid-cols-1 gap-x-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
					<span class="num text-ink-3">{dateTime(t.at)}</span>
					<span>
						<span class="font-medium">{AUDIT_LABELS[t.action] ?? t.action}</span> · {t.userName}
						{#if t.detail && Object.keys(t.detail).length}
							<span class="block break-words text-xs text-ink-3">
								{Object.entries(t.detail)
									.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : v}`)
									.join(' · ')}
							</span>
						{/if}
					</span>
				</li>
			{/each}
		</ol>
	</details>
{/if}

{#if data.canDelete}
	<div class="mt-4 flex">
		<button type="button" class="btn btn-ghost ml-auto text-danger hover:bg-danger-soft" onclick={() => (deleteOpen = true)}>
			<Trash size={18} aria-hidden="true" />Entwurf löschen
		</button>
	</div>
	<Dialog bind:open={deleteOpen} title="Entwurf löschen?">
		<p class="text-ink-2">
			Der Entwurf {label} wird gelöscht.{invoice.reports.length ? ' Seine Tagesberichte sind danach wieder abzurechnen.' : ''} Eine neue Rechnung zum Auftrag bekommt wieder
			die nächste freie Nummer.
		</p>
		<form method="POST" action="?/delete" class="mt-5 flex justify-end gap-2" use:enhance>
			<button type="button" class="btn btn-ghost" onclick={() => (deleteOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary"><Trash size={18} aria-hidden="true" />Löschen</button>
		</form>
	</Dialog>
{/if}

{#if data.canDeleteIssued}
	<div class="mt-4 flex">
		<button type="button" class="btn btn-ghost ml-auto text-danger hover:bg-danger-soft" onclick={() => (deleteIssuedOpen = true)}>
			<Trash size={18} aria-hidden="true" />{isStorno ? 'Stornorechnung löschen' : 'Rechnung löschen'} (Test)
		</button>
	</div>
	<Dialog bind:open={deleteIssuedOpen} title="{label} löschen?">
		<div class="space-y-2 text-ink-2">
			<p>
				<span class="font-medium text-danger">Nur zum Testen.</span> Die ausgestellte {invoiceLabel(invoice.kind)} wird samt Archivdateien und Signatur gelöscht; die Löschung
				steht mit Begründung im Protokoll. Rechnungen, die an Kunden gegangen sind, sind aufzubewahren – dafür stornieren.
			</p>
			{#if isStorno && invoice.cancelsId}
				<p>
					Die {invoiceLabel(invoice.cancelsKind ?? 'rechnung')} {spacedNumber(invoice.cancelsNumber ?? '')} gilt danach wieder (nicht mehr storniert), ihre Tagesberichte hängen wieder
					an ihr.
				</p>
			{:else if invoice.stornoId}
				<p>Die Stornorechnung {spacedNumber(invoice.stornoNumber ?? '')} wird mitgelöscht.</p>
			{:else if invoice.reports.length}
				<p>Ihre Tagesberichte sind danach wieder abzurechnen.</p>
			{/if}
		</div>
		<form
			method="POST"
			action="?/deleteIssued"
			class="mt-4 space-y-4"
			use:enhance={() => {
				busy = 'deleteIssued';
				return async ({ result, update }) => {
					busy = '';
					if (result.type === 'redirect') {
						deleteIssuedOpen = false;
						toast.success('Gelöscht');
					}
					await update();
				};
			}}
		>
			<label class="block">
				<span class="field-label">Grund</span>
				<input class="input" name="grund" required minlength="3" maxlength="500" placeholder="z. B. Testrechnung" />
			</label>
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-ghost" onclick={() => (deleteIssuedOpen = false)}>Abbrechen</button>
				<button class="btn btn-primary" disabled={busy === 'deleteIssued'}><Trash size={18} aria-hidden="true" />Endgültig löschen</button>
			</div>
		</form>
	</Dialog>
{/if}

{#if data.canIssue}
	<Dialog bind:open={issueOpen} title="Rechnung endgültig ausstellen?">
		<div class="space-y-2 text-ink-2">
			<p>Die {label} über <span class="font-medium text-ink">{money(totals.gross)}</span> wird endgültig ausgestellt:</p>
			<ul class="list-disc space-y-1 pl-5">
				<li>Das PDF wird mit Prüfcode erzeugt und unverändert archiviert (SHA-256).</li>
				{#if data.signing.enabled}<li>Es wird digital signiert ({PADES_LEVEL_LABELS[data.signing.level]}).</li>{/if}
				<li>Nummer, Datum, Kunde, Positionen und Beträge lassen sich danach <span class="font-medium text-ink">nicht mehr ändern</span> – Korrekturen nur per Storno.</li>
			</ul>
		</div>
		<form
			method="POST"
			action="?/issue"
			class="mt-5 flex justify-end gap-2"
			use:enhance={() => {
				busy = 'issue';
				return async ({ result, update }) => {
					busy = '';
					issueOpen = false;
					if (result.type === 'success') {
						if (result.data?.issued === 'fehlgeschlagen') toast.error('Ausgestellt, aber nicht signiert', String(result.data?.warning ?? ''));
						else toast.success(stageText(result.data), result.data?.warning ? String(result.data.warning) : undefined);
					}
					await update();
				};
			}}
		>
			<button type="button" class="btn btn-ghost" onclick={() => (issueOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary" disabled={busy === 'issue'}><Stamp size={18} aria-hidden="true" />{busy === 'issue' ? 'Wird ausgestellt …' : 'Endgültig ausstellen'}</button>
		</form>
	</Dialog>
{/if}

{#if data.canCancel}
	<Dialog bind:open={cancelOpen} title="{label} stornieren?">
		<p class="text-ink-2">
			Es wird eine Stornorechnung mit umgekehrten Beträgen ausgestellt{data.signing.enabled ? ' und signiert' : ''}; die Rechnung selbst bleibt unverändert archiviert
			und gilt als storniert.{invoice.reports.length ? ' Ihre Tagesberichte sind danach wieder abzurechnen – mit einer neuen Rechnung.' : ''}
		</p>
		<form
			method="POST"
			action="?/cancel"
			class="mt-4 space-y-4"
			use:enhance={() => {
				busy = 'cancel';
				return async ({ result, update }) => {
					busy = '';
					if (result.type === 'redirect') {
						cancelOpen = false;
						toast.success('Storniert – Stornorechnung ausgestellt');
					}
					await update();
				};
			}}
		>
			<label class="block">
				<span class="field-label">Grund</span>
				<textarea class="textarea" name="grund" rows="2" required minlength="3" maxlength="500" placeholder="z. B. falsche Mengen, Rechnung an falschen Empfänger"></textarea>
			</label>
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-ghost" onclick={() => (cancelOpen = false)}>Abbrechen</button>
				<button class="btn btn-primary" disabled={busy === 'cancel'}><Ban size={18} aria-hidden="true" />{busy === 'cancel' ? 'Wird storniert …' : 'Stornieren'}</button>
			</div>
		</form>
	</Dialog>
{/if}

{#if data.signature}
	<Dialog bind:open={infoOpen} title="Signaturinformationen" wide>
		<dl class="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
			<dt class="text-ink-3">Verfahren</dt>
			<dd>{PADES_LEVEL_LABELS[data.signature.level] ?? data.signature.level} · ETSI.CAdES.detached, SHA-256</dd>
			<dt class="text-ink-3">Anbieter</dt>
			<dd>{PROVIDER_LABELS[data.signature.provider] ?? data.signature.provider}</dd>
			<dt class="text-ink-3">Signiert am</dt>
			<dd>{dateTime(data.signature.signedAt)}</dd>
			<dt class="text-ink-3">Zeitstempel</dt>
			<dd>{data.signature.timestampAt ? `${dateTime(data.signature.timestampAt)} · ${data.signature.tsa}` : 'ohne'}</dd>
			<dt class="text-ink-3">Inhaber</dt>
			<dd>{data.signature.certName}{data.signature.certOrganization ? ` · ${data.signature.certOrganization}` : ''}</dd>
			<dt class="text-ink-3">Aussteller</dt>
			<dd>{data.signature.certIssuer}</dd>
			<dt class="text-ink-3">Seriennummer</dt>
			<dd class="num break-all">{data.signature.certSerial}</dd>
			<dt class="text-ink-3">Gültig</dt>
			<dd>{dateLabel(data.signature.certNotBefore)} – {dateLabel(data.signature.certNotAfter)}</dd>
			<dt class="text-ink-3">Fingerabdruck</dt>
			<dd class="num break-all text-xs">{data.signature.certFingerprint}</dd>
			<dt class="text-ink-3">Einstufung</dt>
			<dd>{data.signature.qualification}</dd>
		</dl>
		<p class="mt-4 text-sm text-ink-2">
			In Adobe Acrobat Reader zeigt der Unterschriftenbereich dieselbe Signatur. Bei einem eigenen Zertifikat meldet Adobe „Identität unbekannt" – die Unversehrtheit
			des Dokuments wird trotzdem geprüft.
		</p>
	</Dialog>
{/if}
