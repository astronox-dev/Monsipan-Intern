<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import FileText from '@lucide/svelte/icons/file-text';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import Trash from '@lucide/svelte/icons/trash';
	import Lock from '@lucide/svelte/icons/lock';
	import Signature from '@lucide/svelte/icons/signature';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import Dialog from '$lib/components/Dialog.svelte';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import SignaturePad from '$lib/modules/stunden/components/SignaturePad.svelte';
	import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '$lib/modules/stunden/signature';
	import { today } from '$lib/modules/stunden/week';
	import { parseAmount, quantityLabel, spacedNumber } from '$lib/modules/auftraege/offer';
	import {
		ATTACHMENTS,
		CHECKLIST,
		emptyLine,
		ISSUES,
		MAX_BRIEFINGS,
		MAX_WORK_LINES,
		maySign,
		SIGNATURE_LABELS,
		type SignatureRole,
		type WorkOrderContent,
		type WorkSignature
	} from '$lib/modules/auftraege/work-order';
	import { canonicalUnit, unitChoices } from '$lib/units';
	import { date, dateTime } from '$lib/format';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();

	/** Unterschriften und Unterweisungen kommen immer frisch vom Server */
	const saved = $derived(data.work.content);
	const office = $derived(data.scope.office && !data.locked);
	const site = $derived(data.scope.site && !data.locked);
	const editable = $derived(office || site);

	type LineIn = { key: number; text: string; kind: string; ral: string; msk: string; quantity: string; unit: string; done: string };
	let nextKey = 1;

	/** Das Formular gehört nach dem Öffnen der Seite – Mengen als Text zum Tippen */
	function toState(content: WorkOrderContent) {
		const { signatures: _s, briefings: _b, lines, ...rest } = structuredClone(content);
		return {
			...rest,
			lines: lines.map(
				(l): LineIn => ({
					key: nextKey++,
					text: l.text,
					kind: l.kind,
					ral: l.ral,
					msk: l.msk,
					quantity: quantityLabel(l.quantity),
					unit: canonicalUnit(data.units, l.unit),
					done: quantityLabel(l.done)
				})
			)
		};
	}
	// svelte-ignore state_referenced_locally
	let f = $state(toState(data.work.content));

	const payload = $derived(
		JSON.stringify({ ...f, lines: f.lines.map(({ key: _k, ...l }) => ({ ...l, quantity: parseAmount(l.quantity), done: parseAmount(l.done) })) })
	);

	function addLine() {
		if (f.lines.length >= MAX_WORK_LINES) return;
		const l = emptyLine();
		f.lines.push({ key: nextKey++, ...l, quantity: '', done: '' });
	}

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
</script>

<svelte:head><title>{pageTitle(`Arbeitsauftrag ${spacedNumber(data.order.number)}`)}</title></svelte:head>

