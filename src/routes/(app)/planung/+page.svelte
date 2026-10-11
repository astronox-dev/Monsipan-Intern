<script lang="ts">
	/**
	 * Wochenplanung wie der Zettel: je Partie eine Spalte, je Tag eine Zeile.
	 * In den Feldern Aufträge oder freier Text; Urlaub und Krankenstand der Leute
	 * stehen von selbst dabei. Darunter – nur fürs Büro – die Notizliste.
	 * Wer nur die eigene Partie sieht, bekommt die Woche als Liste.
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plus from '@lucide/svelte/icons/plus';
	import Send from '@lucide/svelte/icons/send';
	import Trash from '@lucide/svelte/icons/trash';
	import TreePalm from '@lucide/svelte/icons/tree-palm';
	import Thermometer from '@lucide/svelte/icons/thermometer';
	import X from '@lucide/svelte/icons/x';
	import Pencil from '@lucide/svelte/icons/pencil';
	import FileText from '@lucide/svelte/icons/file-text';
	import Printer from '@lucide/svelte/icons/printer';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { addDays, isoWeek } from '$lib/modules/stunden/week';
	import { holidayName } from '$lib/modules/planung/days';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();

	const DAY = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
	const kw = $derived(isoWeek(data.weekStart));
	const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
	const range = $derived(`${short(data.days[0])} – ${short(data.days[6])}${data.days[6].slice(0, 4)}`);
	const isThisWeek = $derived(data.days.includes(data.today));

	type Entry = (typeof data.entries)[number];
	const cell = (partyId: number, day: string) => data.entries.filter((e) => e.partyId === partyId && e.date === day);
	const away = (partyId: number, day: string) => data.absences.filter((a) => a.partyId === partyId && a.from <= day && (a.to ?? '9999-12-31') >= day);
	const label = (e: Entry) => (e.orderId ? e.orderLocation || e.orderTitle || `Auftrag ${spacedNumber(e.orderNumber ?? '')}` : e.text);

	/* ------------------------------------------------ Dialog Eintrag */
	let open = $state(false);
	let busy = $state(false);
	let editing = $state<Entry | null>(null);
	let partyId = $state('');
	let date = $state('');
	let days = $state<string[]>([]);
	let orderId = $state('');
	let text = $state('');

	function openNew(p: number, day: string) {
		editing = null;
		partyId = String(p);
		days = [day];
		date = day;
		orderId = '';
		text = '';
		open = true;
	}
	function openEdit(e: Entry) {
		editing = e;
		partyId = String(e.partyId);
		date = e.date;
		days = [e.date];
		orderId = e.orderId ? String(e.orderId) : '';
		text = e.orderId ? e.text : e.text;
		open = true;
	}
	/** Aufträge der gewählten Partie zuerst */
	const ownOrders = $derived(data.orders.filter((o) => String(o.partyId) === partyId));
	const otherOrders = $derived(data.orders.filter((o) => String(o.partyId) !== partyId));
	const orderLabel = (o: (typeof data.orders)[number]) =>
		`${spacedNumber(o.number)} · ${[o.location, o.title].filter(Boolean).join(' – ') || 'ohne Bezeichnung'}${o.status === 'abgeschlossen' ? ' (abgeschlossen)' : ''}`;

	const after = (msg: string) => () => {
		busy = true;
		return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
			busy = false;
			if (result.type === 'success') {
				open = false;
				if (msg) toast.success(msg);
			}
			await update();
		};
	};

	/* ------------------------------------------------ Notizen */
	let noteText = $state('');
	let editNote = $state<number | null>(null);
	let showDone = $state(false);
	const openNotes = $derived(data.notes.filter((n) => !n.done));
	const doneNotes = $derived(data.notes.filter((n) => n.done));
</script>

<svelte:head><title>{pageTitle(`Wochenplanung KW ${kw.week}`)}</title></svelte:head>

