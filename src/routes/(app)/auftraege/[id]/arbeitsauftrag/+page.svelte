<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import FileText from '@lucide/svelte/icons/file-text';
	import X from '@lucide/svelte/icons/x';
	import Trash from '@lucide/svelte/icons/trash';
	import Lock from '@lucide/svelte/icons/lock';
	import Signature from '@lucide/svelte/icons/signature';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import Hammer from '@lucide/svelte/icons/hammer';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Plus from '@lucide/svelte/icons/plus';
	import Printer from '@lucide/svelte/icons/printer';
	import Dialog from '$lib/components/Dialog.svelte';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import SignaturePad from '$lib/modules/stunden/components/SignaturePad.svelte';
	import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '$lib/modules/stunden/signature';
	import { today } from '$lib/modules/stunden/week';
	import { reportDateLabel } from '$lib/modules/tagesberichte/sheet';
	import WorkOrderHead from '$lib/modules/auftraege/components/WorkOrderHead.svelte';
	import WorkOrderBack from '$lib/modules/auftraege/components/WorkOrderBack.svelte';
	import SignatureTile from '$lib/modules/auftraege/components/SignatureTile.svelte';
	import { fileSizeLabel } from '$lib/documents';
	import { ORDER_STATUS_LABELS, parseAmount, quantityLabel, spacedNumber } from '$lib/modules/auftraege/offer';
	import { CHECKLIST, ISSUES, MAX_BRIEFINGS, maySign, SIGNATURE_LABELS, type SignatureRole, type WorkOrderContent } from '$lib/modules/auftraege/work-order';
	import { date, dateTime } from '$lib/format';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();

	/** Unterschriften und Unterweisungen kommen immer frisch vom Server */
	const saved = $derived(data.work.content);
	const office = $derived(data.scope.office && !data.locked);
	const site = $derived(data.scope.site && !data.locked);
	const editable = $derived(office || site);
	const st = $derived(ORDER_STATUS_LABELS[data.order.status] ?? ORDER_STATUS_LABELS.erstellt);

	/** Das Formular gehört nach dem Öffnen der Seite – die ausgeführte Menge als Text zum Tippen */
	function toState(content: WorkOrderContent) {
		const { signatures: _s, briefings: _b, foil: _f, lines, ...rest } = structuredClone(content);
		return { ...rest, lines: lines.map((l) => ({ ...l, done: quantityLabel(l.done) })) };
	}
	// svelte-ignore state_referenced_locally
	let f = $state(toState(data.work.content));
	const payload = $derived(JSON.stringify({ ...f, lines: f.lines.map((l) => ({ ...l, done: parseAmount(l.done) })) }));

	let busy = $state(false);
	let deleteOpen = $state(false);

	// Unterschreiben: ein Dialog für BL, Vorarbeiter, Vertretung und Auftraggeber
	let signOpen = $state(false);
	let signRole = $state<SignatureRole>('bl');
	let signName = $state('');
	let signPath = $state('');
	function openSign(role: SignatureRole) {
		signRole = role;
		signName = role === 'auftraggeber' ? f.contacts[0]?.name || '' : role === 'vertretung' ? '' : data.me;
		signPath = '';
		signOpen = true;
	}
	let removeRole = $state<SignatureRole | null>(null);
	const tile = (role: SignatureRole) => ({
		label: SIGNATURE_LABELS[role],
		signature: saved.signatures[role],
		canSign: maySign(role, data.scope) && !data.locked,
		canRemove: maySign(role, data.scope) && (!data.locked || role === 'auftraggeber'),
		busy,
		onsign: () => openSign(role),
		onremove: () => (removeRole = role)
	});

	// Unterweisung: Name, Datum, Unterschrift der Person am Gerät
	let briefOpen = $state(false);
	let briefName = $state('');
	let briefDate = $state(today());
	let briefPath = $state('');
	function openBrief() {
		briefName = '';
		briefDate = today();
		briefPath = '';
		briefOpen = true;
	}

	const DONE: Record<string, string> = { sign: 'Unterschrift gespeichert', brief: 'Unterweisung eingetragen', save: 'Gespeichert' };
	const mapUrl = $derived(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.order.location)}`);
	const REPORT_STATUS: Record<string, { label: string; tone: string }> = {
		entwurf: { label: 'In Arbeit', tone: '' },
		freigegeben: { label: 'Freigegeben', tone: 'badge-info' },
		geprueft: { label: 'Geprüft', tone: 'badge-warn' },
		abgeschlossen: { label: 'Abgeschlossen', tone: 'badge-ok' }
	};
</script>

<svelte:head><title>{pageTitle(`Arbeitsauftrag ${spacedNumber(data.order.number)}`)}</title></svelte:head>

{#if data.wholeOrder}
	<a href="/auftraege/{data.order.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
		<ArrowLeft size={16} aria-hidden="true" />Auftrag {spacedNumber(data.order.number)}
	</a>
{:else}
	<a href="/auftraege" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
		<ArrowLeft size={16} aria-hidden="true" />Aufträge
	</a>
{/if}

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">Arbeitsauftrag {spacedNumber(data.order.number)}</h1>
		<p class="text-ink-2">{saved.title || data.order.title || 'Ohne BV'}{data.order.partyName ? ` · ${data.order.partyName}` : ''}</p>
		{#if data.order.location}
			<a href={mapUrl} target="_blank" rel="noopener" class="mt-1 inline-flex items-start gap-1.5 font-medium underline-offset-2 hover:underline">
				<MapPin size={17} class="mt-0.5 shrink-0" aria-hidden="true" />{data.order.location}
			</a>
		{/if}
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<span class="badge {st.tone}">{st.label}</span>
		{#if data.locked}<span class="badge badge-ok"><Lock size={13} aria-hidden="true" />Vom Auftraggeber unterschrieben</span>{/if}
		<PdfButton href="/auftraege/{data.order.id}/arbeitsauftrag/pdf"><FileText size={18} aria-hidden="true" />PDF</PdfButton>
		<a href="/auftraege/{data.order.id}/arbeitsauftrag/druck" class="btn btn-secondary"><Printer size={18} aria-hidden="true" />Drucken</a>
	</div>
</div>

{#if form && 'message' in form && form.message && !signOpen && !briefOpen}
	<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>
{/if}

{#if data.locked && saved.signatures.auftraggeber}
	<p class="card mb-4 flex items-start gap-3 p-4 text-sm text-ink-2">
		<Lock size={18} class="mt-0.5 shrink-0" aria-hidden="true" />
		<span>
			Der Auftraggeber hat am {dateTime(saved.signatures.auftraggeber.at)} unterschrieben – der Arbeitsauftrag ist abgeschlossen. Zum Ändern
			zuerst seine Unterschrift entfernen (unten bei „Abschluss“).
		</span>
	</p>
{:else if !editable}
	<p class="mb-4 text-sm text-ink-3">Diesen Arbeitsauftrag kannst du nur ansehen.</p>
{/if}

{#if data.canStatus && data.order.status !== 'abgeschlossen'}
	<!-- Der Stand der Arbeiten – groß, damit es auf der Baustelle mit einem Tipp geht -->
	<form
		method="POST"
		action="?/status"
		class="card mb-4 flex flex-wrap items-center gap-3 p-4"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'success') toast.success(result.data?.status === 'abgeschlossen' ? 'Auftrag abgeschlossen' : 'Auftrag ist in Arbeit');
				await update({ reset: false });
			};
		}}
	>
		<p class="min-w-[12rem] flex-1 text-ink-2">
			{data.order.status === 'erstellt' ? 'Sobald ihr anfangt, auf „In Arbeit" setzen.' : 'Fertig? Dann auf „Abgeschlossen" setzen.'}
		</p>
		{#if data.order.status === 'erstellt'}
			<button class="btn btn-primary" name="status" value="in_arbeit" disabled={busy}><Hammer size={18} aria-hidden="true" />In Arbeit</button>
		{/if}
		<button class="btn {data.order.status === 'in_arbeit' ? 'btn-primary' : 'btn-secondary'}" name="status" value="abgeschlossen" disabled={busy}>
			<CircleCheck size={18} aria-hidden="true" />Abgeschlossen
		</button>
	</form>
{/if}

{#if data.order.note.trim()}
	<section class="card mb-4 border-warn/50 p-4 lg:p-5">
		<h2 class="text-lg">Hinweis für die Partie</h2>
		<p class="mt-2 whitespace-pre-line">{data.order.note}</p>
	</section>
{/if}

<form
	id="aa"
	method="POST"
	action="?/save"
	use:enhance={({ action }) => {
		busy = true;
		const step = action.search === '?/sign' ? 'sign' : action.search === '?/brief' ? 'brief' : 'save';
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				toast.success(DONE[step]);
				if (step === 'sign') signOpen = false;
				if (step === 'brief') briefOpen = false;
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
	{:else if briefOpen}
		<input type="hidden" name="name" value={briefName} />
		<input type="hidden" name="datum" value={briefDate} />
		<input type="hidden" name="unterschrift" value={briefPath} />
	{/if}

	<div class="space-y-4">
		<WorkOrderHead bind:form={f} disabled={!office} />

		<section class="card overflow-hidden">
			<div class="px-4 pt-4 lg:px-5">
				<h2 class="text-lg">Beschreibung der Leistung</h2>
				<p class="mt-0.5 text-sm text-ink-3">Die Leistungen stehen fest – die Partie trägt die ausgeführte Menge ein.</p>
			</div>
			<div class="mt-3 lg:overflow-x-auto">
				<div class="hidden min-w-[50rem] gap-2 border-y border-line px-4 py-2 text-[0.75rem] text-ink-3 lg:grid lg:grid-cols-[minmax(12rem,1fr)_8rem_8rem_5rem_7rem_8rem] lg:px-5">
					<span>Leistung</span><span>Art der Markierung</span><span>RAL Farbton</span><span>MSK</span><span class="text-right">Ca. Menge</span>
					<span class="text-right">Ausgeführt</span>
				</div>
				{#each f.lines as l, i (i)}
					<div class="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-0 lg:min-w-[50rem] lg:grid-cols-[minmax(12rem,1fr)_8rem_8rem_5rem_7rem_8rem] lg:items-center lg:gap-2 lg:px-5 lg:py-2">
						<p class="col-span-2 font-medium lg:col-span-1">{l.text}</p>
						<p class="text-sm text-ink-2 lg:text-base lg:text-ink"><span class="text-ink-3 lg:hidden">Art:&nbsp;</span>{l.kind || '–'}</p>
						<p class="text-sm text-ink-2 lg:text-base lg:text-ink"><span class="text-ink-3 lg:hidden">RAL:&nbsp;</span>{l.ral || '–'}</p>
						<p class="text-sm text-ink-2 lg:text-base lg:text-ink"><span class="text-ink-3 lg:hidden">MSK:&nbsp;</span>{l.msk || '–'}</p>
						<p class="num text-sm text-ink-2 lg:text-right lg:text-base lg:text-ink"><span class="text-ink-3 lg:hidden">Ca.&nbsp;</span>{quantityLabel(l.quantity)} {l.unit}</p>
						<label class="col-span-2 mt-1 flex items-center gap-2 lg:col-span-1 lg:mt-0">
							<span class="field-label mb-0 shrink-0 lg:sr-only">Ausgeführte Menge</span>
							<input class="input input-sm num min-w-0 flex-1 text-right" inputmode="decimal" maxlength="14" disabled={!site} bind:value={l.done} />
							<span class="w-8 shrink-0 text-sm text-ink-3">{l.unit}</span>
						</label>
					</div>
				{:else}
					<p class="px-4 pb-4 text-sm text-ink-3 lg:px-5">Keine Leistungen.</p>
				{/each}
			</div>
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">Folienverlegeprotokoll und Unterschriften</h2>
			<div class="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
				<fieldset disabled={!editable}>
					<legend class="field-label">Folienverlegeprotokoll</legend>
					<div class="flex gap-4">
						<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="ja" bind:group={f.foilProtocol} />ja</label>
						<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="nein" bind:group={f.foilProtocol} />nein</label>
						<label class="flex items-center gap-2 text-ink-3"><input type="radio" class="accent-[var(--c-ink)]" value="" bind:group={f.foilProtocol} />offen</label>
					</div>
				</fieldset>
				<label class="block">
					<span class="field-label">Datum</span>
					<input class="input" type="date" disabled={!office} bind:value={f.signDate} />
				</label>
			</div>
			{#if saved.foilProtocol === 'ja'}
				<a href="/auftraege/{data.order.id}/arbeitsauftrag/folie" class="mt-4 flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-surface-2">
					<ClipboardCheck size={20} class="shrink-0 text-ink-3" aria-hidden="true" />
					<span class="min-w-0 flex-1">
						<span class="block font-medium">3M-Verlegeprotokoll</span>
						<span class="block text-sm text-ink-3">
							{saved.foil.signatures.auftraggeber
								? `Vom Auftraggeber anerkannt am ${dateTime(saved.foil.signatures.auftraggeber.at)}`
								: 'Eigenüberwachungs-Protokoll für Markierungsfolien – füllt die Partie aus'} · im PDF und Ausdruck hinter dem Arbeitsauftrag
						</span>
					</span>
					<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
				</a>
			{:else if f.foilProtocol === 'ja'}
				<p class="field-hint mt-3">Nach dem Speichern gibt es hier das 3M-Verlegeprotokoll zum Ausfüllen.</p>
			{/if}
			<div class="mt-4 grid gap-3 lg:grid-cols-3">
				<SignatureTile {...tile('bl')} />
				<SignatureTile {...tile('vorarbeiter')} />
				<SignatureTile {...tile('vertretung')} />
			</div>
		</section>

		<section class="card border-ok/40 p-4 lg:p-5">
			<h2 class="text-lg text-ok">Vorarbeiter-Checkliste</h2>
			<fieldset disabled={!site} class="mt-3 space-y-4">
				<div class="flex flex-wrap gap-x-6 gap-y-2">
					{#each CHECKLIST as k (k.key)}
						<label class="flex items-center gap-2.5">
							<input type="checkbox" class="size-5 accent-[var(--c-ok)]" bind:checked={f.checklist[k.key]} />{k.label}: ok
						</label>
					{/each}
				</div>
				<div>
					<p class="field-label text-danger">Nur bei Auffälligkeiten auszufüllen</p>
					<div class="space-y-2">
						{#each ISSUES as k (k.key)}
							<label class="flex items-start gap-2.5">
								<input type="checkbox" class="mt-0.5 size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={f.issues[k.key]} />{k.label}
							</label>
						{/each}
						<div class="flex items-center gap-2.5">
							<input type="checkbox" class="size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={f.issues.other} aria-label="Sonstige Auffälligkeit" />
							<input class="input input-sm" maxlength="120" placeholder="Sonstiges" bind:value={f.issues.otherText} oninput={() => (f.issues.other ||= !!f.issues.otherText.trim())} />
						</div>
						<div class="flex flex-wrap items-center gap-2.5">
							<label class="flex items-center gap-2.5">
								<input type="checkbox" class="size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={f.issues.extraHours} />Es gab Regiestunden, weil:
							</label>
							<input
								class="input input-sm min-w-[12rem] flex-1"
								maxlength="200"
								bind:value={f.issues.extraHoursReason}
								oninput={() => (f.issues.extraHours ||= !!f.issues.extraHoursReason.trim())}
								aria-label="Grund für die Regiestunden"
							/>
						</div>
					</div>
				</div>
			</fieldset>
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">Abschluss</h2>
			<div class="mt-3 grid gap-3 lg:grid-cols-[14rem_1fr] lg:items-start">
				<label class="block">
					<span class="field-label">Arbeit fertig am</span>
					<input class="input" type="date" disabled={!site} bind:value={f.finishedOn} />
				</label>
				<div>
					<SignatureTile {...tile('auftraggeber')} />
					{#if !data.locked && maySign('auftraggeber', data.scope)}
						<p class="field-hint mt-1">Nach der Unterschrift des Auftraggebers lässt sich der Arbeitsauftrag nicht mehr ändern.</p>
					{/if}
				</div>
			</div>
		</section>

		<WorkOrderBack bind:form={f} disabled={!office} />
	</div>

	{#if editable}
		<div class="card sticky bottom-24 mt-4 flex flex-wrap items-center gap-2 p-3 lg:bottom-6">
			<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Speichern'}</button>
			<span class="ml-auto text-sm text-ink-3">
				{data.work.updatedAt ? `Zuletzt gespeichert ${dateTime(data.work.updatedAt)}${data.work.updatedByName ? ` von ${data.work.updatedByName}` : ''}` : ''}
			</span>
		</div>
	{/if}
</form>

<section class="card mt-4 border-ok/40 p-4 lg:p-5">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-lg text-ok">Unterweisung der Mitarbeiter</h2>
		{#if site && saved.briefings.length < MAX_BRIEFINGS}
			<button type="button" class="btn btn-secondary btn-sm" disabled={busy} onclick={openBrief}>
				<UserCheck size={16} aria-hidden="true" />Mitarbeiter unterweisen
			</button>
		{/if}
	</div>
	<p class="mt-0.5 text-sm text-ink-3">Durch Vorarbeiter oder Bauleiter – jede Person unterschreibt am Gerät.</p>
	{#if saved.briefings.length}
		<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
			{#each saved.briefings as b, i (i)}
				<li class="flex flex-wrap items-center gap-3 px-3 py-2">
					<span class="num w-24 shrink-0 text-sm text-ink-2">{date(b.date)}</span>
					<span class="min-w-0 flex-1 font-medium">{b.name}</span>
					{#if b.signature}
						<svg viewBox="0 0 {SIGNATURE_WIDTH} {SIGNATURE_HEIGHT}" class="h-10 w-28 shrink-0 rounded-md bg-white" role="img" aria-label="Unterschrift {b.name}">
							<path d={b.signature} fill="none" stroke="#1d2127" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{/if}
					{#if site}
						<form method="POST" action="?/unbrief" use:enhance={() => async ({ update }) => update({ reset: false })}>
							<input type="hidden" name="nr" value={i} />
							<button class="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-danger" aria-label="Unterweisung {b.name} entfernen">
								<X size={16} />
							</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-ink-3">Noch niemand unterwiesen.</p>
	{/if}
</section>

{#if data.order.documents.length}
	<section class="card mt-4 p-4 lg:p-5">
		<h2 class="text-lg">Pläne und Unterlagen</h2>
		<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
			{#each data.order.documents as d (d.href)}
				<li>
					<a href="/auftraege/{data.order.id}/unterlagen/{d.href}" class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
						<FileText size={20} class="shrink-0 text-ink-3" aria-hidden="true" />
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{d.title}</span>
							<span class="block truncate text-[0.8125rem] text-ink-3">{d.fileName} · {fileSizeLabel(d.size)}</span>
						</span>
						<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if data.reports.length || data.canCreateReport}
	<section class="card mt-4 p-4 lg:p-5">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="flex items-center gap-2 text-lg"><NotebookPen size={18} aria-hidden="true" />Tagesberichte</h2>
			{#if data.canCreateReport}
				<a href="/tagesberichte?auftrag={data.order.id}" class="btn btn-secondary btn-sm"><Plus size={16} aria-hidden="true" />Neuer Tagesbericht</a>
			{/if}
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
								<span class="block truncate text-[0.8125rem] text-ink-3">{[r.site, r.partyName, r.dailyOutput].filter(Boolean).join(' · ')}</span>
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
{/if}

{#if data.scope.office}
	<div class="mt-4 flex justify-end">
		<button type="button" class="btn btn-ghost text-danger hover:bg-danger-soft" onclick={() => (deleteOpen = true)}>
			<Trash size={18} aria-hidden="true" />Arbeitsauftrag löschen
		</button>
	</div>
{/if}

<Dialog bind:open={signOpen} title={SIGNATURE_LABELS[signRole]}>
	<p class="text-ink-2">
		{signRole === 'auftraggeber'
			? 'Gib das Gerät dem Auftraggeber: Er trägt seinen Namen ein und unterschreibt. Danach lässt sich der Arbeitsauftrag nicht mehr ändern.'
			: 'Was im Formular steht, wird vorher gespeichert.'}
	</p>
	<label class="mt-4 block">
		<span class="field-label">Name</span>
		<input class="input" maxlength="120" autocomplete="off" bind:value={signName} />
	</label>
	<div class="mt-3"><SignaturePad bind:path={signPath} /></div>
	{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
	<div class="mt-4 flex flex-wrap justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (signOpen = false)}>Abbrechen</button>
		<button type="submit" form="aa" formaction="?/sign" class="btn btn-primary" disabled={busy || !signPath || signName.trim().length < 2}>
			<Signature size={18} aria-hidden="true" />Unterschrift speichern
		</button>
	</div>
</Dialog>

<Dialog bind:open={briefOpen} title="Mitarbeiter unterweisen">
	<p class="text-ink-2">Die Person trägt ihren Namen ein und bestätigt die Unterweisung mit ihrer Unterschrift.</p>
	<div class="mt-4 grid gap-3 sm:grid-cols-[1fr_11rem]">
		<label class="block">
			<span class="field-label">Name</span>
			<input class="input" maxlength="120" autocomplete="off" list="aa-crew" bind:value={briefName} />
		</label>
		<label class="block">
			<span class="field-label">Datum</span>
			<input class="input" type="date" bind:value={briefDate} />
		</label>
	</div>
	<datalist id="aa-crew">{#each data.crew as n (n)}<option value={n}></option>{/each}</datalist>
	<div class="mt-3"><SignaturePad bind:path={briefPath} /></div>
	{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
	<div class="mt-4 flex flex-wrap justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (briefOpen = false)}>Abbrechen</button>
		<button type="submit" form="aa" formaction="?/brief" class="btn btn-primary" disabled={busy || !briefPath || briefName.trim().length < 2 || !briefDate}>
			<UserCheck size={18} aria-hidden="true" />Unterweisung speichern
		</button>
	</div>
</Dialog>

<Dialog open={removeRole !== null} title="Unterschrift entfernen?" onclose={() => (removeRole = null)}>
	<p class="text-ink-2">
		{removeRole === 'auftraggeber'
			? 'Die Unterschrift des Auftraggebers wird entfernt – danach lässt sich der Arbeitsauftrag wieder ändern.'
			: `„${removeRole ? SIGNATURE_LABELS[removeRole] : ''}“ wird entfernt.`}
	</p>
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

<Dialog bind:open={deleteOpen} title="Arbeitsauftrag löschen?">
	<p class="text-ink-2">
		Der Arbeitsauftrag wird samt Unterschriften, Unterweisungen und Verlegeprotokoll gelöscht. Der Auftrag selbst bleibt – die Partie sieht ihn
		dann nicht mehr.
	</p>
	<form method="POST" action="?/delete" class="mt-5 flex justify-end gap-2" use:enhance>
		<button type="button" class="btn btn-ghost" onclick={() => (deleteOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary">Löschen</button>
	</form>
</Dialog>
