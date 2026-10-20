<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Clock from '@lucide/svelte/icons/clock';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Dialog from '$lib/components/Dialog.svelte';
	import { addDays, hoursLabel, mondayOf, monthLabel, monthsOfWeek, segmentLabel, today, weekLabel } from '$lib/modules/stunden/week';
	import { fullName } from '$lib/format';
	import { page } from '$app/state';

	let { data, form } = $props();
	let borrowOpen = $state(false);
	let borrowId = $state<number | null>(null);
	let borrowing = $state(false);

	type Row = (typeof data.rows)[number];

	const dayFmt = new Intl.DateTimeFormat('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
	const dayShort = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00Z`));

	/** Zusatz unter dem Namen: Aushilfe, Auslöse, Ausnahme – die Partie steht schon in der Überschrift */
	function details(row: Row): string {
		return [
			row.writingPartyId ? `Aushilfe aus ${row.user.partyName ?? 'keiner Partie'}` : '',
			row.guestDays.length ? `laut Planung hier: ${row.guestDays.map(dayShort).join(', ')} (aus ${row.user.partyName ?? 'keiner Partie'})` : '',
			row.allowanceDays ? `Auslöse ${hoursLabel(row.allowanceDays)} Tage` : '',
			row.user.timesheetExempt ? 'sonst keine Stundenzettel' : ''
		]
			.filter(Boolean)
			.join(' · ');
	}

	/**
	 * Zeilen nach Partie gruppieren – nach der, die den Zettel schreibt. Eine
	 * übernommene Aushilfe steht also bei der Partie, die sie übernommen hat.
	 * Die eigene Partie kommt zuerst, „Ohne Partie" zuletzt.
	 */
	function byParty(rows: Row[]) {
		const groups = new Map<number, { id: number; name: string; rows: Row[] }>();
		for (const r of rows) {
			// Wer laut Planung hier aushilft, steht bei der eigenen Partie
			const guest = !r.writingPartyId && r.guestDays.length > 0;
			const id = r.writingPartyId ?? (guest ? (data.ownPartyId ?? 0) : (r.user.partyId ?? 0));
			const name = r.writingPartyId ? (r.writingPartyName ?? 'Andere Partie') : guest ? (data.ownPartyName ?? 'Eigene Partie') : (r.user.partyName ?? 'Ohne Partie');
			const group = groups.get(id) ?? { id, name, rows: [] };
			group.rows.push(r);
			groups.set(id, group);
		}
		const rank = (g: { id: number }) => (g.id === data.ownPartyId ? 0 : g.id === 0 ? 2 : 1);
		return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de'));
	}

	const prev = $derived(addDays(data.weekStart, -7));
	const next = $derived(addDays(data.weekStart, 7));
	const isCurrent = $derived(data.weekStart === mondayOf(today()));
	/** Über den Monatswechsel gibt es je Monat einen eigenen Zettel */
	const split = $derived(monthsOfWeek(data.weekStart).length > 1);
	const groups = $derived(
		monthsOfWeek(data.weekStart).map((month) => ({ month, parties: byParty(data.rows.filter((r) => r.month === month)) }))
	);
	/**
	 * Über den Monatswechsel je Monat ein Tab. Gewählt ist der Monat aus der
	 * Adresse, sonst der laufende (falls er in der Woche liegt), sonst der erste.
	 */
	const activeMonth = $derived.by(() => {
		const months = groups.map((g) => g.month);
		const wanted = page.url.searchParams.get('monat');
		if (wanted && months.includes(wanted)) return wanted;
		const current = today().slice(0, 7);
		return months.includes(current) ? current : months[0];
	});
	const shown = $derived(groups.filter((g) => g.month === activeMonth));

	const STATUS: Record<string, { label: string; tone: string }> = {
		entwurf: { label: 'In Arbeit', tone: '' },
		freigegeben: { label: 'Freigegeben', tone: 'badge-info' },
		geprueft: { label: 'Geprüft', tone: 'badge-ok' }
	};
</script>

<svelte:head><title>{pageTitle('Stundenzettel')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Clock size={26} aria-hidden="true" />Stundenzettel</h1>
		<p class="text-ink-2">
			Eine Woche je Person – Montag bis Sonntag. Geht die Woche über den Monatswechsel, gibt es je Monat einen eigenen Zettel.
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<a href="/stundenzettel?woche={prev}" class="btn btn-secondary btn-icon" aria-label="Woche zurück"><ChevronLeft size={18} /></a>
		<span class="num min-w-[13rem] text-center font-medium">{weekLabel(data.weekStart)}</span>
		<a href="/stundenzettel?woche={next}" class="btn btn-secondary btn-icon" aria-label="Woche vor"><ChevronRight size={18} /></a>
		{#if !isCurrent}<a href="/stundenzettel" class="btn btn-ghost btn-sm">Diese Woche</a>{/if}
		{#if data.candidates.length}
			<button type="button" class="btn btn-secondary" onclick={() => ((borrowId = null), (borrowOpen = true))}>
				<UserPlus size={18} aria-hidden="true" />Aushilfe übernehmen
			</button>
		{/if}
	</div>
</div>

{#snippet entry(row: Row)}
	{@const status = row.status ? STATUS[row.status] : null}
	<li class="border-b border-line last:border-0">
		<form method="POST" action="?/open" use:enhance>
			<input type="hidden" name="userId" value={row.user.id} />
			<input type="hidden" name="weekStart" value={data.weekStart} />
			<input type="hidden" name="monat" value={row.month} />
			<button class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
				<span class="min-w-0 flex-1">
					<span class="block truncate font-medium">{fullName(row.user)}</span>
					{#if details(row)}<span class="block truncate text-[0.8125rem] text-ink-3">{details(row)}</span>{/if}
				</span>
				{#if status}
					<span class="badge {status.tone}">
						{#if row.status === 'geprueft'}<CircleCheck size={13} aria-hidden="true" />{/if}{status.label}
					</span>
				{/if}
				<span class="num w-20 text-right font-display text-lg font-semibold">
					{row.total ? hoursLabel(row.total) : '–'}
				</span>
				<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
			</button>
		</form>
	</li>
{/snippet}

<!--
	Über den Monatswechsel: je Monat ein Tab, weil der Lohn monatlich abgerechnet
	wird. Darin je Partie eine eigene Liste.
-->
{#if split}
	<div class="mb-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1" role="tablist" aria-label="Monat">
		{#each groups as group (group.month)}
			{@const active = group.month === activeMonth}
			<a
				role="tab"
				aria-selected={active}
				href="/stundenzettel?woche={data.weekStart}&monat={group.month}"
				data-sveltekit-noscroll
				data-sveltekit-replacestate
				class="flex flex-col rounded-xl px-4 py-1.5 whitespace-nowrap transition-colors {active
					? 'bg-ink text-surface'
					: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
			>
				<span class="text-[0.9375rem] font-medium">{monthLabel(group.month)}</span>
				<span class="num text-[0.75rem] {active ? 'opacity-75' : 'text-ink-3'}">{segmentLabel(data.weekStart, group.month)}</span>
			</a>
		{/each}
	</div>
{/if}

{#each shown as group (group.month)}
	<section class="mb-6" role={split ? 'tabpanel' : undefined} aria-label={split ? monthLabel(group.month) : undefined}>
		{#each group.parties as party (party.id)}
			<div class="mb-4">
				<h3 class="mb-1.5 flex items-baseline gap-2 px-1 text-[0.9375rem] font-semibold">
					{party.name}
					<span class="num text-[0.8125rem] font-normal text-ink-3">
						{party.rows.length}
						{party.rows.length === 1 ? 'Person' : 'Personen'}
					</span>
				</h3>
				<div class="card overflow-hidden">
					<ul>
						{#each party.rows as row (`${row.user.id}-${row.month}`)}
							{@render entry(row)}
						{/each}
					</ul>
				</div>
			</div>
		{:else}
			<div class="card p-8 text-center text-ink-3">Für diese Woche gibt es niemanden, dessen Stunden du erfassen darfst.</div>
		{/each}
	</section>
{/each}

<p class="field-hint mt-3">
	Ein Klick öffnet den Zettel – gibt es ihn noch nicht, wird er angelegt. Die Stunden ergeben sich aus den Zeiten von Beginn bis Ende.
</p>

<Dialog bind:open={borrowOpen} title="Aushilfe übernehmen">
	<p class="text-ink-2">
		War jemand aus einer anderen Partie diese Woche <span class="font-medium text-ink">mehr Tage bei dir</span> als bei seiner eigenen,
		schreibst du seinen Zettel für die ganze Woche – auch für die Tage bei seiner Partie. War er weniger Tage bei dir, schreibt ihn
		seine eigene Partie.
	</p>
	<form
		method="POST"
		action="?/aushilfe"
		class="mt-4 space-y-4"
		use:enhance={() => {
			borrowing = true;
			return async ({ update }) => {
				borrowing = false;
				await update();
			};
		}}
	>
		<input type="hidden" name="weekStart" value={data.weekStart} />
		<label class="block">
			<span class="field-label">Wer – {weekLabel(data.weekStart)}</span>
			<select name="userId" class="select" required bind:value={borrowId}>
				<option value={null}>Person wählen</option>
				{#each data.candidates as c (c.id)}
					<option value={c.id}>{fullName(c)} · {c.partyName ?? 'ohne Partie'}</option>
				{/each}
			</select>
		</label>
		<p class="field-hint">Seine eigene Partie sieht den Zettel danach nur noch. Was sie schon eingetragen hat, bleibt stehen.</p>
		{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (borrowOpen = false)}>Abbrechen</button>
			<button class="btn btn-primary" disabled={!borrowId || borrowing}><UserPlus size={18} aria-hidden="true" />Woche übernehmen</button>
		</div>
	</form>
</Dialog>