<div class="mt-1 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><CalendarDays size={26} aria-hidden="true" />Wochenplanung</h1>
		<p class="text-ink-2">{data.all ? 'Alle Partien' : (data.parties[0]?.name ?? 'Keine Partie')} · KW {kw.week} · {range}</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<a href="?woche={addDays(data.weekStart, -7)}" class="btn btn-secondary btn-sm" aria-label="Vorige Woche"><ChevronLeft size={16} aria-hidden="true" />KW {isoWeek(addDays(data.weekStart, -7)).week}</a>
		{#if !isThisWeek}<a href="?" class="btn btn-ghost btn-sm">Diese Woche</a>{/if}
		<a href="?woche={addDays(data.weekStart, 7)}" class="btn btn-secondary btn-sm" aria-label="Nächste Woche">KW {isoWeek(addDays(data.weekStart, 7)).week}<ChevronRight size={16} aria-hidden="true" /></a>
		{#if data.parties.length}
			<PdfButton href="/planung/pdf?woche={data.weekStart}" class="btn btn-secondary btn-sm"><FileText size={16} aria-hidden="true" />PDF</PdfButton>
			<a href="/planung/druck?woche={data.weekStart}" class="btn btn-secondary btn-sm"><Printer size={16} aria-hidden="true" />Drucken</a>
		{/if}
		{#if data.canEdit && data.entries.length}
			<form
				method="POST"
				action="?/send"
				use:enhance={() =>
					async ({ result, update }) => {
						if (result.type === 'success') {
							const n = (result.data as { sent?: number })?.sent ?? 0;
							toast.success(n ? `An ${n} ${n === 1 ? 'Partie' : 'Partien'} geschickt` : 'Keine Partie mit Einträgen');
						}
						await update();
					}}
			>
				<input type="hidden" name="woche" value={data.weekStart} />
				<button class="btn btn-primary btn-sm" title="Jede Partie mit Einträgen bekommt eine Benachrichtigung"><Send size={16} aria-hidden="true" />An die Partien schicken</button>
			</form>
		{/if}
	</div>
</div>

{#if form && 'message' in form && form.message && !open}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>{/if}

{#snippet entryChip(e: Entry)}
	{@const main = label(e)}
	{#if data.canEdit}
		<button type="button" class="chip" onclick={() => openEdit(e)} title="Ändern">
			<span class="block font-medium">{main}</span>
			{#if e.orderId}<span class="num block text-[0.6875rem] text-ink-3">{spacedNumber(e.orderNumber ?? '')}{e.text ? ` · ${e.text}` : ''}</span>{/if}
		</button>
	{:else if e.orderId && data.canOpenOrders}
		<a href="/auftraege/{e.orderId}" class="chip">
			<span class="block font-medium">{main}</span>
			<span class="num block text-[0.6875rem] text-ink-3">{spacedNumber(e.orderNumber ?? '')}{e.text ? ` · ${e.text}` : ''}</span>
		</a>
	{:else}
		<span class="chip">
			<span class="block font-medium">{main}</span>
			{#if e.orderId && e.text}<span class="block text-[0.6875rem] text-ink-3">{e.text}</span>{/if}
		</span>
	{/if}
{/snippet}

{#snippet absence(a: (typeof data.absences)[number])}
	<span class="away {a.kind}">
		{#if a.kind === 'urlaub'}<TreePalm size={12} aria-hidden="true" />{:else}<Thermometer size={12} aria-hidden="true" />{/if}
		{a.name}
		<span class="sr-only">{a.kind === 'urlaub' ? 'Urlaub' : a.kind === 'krank' ? 'Krankenstand' : 'abwesend'}</span>
	</span>
{/snippet}

{#if !data.parties.length}
	<div class="card p-8 text-center">
		<p class="font-medium">Keine Partie</p>
		<p class="mt-1 text-sm text-ink-3">{data.all ? 'Unter Stammdaten → Partien anlegen.' : 'Du bist keiner Partie zugeordnet – die Planung sieht man über die eigene Partie.'}</p>
	</div>
{:else if !data.all && data.parties.length === 1}
	<!-- Eigene Partie: die Woche als Liste -->
	{@const p = data.parties[0]}
	<ul class="space-y-2">
		{#each data.days as day, i (day)}
			{@const items = cell(p.id, day)}
			{@const off = away(p.id, day)}
			{@const holiday = holidayName(day)}
			<li class="card p-3 {day === data.today ? 'border-ink' : ''} {i >= 5 && !items.length ? 'opacity-70' : ''}">
				<div class="flex items-baseline gap-2">
					<span class="font-display text-lg font-semibold">{DAY[i]}</span>
					<span class="num text-ink-2">{short(day)}</span>
					{#if day === data.today}<span class="badge badge-info">Heute</span>{/if}
					{#if holiday}<span class="text-sm text-danger">{holiday}</span>{/if}
				</div>
				{#if items.length || off.length}
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each items as e (e.id)}{@render entryChip(e)}{/each}
						{#each off as a, n (n)}{@render absence(a)}{/each}
					</div>
				{:else}
					<p class="mt-1 text-sm text-ink-3">Nichts eingeplant</p>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<div class="card relative overflow-x-auto">
		<table class="plan w-full border-collapse text-sm" style="min-width: {6 + data.parties.length * 10}rem">
			<thead>
				<tr class="border-b border-line">
					<th scope="col" class="sticky left-0 z-10 w-24 bg-surface px-3 py-2 text-left align-bottom">KW {kw.week}</th>
					{#each data.parties as p (p.id)}
						<th scope="col" class="px-2 py-2 text-left align-bottom">
							<span class="block font-semibold">{p.name}</span>
							<span class="block text-[0.6875rem] font-normal text-ink-3">{p.members.map((m) => m.name).join(' · ')}</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.days as day, i (day)}
					{@const holiday = holidayName(day)}
					<tr class="border-b border-line align-top {day === data.today ? 'today' : ''} {i >= 5 ? 'weekend' : ''}">
						<th scope="row" class="sticky left-0 z-10 bg-surface px-3 py-2 text-left">
							<span class="block font-display text-base font-semibold">{DAY[i]}</span>
							<span class="num block text-[0.75rem] font-normal text-ink-2">{short(day)}</span>
							{#if holiday}<span class="block text-[0.6875rem] font-normal text-danger">{holiday}</span>{/if}
						</th>
						{#each data.parties as p (p.id)}
							{@const items = cell(p.id, day)}
							{@const off = away(p.id, day)}
							<td class="group px-1.5 py-1.5">
								<div class="flex min-h-10 flex-col gap-1">
									{#each items as e (e.id)}{@render entryChip(e)}{/each}
									{#if off.length}<div class="flex flex-wrap gap-1">{#each off as a, n (n)}{@render absence(a)}{/each}</div>{/if}
									{#if data.canEdit}
										<button
											type="button"
											class="add mt-auto grid h-7 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink"
											aria-label="{p.name}, {DAY[i]} {short(day)}: eintragen"
											onclick={() => openNew(p.id, day)}
										>
											<Plus size={15} aria-hidden="true" />
										</button>
									{/if}
								</div>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="mt-2 text-[0.8125rem] text-ink-3">
		<TreePalm size={12} class="inline" aria-hidden="true" /> Urlaub (genehmigt) · <Thermometer size={12} class="inline" aria-hidden="true" /> Krankenstand – kommen von selbst aus Urlaub und Krankenstand.
	</p>
{/if}

{#if data.all}
	<section class="card mt-5 p-4 lg:p-5">
		<h2 class="text-lg">Notizen</h2>
		<p class="mt-1 text-sm text-ink-2">Noch einzuplanen und Sonstiges – bleibt stehen, bis es abgehakt ist. Die Partien sehen das nicht.</p>
		{#if openNotes.length}
			<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
				{#each openNotes as n (n.id)}
					<li class="flex items-start gap-2 px-3 py-2">
						{#if data.canEdit}
							<form method="POST" action="?/noteDone" use:enhance class="pt-0.5">
								<input type="hidden" name="id" value={n.id} />
								<input type="hidden" name="erledigt" value="ja" />
								<button class="grid size-5 place-items-center rounded border border-line-strong hover:bg-surface-3" aria-label="„{n.text}“ als erledigt abhaken"></button>
							</form>
						{/if}
						{#if editNote === n.id}
							<form
								method="POST"
								action="?/noteEdit"
								class="flex min-w-0 flex-1 gap-2"
								use:enhance={() => async ({ result, update }) => {
									if (result.type === 'success') editNote = null;
									await update();
								}}
							>
								<input type="hidden" name="id" value={n.id} />
								<!-- svelte-ignore a11y_autofocus -->
								<input class="input input-sm min-w-0 flex-1" name="text" value={n.text} maxlength="500" autofocus />
								<button class="btn btn-primary btn-sm">Speichern</button>
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => (editNote = null)}>Abbrechen</button>
							</form>
						{:else}
							<span class="min-w-0 flex-1 py-0.5">{n.text}</span>
							{#if data.canEdit}
								<button type="button" class="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Notiz ändern" onclick={() => (editNote = n.id)}><Pencil size={14} /></button>
								<form method="POST" action="?/noteRemove" use:enhance>
									<input type="hidden" name="id" value={n.id} />
									<button class="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-danger" aria-label="Notiz löschen"><X size={15} /></button>
								</form>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-3 text-sm text-ink-3">Keine offenen Notizen.</p>
		{/if}
		{#if data.canEdit}
			<form
				method="POST"
				action="?/note"
				class="mt-3 flex gap-2"
				use:enhance={() => async ({ result, update }) => {
					if (result.type === 'success') noteText = '';
					await update({ reset: false });
				}}
			>
				<input class="input min-w-0 flex-1" name="text" maxlength="500" placeholder="z. B. Pittel GG-LKW-Stellplatz?" bind:value={noteText} />
				<button class="btn btn-secondary" disabled={!noteText.trim()}><Plus size={16} aria-hidden="true" />Notiz</button>
			</form>
		{/if}
		{#if doneNotes.length}
			<button type="button" class="btn btn-ghost btn-sm mt-3" onclick={() => (showDone = !showDone)}>{showDone ? 'Erledigte ausblenden' : `Erledigte (${doneNotes.length})`}</button>
			{#if showDone}
				<ul class="mt-1 space-y-1">
					{#each doneNotes as n (n.id)}
						<li class="flex items-center gap-2 text-sm text-ink-3">
							<span class="min-w-0 flex-1 line-through">{n.text}</span>
							{#if data.canEdit}
								<form method="POST" action="?/noteDone" use:enhance>
									<input type="hidden" name="id" value={n.id} />
									<input type="hidden" name="erledigt" value="nein" />
									<button class="btn btn-ghost btn-sm">Wieder offen</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>
{/if}

{#if data.canEdit}
	<Dialog bind:open title={editing ? 'Eintrag ändern' : 'Eintragen'} onclose={() => (open = false)}>
		<form method="POST" action={editing ? '?/update' : '?/add'} class="space-y-3" use:enhance={after(editing ? 'Gespeichert' : '')}>
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<label class="block">
				<span class="field-label">Partie</span>
				<select class="select" name="partie" bind:value={partyId} required>
					{#each data.parties as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
				</select>
			</label>
			{#if editing}
				<label class="block">
					<span class="field-label">Tag</span>
					<select class="select" name="datum" bind:value={date}>
						{#each data.days as d, i (d)}<option value={d}>{DAY[i]} {short(d)}</option>{/each}
					</select>
				</label>
			{:else}
				<fieldset>
					<legend class="field-label">Tage <span class="text-ink-3">– auch mehrere</span></legend>
					<div class="flex flex-wrap gap-1.5">
						{#each data.days as d, i (d)}
							<label class="day-pick">
								<input type="checkbox" name="tage" value={d} bind:group={days} class="sr-only" />
								<span>{DAY[i]}<span class="num block text-[0.6875rem]">{short(d)}</span></span>
							</label>
						{/each}
					</div>
				</fieldset>
			{/if}
			<label class="block">
				<span class="field-label">Auftrag</span>
				<select class="select" name="auftrag" bind:value={orderId}>
					<option value="">Ohne Auftrag – nur Text</option>
					{#if ownOrders.length}
						<optgroup label="Aufträge dieser Partie">
							{#each ownOrders as o (o.id)}<option value={String(o.id)}>{orderLabel(o)}</option>{/each}
						</optgroup>
					{/if}
					{#if otherOrders.length}
						<optgroup label={ownOrders.length ? 'Andere Aufträge' : 'Aufträge'}>
							{#each otherOrders as o (o.id)}<option value={String(o.id)}>{orderLabel(o)}</option>{/each}
						</optgroup>
					{/if}
				</select>
			</label>
			<label class="block">
				<span class="field-label">{orderId ? 'Zusatz' : 'Text'}{orderId ? '' : ' *'}</span>
				<input class="input" name="text" maxlength="200" bind:value={text} placeholder={orderId ? 'z. B. 14:00 – 16:00' : 'z. B. Stbe 1, Leitschutz?, Lager'} required={!orderId} />
			</label>
			{#if form && 'message' in form && form.message}<p class="text-sm text-danger" role="alert">{form.message}</p>{/if}
			<div class="flex flex-wrap items-center gap-2 pt-1">
				<button class="btn btn-primary" disabled={busy || (!editing && !days.length)}>{editing ? 'Speichern' : days.length > 1 ? `An ${days.length} Tagen eintragen` : 'Eintragen'}</button>
				<button type="button" class="btn btn-ghost" onclick={() => (open = false)}>Abbrechen</button>
			</div>
		</form>
		{#if editing}
			<form method="POST" action="?/remove" class="mt-3 border-t border-line pt-3" use:enhance={after('Gelöscht')}>
				<input type="hidden" name="id" value={editing.id} />
				<button class="btn btn-ghost btn-sm text-danger hover:bg-danger-soft" disabled={busy}><Trash size={15} aria-hidden="true" />Eintrag löschen</button>
			</form>
		{/if}
	</Dialog>
{/if}

<style>
	.chip {
		display: block;
		width: 100%;
		text-align: left;
		border-radius: 0.5rem;
		border: 1px solid var(--c-line);
		background: var(--c-surface-2);
		padding: 0.25rem 0.5rem;
		line-height: 1.25;
		font-size: 0.8125rem;
	}
	button.chip:hover,
	a.chip:hover {
		border-color: var(--c-line-strong);
		background: var(--c-surface-3);
	}
	.away {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border-radius: 999px;
		padding: 0.0625rem 0.5rem;
		font-size: 0.75rem;
		background: var(--c-surface-3);
		color: var(--c-ink-2);
	}
	.away.urlaub {
		background: color-mix(in srgb, var(--c-ok, #2e7d32) 16%, transparent);
	}
	.away.krank {
		background: color-mix(in srgb, var(--c-warn, #b26a00) 18%, transparent);
	}
	.plan :global(td),
	.plan :global(th) {
		border-right: 1px solid var(--c-line);
	}
	.plan tr.today :global(th),
	.plan tr.today :global(td) {
		background: color-mix(in srgb, var(--c-ink) 5%, var(--c-surface));
	}
	.plan tr.weekend :global(th) {
		opacity: 0.75;
	}
	/* Das Plus nur zeigen, wo es gebraucht wird – am Handy immer */
	@media (hover: hover) {
		.plan td .add {
			opacity: 0;
		}
		.plan td:hover .add,
		.plan td .add:focus-visible {
			opacity: 1;
		}
	}
	.day-pick > span {
		display: block;
		min-width: 3.25rem;
		border-radius: 0.625rem;
		border: 1px solid var(--c-line);
		padding: 0.375rem 0.5rem;
		text-align: center;
		cursor: pointer;
		font-weight: 600;
	}
	.day-pick input:checked + span {
		background: var(--c-ink);
		color: var(--c-surface);
		border-color: var(--c-ink);
	}
	.day-pick input:focus-visible + span {
		outline: 2px solid var(--c-ink);
		outline-offset: 2px;
	}
</style>
