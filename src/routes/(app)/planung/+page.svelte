<script lang="ts">
	/**
	 * Wochenplanung wie der Zettel: je Partie eine Spalte, je Tag eine Zeile.
	 * In den Feldern Aufträge oder freier Text; Urlaub und Krankenstand der Leute
	 * stehen von selbst dabei. Darunter – nur fürs Büro – die Aufträge ohne
	 * Partie (beim Einplanen werden sie zugeteilt) und die Notizliste.
	 * Wer nur die eigene Partie sieht, bekommt die Woche als Liste.
	 *
	 * Ziehen und Ablegen (wer bearbeiten darf): Spalten am Griff umordnen,
	 * Einträge auf ein anderes Feld, Leute auf eine andere Spalte (die Woche)
	 * oder in ein Feld (nur dieser Tag). Ein Klick auf einen Namen teilt ihn
	 * über den Dialog ein – auch ohne Ziehen, etwa mit der Tastatur.
	 */
	import { pageTitle } from '$lib/app';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { draggable, dropzone, type DragItem } from '$lib/dnd';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
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
	import HardHat from '@lucide/svelte/icons/hard-hat';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { addDays, isoWeek } from '$lib/modules/stunden/week';
	import { holidayName, rangeLabel } from '$lib/modules/planung/days';
	import { ORDER_STATUS_LABELS, spacedNumber } from '$lib/modules/auftraege/offer';
	import { date as dateLabel } from '$lib/format';

	let { data, form } = $props();

	const DAY = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
	const kw = $derived(isoWeek(data.weekStart));
	const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
	const range = $derived(`${short(data.days[0])} – ${short(data.days[6])}${data.days[6].slice(0, 4)}`);
	const isThisWeek = $derived(data.days.includes(data.today));

	type Entry = (typeof data.entries)[number];
	const cell = (partyId: number, day: string) => data.entries.filter((e) => e.partyId === partyId && e.date === day);
	const away = (partyId: number, day: string) => {
		const all = data.absences.filter((a) => a.partyId === partyId && a.from <= day && (a.to ?? '9999-12-31') >= day);
		// Krankenstand unterbricht den Urlaub – dann steht nur er da
		return all.filter((a) => a.kind !== 'urlaub' || !all.some((b) => b.userId === a.userId && b.kind !== 'urlaub'));
	};
	const label = (e: Entry) => (e.orderId ? e.orderLocation || e.orderTitle || `Auftrag ${spacedNumber(e.orderNumber ?? '')}` : e.text);
	/** Wer an diesem Tag aus einer anderen Spalte hier aushilft – und wer von hier woanders ist */
	const guests = (partyId: number, day: string) => data.dayMoves.filter((m) => m.partyId === partyId && m.date === day);
	const elsewhere = (partyId: number, day: string) => data.dayMoves.filter((m) => m.fromPartyId === partyId && m.date === day);
	const nameOfParty = (id: number) => data.parties.find((p) => p.id === id)?.name ?? '';
	const dayName = (day: string) => `${DAY[data.days.indexOf(day)] ?? ''} ${short(day)}`;

	/* ------------------------------------------------ Ziehen und Ablegen */
	type EntryDrag = { id: number; partyId: number; date: string };
	type PersonDrag = { userId: number; name: string; weekParty: number; day?: string };
	type OrderDrag = { id: number; number: string };

	/** Die Partie sieht einen Auftrag erst mit seinem Arbeitsauftrag */
	const assignedHint = (how: unknown) =>
		how === 'sichtbar' ? 'Die Partie bekommt dazu eine Benachrichtigung.' : 'Die Partie sieht ihn, sobald es den Arbeitsauftrag gibt.';

	/** Aktion ohne Formular abschicken, danach neu laden */
	async function post(action: string, fields: Record<string, string | number | (string | number)[]>, ok?: string) {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) body.append(key, String(v));
		const res = await fetch(`?/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		if (result.type === 'failure') toast.error(String(result.data?.message ?? 'Das hat nicht geklappt.'));
		else if (result.type === 'error') toast.error('Das hat nicht geklappt – bitte noch einmal versuchen.');
		else if (result.type === 'success' && result.data?.assigned) toast.success(ok ?? 'Auftrag ist jetzt dieser Partie zugeteilt', assignedHint(result.data.assigned));
		else if (ok) toast.success(ok);
		await invalidateAll();
	}

	/**
	 * Ins Feld: ein Eintrag (vor den Eintrag, auf dem er landet), eine Person
	 * für diesen Tag oder ein nicht zugeteilter Auftrag – der wird an diesem Tag
	 * eingeplant und der Partie zugeteilt.
	 */
	const dropOnCell = (partyId: number, day: string) => (item: DragItem, at: { target: Element }) => {
		if (item.kind === 'order') {
			const o = item.data as OrderDrag;
			post('add', { partie: partyId, tage: day, auftrag: o.id, text: '' }, `Auftrag ${spacedNumber(o.number)}: ${dayName(day)} bei ${nameOfParty(partyId)}`);
		} else if (item.kind === 'entry') {
			const e = item.data as EntryDrag;
			const before = (at.target.closest('[data-entry]') as HTMLElement | null)?.dataset.entry;
			const beforeId = before ? Number(before) : null;
			if (beforeId === e.id) return;
			post('move', { id: e.id, datum: day, partie: partyId, ...(beforeId ? { vor: beforeId } : {}) });
		} else if (item.kind === 'person') {
			const m = item.data as PersonDrag;
			if (m.day === day && m.weekParty === partyId) return;
			post('crew', { person: m.userId, partie: partyId, tag: day }, `${m.name}: ${dayName(day)} bei ${nameOfParty(partyId)}`);
		}
	};

	/** In den Spaltenkopf: eine Person für die ganze Woche – oder eine Spalte an diese Stelle */
	const dropOnHead = (partyId: number) => (item: DragItem, at: { x: number; zone: Element }) => {
		if (item.kind === 'person') {
			const m = item.data as PersonDrag;
			if (!m.day && m.weekParty === partyId) return;
			post('crew', { person: m.userId, partie: partyId, woche: data.weekStart }, `${m.name} ist diese Woche bei ${nameOfParty(partyId)}`);
		} else if (item.kind === 'party') {
			const moved = (item.data as { id: number }).id;
			if (moved === partyId) return;
			const ids = data.parties.map((p) => p.id).filter((id) => id !== moved);
			const r = at.zone.getBoundingClientRect();
			const index = ids.indexOf(partyId) + (at.x > r.left + r.width / 2 ? 1 : 0);
			ids.splice(index, 0, moved);
			post('order', { partie: ids });
		}
	};

	/** Spalte mit der Tastatur verschieben: Pfeil links/rechts am Griff */
	function columnKey(e: KeyboardEvent, partyId: number) {
		const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
		if (!step) return;
		e.preventDefault();
		const ids = data.parties.map((p) => p.id);
		const i = ids.indexOf(partyId);
		const j = i + step;
		if (j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		post('order', { partie: ids });
	}

	/* ------------------------------------------------ Dialog Person einteilen */
	let crewOpen = $state(false);
	let crewPerson = $state<{ userId: number; name: string; weekParty: number; fromName: string | null } | null>(null);
	let crewWhen = $state('woche');
	let crewParty = $state('');
	function openCrew(person: { userId: number; name: string; weekParty: number; fromName: string | null }, when = 'woche', party = person.weekParty) {
		crewPerson = person;
		crewWhen = when;
		crewParty = String(party);
		crewOpen = true;
	}

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
	/** Nicht zugeteilten Auftrag einplanen – Partie und Tage wählt man im Dialog */
	function openPlan(o: (typeof data.unassigned)[number]) {
		editing = null;
		partyId = '';
		days = [];
		date = '';
		orderId = String(o.id);
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
	/** Aufträge der gewählten Partie zuerst, dann die noch nicht zugeteilten */
	const ownOrders = $derived(data.orders.filter((o) => o.partyId != null && String(o.partyId) === partyId));
	const freeOrders = $derived(data.orders.filter((o) => o.partyId == null));
	const otherOrders = $derived(data.orders.filter((o) => o.partyId != null && String(o.partyId) !== partyId));
	/** Wird der gewählte Auftrag mit dem Eintragen zugeteilt? */
	const claims = $derived(!!orderId && freeOrders.some((o) => String(o.id) === orderId));
	const partyName = $derived(data.parties.find((p) => String(p.id) === partyId)?.name ?? '');
	const orderLabel = (o: (typeof data.orders)[number]) =>
		`${spacedNumber(o.number)} · ${[o.location, o.title].filter(Boolean).join(' – ') || 'ohne Bezeichnung'}${o.status === 'abgeschlossen' ? ' (abgeschlossen)' : ''}`;

	const after = (msg: string) => () => {
		busy = true;
		const name = partyName;
		return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: () => Promise<void> }) => {
			busy = false;
			if (result.type === 'success') {
				open = false;
				if (result.data?.assigned) toast.success(`Auftrag ist jetzt bei ${name}`, assignedHint(result.data.assigned));
				else if (msg) toast.success(msg);
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
		<button
			type="button"
			class="chip"
			data-entry={e.id}
			onclick={() => openEdit(e)}
			title="Ändern – oder auf ein anderes Feld ziehen"
			use:draggable={{ kind: 'entry', data: { id: e.id, partyId: e.partyId, date: e.date } satisfies EntryDrag }}
		>
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
{:else if !data.all}
	<!--
		Eigene Partie: die Woche als Liste. Wer laut Planung bei einer anderen
		Partie aushilft, sieht deren Einträge an genau diesen Tagen dazu.
	-->
	{@const multi = data.parties.length > 1}
	{#each data.parties as p (p.id)}
		{#if p.members.length}
			<p class="mb-1.5 text-sm text-ink-2">
				{multi ? `${p.name}: ` : 'Diese Woche: '}{p.members.map((m) => (m.fromName ? `${m.name} (aus ${m.fromName})` : m.name)).join(' · ')}
			</p>
		{/if}
	{/each}
	<ul class="mt-3 space-y-2">
		{#each data.days as day, i (day)}
			{@const holiday = holidayName(day)}
			{@const filled = (pid: number) => !!(cell(pid, day).length || away(pid, day).length || guests(pid, day).length || elsewhere(pid, day).length)}
			<!-- Die eigene Partie, wenn dort etwas steht; die Partie, bei der man aushilft, an ihren Tagen immer -->
			{@const here = data.parties.filter((p) => (p.id in data.guestDays ? data.guestDays[p.id].includes(day) : filled(p.id)))}
			{@const empty = !here.length}
			<li class="card p-3 {day === data.today ? 'border-ink' : ''} {i >= 5 && empty ? 'opacity-70' : ''}">
				<div class="flex items-baseline gap-2">
					<span class="font-display text-lg font-semibold">{DAY[i]}</span>
					<span class="num text-ink-2">{short(day)}</span>
					{#if day === data.today}<span class="badge badge-info">Heute</span>{/if}
					{#if holiday}<span class="text-sm text-danger">{holiday}</span>{/if}
				</div>
				{#each here as p (p.id)}
					{@const items = cell(p.id, day)}
					{@const off = away(p.id, day)}
					{@const help = guests(p.id, day)}
					{@const gone = elsewhere(p.id, day)}
					{#if p.id in data.guestDays}
						<p class="mt-2 flex items-center gap-1.5 text-[0.8125rem] font-semibold text-info">
							<ArrowRightLeft size={13} aria-hidden="true" />Du bist bei {p.name} eingeteilt
						</p>
					{:else if multi}
						<p class="mt-2 text-[0.8125rem] font-medium text-ink-2">{p.name}</p>
					{/if}
					{#if items.length || off.length || help.length || gone.length}
						<div class="mt-1.5 flex flex-wrap gap-1.5">
							{#each items as e (e.id)}{@render entryChip(e)}{/each}
							{#each off as a, n (n)}{@render absence(a)}{/each}
							{#each help as m (m.userId)}<span class="person guest"><ArrowRightLeft size={12} aria-hidden="true" />{m.name} (aus {m.fromPartyName})</span>{/each}
							{#each gone as m (m.userId)}<span class="person gone">{m.name} bei {m.partyName}</span>{/each}
						</div>
					{:else}
						<p class="mt-1 text-sm text-ink-3">Nichts eingeplant</p>
					{/if}
				{:else}
					<p class="mt-1 text-sm text-ink-3">Nichts eingeplant</p>
				{/each}
			</li>
		{/each}
	</ul>
{:else}
	<div class="card relative overflow-x-auto" data-dnd-scroll>
		<!-- Feste Spalten: alle Partien teilen sich die Breite; erst wenn es zu schmal wird, wird gescrollt -->
		<table class="plan w-full table-fixed border-collapse text-sm" style="min-width: {4.5 + data.parties.length * 7.25}rem">
			<thead>
				<tr class="border-b border-line">
					<th scope="col" class="sticky left-0 z-10 w-[4.5rem] bg-surface px-2.5 py-2 text-left align-bottom">KW {kw.week}</th>
					{#each data.parties as p (p.id)}
						<th scope="col" class="head px-2 py-2 text-left align-bottom" use:dropzone={{ accepts: ['person', 'party'], onDrop: dropOnHead(p.id), disabled: !data.canEdit }}>
							<span class="flex items-center gap-1">
								{#if data.canEdit}
									<button
										type="button"
										class="grip -ml-1 grid h-6 w-5 shrink-0 cursor-grab place-items-center rounded text-ink-3 hover:bg-surface-3 hover:text-ink"
										aria-label="Spalte {p.name} verschieben – ziehen oder Pfeiltasten"
										title="Spalte verschieben"
										onkeydown={(e) => columnKey(e, p.id)}
										use:draggable={{ kind: 'party', data: { id: p.id } }}
									>
										<GripVertical size={14} aria-hidden="true" />
									</button>
								{/if}
								<span class="min-w-0 font-semibold break-words">{p.name}</span>
							</span>
							{#if p.members.length}
								<span class="mt-1 flex flex-wrap gap-1 font-normal">
									{#each p.members as m (m.id)}
										{#if data.canEdit}
											<button
												type="button"
												class="person {m.fromName ? 'guest' : ''}"
												title={m.fromName ? `Diese Woche hier, fest: ${m.fromName}` : 'Zu einer anderen Partie ziehen – in die Spalte (Woche) oder ein Feld (Tag)'}
												onclick={() => openCrew({ userId: m.id, name: m.name, weekParty: p.id, fromName: m.fromName })}
												use:draggable={{ kind: 'person', data: { userId: m.id, name: m.name, weekParty: p.id } satisfies PersonDrag }}
											>
												{#if m.fromName}<ArrowRightLeft size={11} aria-hidden="true" />{/if}{m.name}
											</button>
										{:else}
											<span class="person {m.fromName ? 'guest' : ''}" title={m.fromName ? `Diese Woche hier, fest: ${m.fromName}` : undefined}>{m.name}</span>
										{/if}
									{/each}
								</span>
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.days as day, i (day)}
					{@const holiday = holidayName(day)}
					<tr class="border-b border-line align-top {day === data.today ? 'today' : ''} {i >= 5 ? 'weekend' : ''}">
						<th scope="row" class="sticky left-0 z-10 bg-surface px-2.5 py-2 text-left">
							<span class="block font-display text-base font-semibold">{DAY[i]}</span>
							<span class="num block text-[0.75rem] font-normal text-ink-2">{short(day)}</span>
							{#if holiday}<span class="block text-[0.6875rem] font-normal text-danger">{holiday}</span>{/if}
						</th>
						{#each data.parties as p (p.id)}
							{@const items = cell(p.id, day)}
							{@const off = away(p.id, day)}
							{@const help = guests(p.id, day)}
							{@const gone = elsewhere(p.id, day)}
							<td class="group px-1.5 py-1.5" use:dropzone={{ accepts: ['entry', 'person', 'order'], onDrop: dropOnCell(p.id, day), disabled: !data.canEdit }}>
								<div class="flex min-h-10 flex-col gap-1">
									{#each items as e (e.id)}{@render entryChip(e)}{/each}
									{#if off.length}<div class="flex flex-wrap gap-1">{#each off as a, n (n)}{@render absence(a)}{/each}</div>{/if}
									{#if help.length || gone.length}
										<div class="flex flex-wrap gap-1">
											{#each help as m (m.userId)}
												{#if data.canEdit}
													<button
														type="button"
														class="person guest"
														title="{dayName(day)} hier, sonst bei {m.fromPartyName}"
														onclick={() => openCrew({ userId: m.userId, name: m.name, weekParty: m.fromPartyId, fromName: null }, day, p.id)}
														use:draggable={{ kind: 'person', data: { userId: m.userId, name: m.name, weekParty: p.id, day } satisfies PersonDrag }}
													>
														<ArrowRightLeft size={11} aria-hidden="true" />{m.name}
													</button>
												{:else}
													<span class="person guest" title="{dayName(day)} hier, sonst bei {m.fromPartyName}"><ArrowRightLeft size={11} aria-hidden="true" />{m.name}</span>
												{/if}
											{/each}
											{#each gone as m (m.userId)}
												<span class="person gone" title="{dayName(day)} bei {m.partyName}">{m.name} → {m.partyName}</span>
											{/each}
										</div>
									{/if}
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
		{#if data.canEdit}
			<br />Ziehen: Spalten am <GripVertical size={12} class="inline" aria-hidden="true" /> umordnen · Einträge auf ein anderes Feld · Leute in eine andere Spalte (diese Woche) oder in ein
			Feld (nur dieser Tag) – die feste Partie im Benutzerkonto bleibt. Am Handy kurz halten, dann ziehen.
		{/if}
	</p>
{/if}

{#if data.all}
	<section class="card mt-5 p-4 lg:p-5" aria-labelledby="h-unassigned">
		<h2 id="h-unassigned" class="flex items-center gap-2 text-lg"><HardHat size={20} aria-hidden="true" />Nicht zugeteilte Aufträge</h2>
		<p class="mt-1 text-sm text-ink-2">
			Offene Aufträge ohne Partie.{data.canEdit
				? ' Zum Einplanen am Griff in ein Feld der Wochenplanung ziehen (Partie und Tag) oder „Einplanen“ – die Partie bekommt den Auftrag dann zugeteilt.'
				: ''} Die Partien sehen diese Liste nicht.
		</p>
		{#if data.unassigned.length}
			<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
				{#each data.unassigned as o (o.id)}
					{@const st = ORDER_STATUS_LABELS[o.status] ?? ORDER_STATUS_LABELS.erstellt}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
						{#if data.canEdit}
							<!-- Zum Ziehen: Griff und Nummer – so sieht man beim Ziehen, welcher Auftrag es ist -->
							<button
								type="button"
								class="order-pill num"
								aria-label="Auftrag {spacedNumber(o.number)} in die Wochenplanung ziehen"
								title="In ein Feld der Wochenplanung ziehen"
								use:draggable={{ kind: 'order', data: { id: o.id, number: o.number } satisfies OrderDrag }}
							>
								<GripVertical size={14} class="text-ink-3" aria-hidden="true" />{spacedNumber(o.number)}
							</button>
						{:else}
							<span class="num w-16 shrink-0 font-display font-semibold">{spacedNumber(o.number)}</span>
						{/if}
						<span class="min-w-[12rem] flex-1">
							{#if data.canOpenOrders}
								<a href="/auftraege/{o.id}" class="font-medium hover:underline">{o.location || o.title || 'Ohne Bezeichnung'}</a>
							{:else}
								<span class="font-medium">{o.location || o.title || 'Ohne Bezeichnung'}</span>
							{/if}
							<span class="block text-[0.8125rem] text-ink-3">{[o.location ? o.title : '', o.customerName, `seit ${dateLabel(o.createdAt)}`].filter(Boolean).join(' · ')}</span>
						</span>
						{#if o.startDate}
							<!-- Termin aus dem Arbeitsauftrag – mit der Partie steht er von selbst in der Planung -->
							<span class="badge badge-warn" title="Termin aus dem Arbeitsauftrag"><CalendarPlus size={13} aria-hidden="true" />{rangeLabel(o.startDate, o.endDate || null)}</span>
						{/if}
						<span class="badge {st.tone}">{st.label}</span>
						{#if data.canEdit}
							<button type="button" class="btn btn-secondary btn-sm" onclick={() => openPlan(o)}><CalendarPlus size={16} aria-hidden="true" />Einplanen</button>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-3 text-sm text-ink-3">Alle offenen Aufträge sind einer Partie zugeteilt.</p>
		{/if}
	</section>

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

{#if data.canEdit && crewPerson}
	{@const person = crewPerson}
	<Dialog bind:open={crewOpen} title="{person.name} einteilen" onclose={() => (crewOpen = false)}>
		<form
			method="POST"
			action="?/crew"
			class="space-y-3"
			use:enhance={() => async ({ result, update }) => {
				if (result.type === 'success') {
					crewOpen = false;
					toast.success(crewWhen === 'woche' ? `${person.name} ist diese Woche bei ${nameOfParty(Number(crewParty))}` : `${person.name}: ${dayName(crewWhen)} bei ${nameOfParty(Number(crewParty))}`);
				}
				await update();
			}}
		>
			<input type="hidden" name="person" value={person.userId} />
			{#if crewWhen === 'woche'}<input type="hidden" name="woche" value={data.weekStart} />{:else}<input type="hidden" name="tag" value={crewWhen} />{/if}
			<label class="block">
				<span class="field-label">Wann</span>
				<select class="select" bind:value={crewWhen}>
					<option value="woche">Die ganze Woche (KW {kw.week})</option>
					{#each data.days as d, i (d)}<option value={d}>Nur {DAY[i]} {short(d)}</option>{/each}
				</select>
			</label>
			<label class="block">
				<span class="field-label">Partie</span>
				<select class="select" name="partie" bind:value={crewParty}>
					{#each data.parties as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
				</select>
			</label>
			<p class="field-hint">Gilt nur für die Planung – die feste Partie im Benutzerkonto bleibt, nächste Woche gilt wieder sie.</p>
			{#if form && 'message' in form && form.message}<p class="text-sm text-danger" role="alert">{form.message}</p>{/if}
			<div class="flex flex-wrap items-center gap-2 pt-1">
				<button class="btn btn-primary">Einteilen</button>
				<button type="button" class="btn btn-ghost" onclick={() => (crewOpen = false)}>Abbrechen</button>
			</div>
		</form>
		{#if person.fromName}
			<form
				method="POST"
				action="?/crewReset"
				class="mt-3 border-t border-line pt-3"
				use:enhance={() => async ({ update }) => {
					crewOpen = false;
					toast.success(`${person.name} ist wieder bei ${person.fromName}`);
					await update();
				}}
			>
				<input type="hidden" name="person" value={person.userId} />
				<input type="hidden" name="woche" value={data.weekStart} />
				<button class="btn btn-ghost btn-sm"><ArrowRightLeft size={15} aria-hidden="true" />Zurück zur festen Partie ({person.fromName})</button>
			</form>
		{/if}
	</Dialog>
{/if}

{#if data.canEdit}
	<Dialog bind:open title={editing ? 'Eintrag ändern' : 'Eintragen'} onclose={() => (open = false)}>
		<form method="POST" action={editing ? '?/update' : '?/add'} class="space-y-3" use:enhance={after(editing ? 'Gespeichert' : '')}>
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<label class="block">
				<span class="field-label">Partie</span>
				<select class="select" name="partie" bind:value={partyId} required>
					{#if !partyId}<option value="" disabled>Partie wählen</option>{/if}
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
					{#if freeOrders.length}
						<optgroup label="Nicht zugeteilt – geht an diese Partie">
							{#each freeOrders as o (o.id)}<option value={String(o.id)}>{orderLabel(o)}</option>{/each}
						</optgroup>
					{/if}
					{#if otherOrders.length}
						<optgroup label="Aufträge anderer Partien">
							{#each otherOrders as o (o.id)}<option value={String(o.id)}>{orderLabel(o)}</option>{/each}
						</optgroup>
					{/if}
				</select>
				{#if claims}
					<span class="field-hint">Der Auftrag ist noch keiner Partie zugeteilt – {partyName ? `mit dem Eintragen bekommt ihn ${partyName}` : 'mit dem Eintragen bekommt ihn die gewählte Partie'}.</span>
				{/if}
			</label>
			<label class="block">
				<span class="field-label">{orderId ? 'Zusatz' : 'Text'}{orderId ? '' : ' *'}</span>
				<input class="input" name="text" maxlength="200" bind:value={text} placeholder={orderId ? 'z. B. 14:00 – 16:00' : 'z. B. Stbe 1, Leitschutz?, Lager'} required={!orderId} />
			</label>
			{#if form && 'message' in form && form.message}<p class="text-sm text-danger" role="alert">{form.message}</p>{/if}
			<div class="flex flex-wrap items-center gap-2 pt-1">
				<button class="btn btn-primary" disabled={busy || !partyId || (!editing && !days.length)}>{editing ? 'Speichern' : days.length > 1 ? `An ${days.length} Tagen eintragen` : 'Eintragen'}</button>
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
		/* Schmale Spalten: lange Wörter (Straßennamen, Nummern) umbrechen statt hinausragen */
		overflow-wrap: anywhere;
		hyphens: auto;
		border-radius: 0.5rem;
		border: 1px solid var(--c-line);
		background: var(--c-surface-2);
		padding: 0.25rem 0.5rem;
		line-height: 1.25;
		font-size: 0.8125rem;
	}
	.order-pill {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.25rem;
		min-width: 5.5rem;
		border-radius: 0.5rem;
		border: 1px solid var(--c-line);
		background: var(--c-surface-2);
		padding: 0.25rem 0.5rem 0.25rem 0.25rem;
		font-family: var(--font-display);
		font-weight: 600;
		cursor: grab;
	}
	.order-pill:hover {
		border-color: var(--c-line-strong);
	}
	button.chip:hover,
	a.chip:hover {
		border-color: var(--c-line-strong);
		background: var(--c-surface-3);
	}
	.person {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border-radius: 999px;
		padding: 0.0625rem 0.5rem;
		font-size: 0.6875rem;
		line-height: 1.4;
		background: var(--c-surface-2);
		border: 1px solid var(--c-line);
		color: var(--c-ink-2);
	}
	button.person:hover {
		border-color: var(--c-line-strong);
		color: var(--c-ink);
	}
	.person.guest {
		border-style: dashed;
		color: var(--c-ink);
	}
	.person.gone {
		background: transparent;
		color: var(--c-ink-3);
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, currentColor 50%, transparent);
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