<a href="/auftraege/{data.order.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Auftrag {spacedNumber(data.order.number)}
</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">Arbeitsauftrag</h1>
		<p class="text-ink-2">
			Nr. {spacedNumber(data.order.number)} · {data.order.title || 'Ohne BV'}{data.order.partyName ? ` · ${data.order.partyName}` : ''}
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		{#if data.locked}
			<span class="badge badge-ok"><Lock size={13} aria-hidden="true" />Vom Auftraggeber unterschrieben</span>
		{:else}
			<span class="badge">In Arbeit</span>
		{/if}
		<PdfButton href="/auftraege/{data.order.id}/arbeitsauftrag/pdf"><FileText size={18} aria-hidden="true" />PDF</PdfButton>
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

{#snippet signatureTile(role: SignatureRole, sig: WorkSignature | undefined)}
	{@const allowed = maySign(role, data.scope)}
	<div class="rounded-xl border border-line p-3">
		<p class="text-sm font-medium">{SIGNATURE_LABELS[role]}</p>
		{#if sig}
			<svg viewBox="0 0 {SIGNATURE_WIDTH} {SIGNATURE_HEIGHT}" class="mt-2 h-14 w-full max-w-[13rem] rounded-lg bg-white" role="img" aria-label="Unterschrift {sig.name}">
				<path d={sig.path} fill="none" stroke="#1d2127" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
				<p class="min-w-0 flex-1 text-sm text-ink-2"><span class="font-medium text-ink">{sig.name}</span> · {dateTime(sig.at)}</p>
				{#if allowed && (!data.locked || role === 'auftraggeber')}
					<button type="button" class="btn btn-ghost btn-sm -mr-2" onclick={() => (removeRole = role)}>Entfernen</button>
				{/if}
			</div>
		{:else if allowed && !data.locked}
			<button type="button" class="btn btn-secondary btn-sm mt-2" disabled={busy} onclick={() => openSign(role)}>
				<Signature size={16} aria-hidden="true" />Unterschreiben
			</button>
		{:else}
			<p class="mt-1 text-sm text-ink-3">Noch nicht unterschrieben.</p>
		{/if}
	</div>
{/snippet}

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
		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">Auftrag und Baustelle</h2>
			<p class="mt-0.5 text-sm text-ink-3">Füllt der Bauleiter aus.</p>
			<fieldset disabled={!office} class="mt-3 grid gap-3 sm:grid-cols-2">
				<label class="block sm:col-span-2">
					<span class="field-label">Auftrag</span>
					<input class="input" maxlength="200" bind:value={f.title} />
				</label>
				<label class="block sm:col-span-2">
					<span class="field-label">Baustelle</span>
					<input class="input" maxlength="200" bind:value={f.site} />
				</label>
				<label class="block">
					<span class="field-label">Ausführungsdatum</span>
					<input class="input" type="date" bind:value={f.startDate} />
				</label>
				<label class="block">
					<span class="field-label">Endtermin</span>
					<input class="input" type="date" bind:value={f.endDate} />
				</label>
				{#each f.contacts as k, i (i)}
					<label class="block">
						<span class="field-label">Kontaktperson {i + 1}</span>
						<input class="input" maxlength="100" bind:value={k.name} />
					</label>
					<label class="block">
						<span class="field-label">Telefon-Nr.</span>
						<input class="input" type="tel" maxlength="40" bind:value={k.phone} />
					</label>
				{/each}
			</fieldset>
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">Beilagen und Evaluierung</h2>
			<fieldset disabled={!office} class="mt-3 space-y-4">
				<div>
					<p class="field-label">Beilagen / Baustelleninformationen</p>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each ATTACHMENTS as a (a.key)}
							<label class="flex items-center gap-2.5">
								<input type="checkbox" class="size-5 accent-[var(--c-ink)]" bind:checked={f.attachments[a.key]} />{a.label}
							</label>
						{/each}
						<div class="flex items-center gap-2.5">
							<input type="checkbox" class="size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={f.attachments.other} aria-label="Sonstiges" />
							<input class="input input-sm" maxlength="80" placeholder="Sonstiges" bind:value={f.attachments.otherText} oninput={() => (f.attachments.other ||= !!f.attachments.otherText.trim())} />
						</div>
					</div>
				</div>
				<div>
					<p class="field-label">Evaluierung</p>
					<div class="flex flex-wrap gap-x-5 gap-y-2">
						<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="" bind:group={f.evaluation} />Keine Angabe</label>
						<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="standard" bind:group={f.evaluation} />Standardevaluierung</label>
						<label class="flex items-center gap-2">
							<input type="radio" class="accent-[var(--c-danger)]" value="baustelle" bind:group={f.evaluation} />Baustellenspezifische Evaluierung
							<span class="text-sm text-ink-3">(siehe Rückseite)</span>
						</label>
					</div>
				</div>
			</fieldset>
		</section>

		<section class="card overflow-hidden">
			<div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 lg:px-5">
				<div>
					<h2 class="text-lg">Beschreibung der Leistung</h2>
					<p class="mt-0.5 text-sm text-ink-3">Leistungen trägt der Bauleiter ein, die ausgeführte Menge die Partie.</p>
				</div>
				{#if office && f.lines.length < MAX_WORK_LINES}
					<button type="button" class="btn btn-secondary btn-sm" onclick={addLine}><Plus size={16} aria-hidden="true" />Leistung</button>
				{/if}
			</div>
			<div class="mt-3 lg:overflow-x-auto">
				<div class="hidden min-w-[56rem] gap-1.5 border-y border-line px-4 py-2 text-[0.75rem] text-ink-3 lg:grid lg:grid-cols-[minmax(12rem,1fr)_8rem_8rem_5rem_5.5rem_6.5rem_6.5rem_2rem] lg:px-5">
					<span>Beschreibung der Leistung</span><span>Art der Markierung</span><span>RAL Farbton</span><span>MSK</span>
					<span class="text-right">Ca. Menge</span><span>Einheit</span><span class="text-right">Ausgeführt</span><span></span>
				</div>
				{#each f.lines as l, i (l.key)}
					<div
						class="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 last:border-0 lg:min-w-[56rem] lg:grid-cols-[minmax(12rem,1fr)_8rem_8rem_5rem_5.5rem_6.5rem_6.5rem_2rem] lg:items-center lg:gap-1.5 lg:px-5 lg:py-2"
					>
						<label class="col-span-2 block lg:col-span-1">
							<span class="field-label lg:sr-only">Leistung {i + 1}</span>
							<input class="input input-sm" maxlength="200" disabled={!office} bind:value={l.text} />
						</label>
						<label class="block">
							<span class="field-label lg:sr-only">Art der Markierung</span>
							<input class="input input-sm" maxlength="60" list="aa-arten" disabled={!office} bind:value={l.kind} />
						</label>
						<label class="block">
							<span class="field-label lg:sr-only">RAL Farbton</span>
							<input class="input input-sm" maxlength="40" list="aa-ral" disabled={!office} bind:value={l.ral} />
						</label>
						<label class="block">
							<span class="field-label lg:sr-only">MSK</span>
							<input class="input input-sm" maxlength="30" disabled={!office} bind:value={l.msk} />
						</label>
						<label class="block">
							<span class="field-label lg:sr-only">Ca. Menge</span>
							<input class="input input-sm num text-right" inputmode="decimal" maxlength="14" disabled={!office} bind:value={l.quantity} />
						</label>
						<label class="block">
							<span class="field-label lg:sr-only">Einheit</span>
							<select class="select input-sm pr-8" disabled={!office} bind:value={l.unit}>
								<option value="">–</option>
								{#each unitChoices(data.units, l.unit) as u (u)}<option value={u}>{u}</option>{/each}
							</select>
						</label>
						<label class="block">
							<span class="field-label lg:sr-only">Ausgeführte Menge</span>
							<input class="input input-sm num text-right" inputmode="decimal" maxlength="14" placeholder={l.unit} disabled={!site} bind:value={l.done} />
						</label>
						{#if office}
							<button
								type="button"
								class="grid size-8 place-items-center self-end rounded-lg text-ink-3 hover:bg-surface-2 hover:text-danger lg:self-center"
								aria-label="Leistung {i + 1} entfernen"
								onclick={() => f.lines.splice(i, 1)}
							>
								<X size={16} />
							</button>
						{/if}
					</div>
				{:else}
					<p class="px-4 pb-4 text-sm text-ink-3 lg:px-5">Noch keine Leistung.</p>
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
			<div class="mt-4 grid gap-3 lg:grid-cols-3">
				{@render signatureTile('bl', saved.signatures.bl)}
				{@render signatureTile('vorarbeiter', saved.signatures.vorarbeiter)}
				{@render signatureTile('vertretung', saved.signatures.vertretung)}
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
					{@render signatureTile('auftraggeber', saved.signatures.auftraggeber)}
					{#if !data.locked && maySign('auftraggeber', data.scope)}
						<p class="field-hint mt-1">Nach der Unterschrift des Auftraggebers lässt sich der Arbeitsauftrag nicht mehr ändern.</p>
					{/if}
				</div>
			</div>
		</section>

		<section class="card p-4 lg:p-5">
			<h2 class="text-lg">Besonderheiten der Baustelle</h2>
			<p class="mt-0.5 text-sm text-ink-3">Rückseite – füllt der Bauleiter aus.</p>
			<fieldset disabled={!office} class="mt-3 grid gap-5 lg:grid-cols-2">
				{#each [{ title: 'Persönliche Schutzausrüstung', list: f.ppe }, { title: 'Besondere Gefahren', list: f.hazards }] as group (group.title)}
					<div>
						<p class="field-label">{group.title}</p>
						<div class="space-y-2">
							{#each group.list as item, i (i)}
								<div class="grid grid-cols-[1.25rem_minmax(7rem,auto)_1fr] items-center gap-2.5">
									<input type="checkbox" class="size-5 accent-[var(--c-ink)]" bind:checked={item.checked} aria-label={item.label || 'Weitere Zeile'} />
									{#if i < group.list.length - 2}
										<span>{item.label}:</span>
									{:else}
										<input class="input input-sm" maxlength="60" placeholder="Weitere" bind:value={item.label} aria-label="Bezeichnung" />
									{/if}
									<input
										class="input input-sm"
										maxlength="120"
										bind:value={item.detail}
										oninput={() => (item.checked ||= !!item.detail.trim())}
										aria-label="{item.label || 'Weitere'}: was genau"
									/>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</fieldset>
		</section>
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

{#if data.scope.office}
	<div class="mt-4 flex justify-end">
		<button type="button" class="btn btn-ghost text-danger hover:bg-danger-soft" onclick={() => (deleteOpen = true)}>
			<Trash size={18} aria-hidden="true" />Arbeitsauftrag löschen
		</button>
	</div>
{/if}

<datalist id="aa-ral">{#each data.colors as c (`${c.ral} ${c.name}`)}<option value={c.ral}>{c.name}</option>{/each}</datalist>
<datalist id="aa-arten">
	{#each ['Farbe', 'Kaltplastik', 'Heißplastik', 'Folie', 'Agglomerat'] as a (a)}<option value={a}></option>{/each}
</datalist>

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
	<p class="text-ink-2">Der Arbeitsauftrag wird samt Unterschriften und Unterweisungen gelöscht. Der Auftrag selbst bleibt.</p>
	<form method="POST" action="?/delete" class="mt-5 flex justify-end gap-2" use:enhance>
		<button type="button" class="btn btn-ghost" onclick={() => (deleteOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary">Löschen</button>
	</form>
</Dialog>
