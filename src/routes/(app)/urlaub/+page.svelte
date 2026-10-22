<script lang="ts">
	/**
	 * Urlaub: oben beantragen (wer genehmigen darf, trägt auch für andere ein),
	 * darunter die offenen Anträge zum Entscheiden, die genehmigten Tage und
	 * Stunden je Person und alle Anträge des Jahres. Krankenstand im Urlaub
	 * unterbricht ihn – das steht beim Antrag dabei.
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import TreePalm from '@lucide/svelte/icons/tree-palm';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { toast } from '$lib/stores/toast.svelte';
	import { dateTime } from '$lib/format';
	import { hoursText, leaveDays, rangeLabel, type LeaveUsage } from '$lib/modules/planung/days';

	let { data, form } = $props();

	const STATUS: Record<string, { label: string; tone: string }> = {
		beantragt: { label: 'Beantragt', tone: 'badge-warn' },
		genehmigt: { label: 'Genehmigt', tone: 'badge-ok' },
		abgelehnt: { label: 'Abgelehnt', tone: 'badge-danger' }
	};

	let person = $state('');
	let from = $state('');
	let to = $state('');
	let note = $state('');
	let busy = $state(false);
	/** Rückfrage vor dem Zurückziehen bzw. Löschen */
	let asking = $state<number | null>(null);
	const preview = $derived(from ? leaveDays(from, to || from, data.leaveHours) : []);
	const forOther = $derived(!!person && Number(person) !== data.me);

	const open = $derived(data.rows.filter((r) => r.status === 'beantragt'));
	const others = $derived(data.scope !== 'self');
	const mine = $derived(data.totals.find((t) => t.userId === data.me) ?? { days: 0, hours: 0 });
	const dayCount = (n: number) => `${n} ${n === 1 ? 'Arbeitstag' : 'Arbeitstage'}`;
	const used = (u: LeaveUsage) => `${dayCount(u.days)} · ${hoursText(u.hours)}`;
	const interrupted = (u: LeaveUsage) =>
		`Unterbrochen durch Krankenstand ${u.interruptions.map((s) => rangeLabel(s.from, s.to)).join(', ')} – ${dayCount(u.sickDays)} (${hoursText(u.sickHours)}) ${u.sickDays === 1 ? 'zählt' : 'zählen'} nicht`;
	const withdraw = (r: (typeof data.rows)[number]) => (r.userId === data.me && r.status === 'beantragt') || data.canDecide;
</script>

<svelte:head><title>{pageTitle(`Urlaub ${data.year}`)}</title></svelte:head>

<div class="mt-1 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><TreePalm size={26} aria-hidden="true" />Urlaub</h1>
		<p class="text-ink-2">
			{data.year} · genehmigt für dich: <span class="num font-medium text-ink">{dayCount(mine.days)} · {hoursText(mine.hours)}</span>
		</p>
	</div>
	<div class="flex items-center gap-2">
		<a href="?jahr={data.year - 1}" class="btn btn-secondary btn-sm"><ChevronLeft size={16} aria-hidden="true" />{data.year - 1}</a>
		{#if data.year !== data.thisYear}<a href="?" class="btn btn-ghost btn-sm">{data.thisYear}</a>{/if}
		<a href="?jahr={data.year + 1}" class="btn btn-secondary btn-sm">{data.year + 1}<ChevronRight size={16} aria-hidden="true" /></a>
	</div>
</div>

{#if form && 'message' in form && form.message}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>{/if}

{#if data.canRequest || data.canDecide}
	<section class="card mb-4 p-4 lg:p-5">
		<h2 class="text-lg">{data.canDecide ? 'Urlaub beantragen oder eintragen' : 'Urlaub beantragen'}</h2>
		<form
			method="POST"
			action="?/create"
			class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					busy = false;
					if (result.type === 'success') {
						toast.success((result.data as { created?: string })?.created === 'eingetragen' ? 'Eingetragen und genehmigt' : 'Beantragt – die Leitung bekommt Bescheid');
						from = to = note = '';
						person = '';
					}
					await update({ reset: false });
				};
			}}
		>
			{#if data.people.length}
				<label class="block sm:col-span-2 lg:col-span-4">
					<span class="field-label">Für</span>
					<select class="select" name="person" bind:value={person}>
						<option value="">Mich selbst</option>
						{#each data.people.filter((p) => p.id !== data.me) as p (p.id)}<option value={String(p.id)}>{p.name}{p.partyName ? ` · ${p.partyName}` : ''}</option>{/each}
					</select>
				</label>
			{/if}
			<label class="block">
				<span class="field-label">Von *</span>
				<input class="input num" type="date" name="von" required min={forOther ? undefined : data.today} bind:value={from} />
			</label>
			<label class="block">
				<span class="field-label">Bis</span>
				<input class="input num" type="date" name="bis" min={from || undefined} bind:value={to} />
			</label>
			<label class="block sm:col-span-2">
				<span class="field-label">Notiz</span>
				<input class="input" name="notiz" maxlength="500" bind:value={note} placeholder="freiwillig" />
			</label>
			<div class="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
				<button class="btn btn-primary" disabled={busy || !from}>{forOther ? 'Eintragen (gleich genehmigt)' : 'Beantragen'}</button>
				{#if from}
					<span class="num text-sm text-ink-2">
						{dayCount(preview.length)} · {hoursText(preview.reduce((s, d) => s + d.hours, 0))} – Feiertage und Tage ohne Urlaubsstunden zählen nicht
					</span>
				{/if}
			</div>
		</form>
	</section>
{/if}

{#if data.canDecide && open.length}
	<section class="card mb-4 border-warn/50 p-4 lg:p-5">
		<h2 class="text-lg">Zu entscheiden</h2>
		<ul class="mt-3 space-y-3">
			{#each open as r (r.id)}
				<li class="rounded-xl border border-line p-3">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span class="font-semibold">{r.name}</span>
						{#if r.partyName}<span class="text-sm text-ink-3">{r.partyName}</span>{/if}
						<span class="num">{rangeLabel(r.from, r.to)}</span>
						<span class="num text-sm text-ink-2">{used(r.usage)}</span>
					</div>
					{#if r.usage.sickDays}<p class="mt-1 text-sm text-info">{interrupted(r.usage)}</p>{/if}
					{#if r.note}<p class="mt-1 text-sm text-ink-2">„{r.note}"</p>{/if}
					<form
						method="POST"
						action="?/decide"
						class="mt-2 flex flex-wrap items-center gap-2"
						use:enhance={() => async ({ result, update }) => {
							if (result.type === 'success') toast.success((result.data as { decided?: string })?.decided === 'genehmigt' ? 'Genehmigt' : 'Abgelehnt');
							await update();
						}}
					>
						<input type="hidden" name="id" value={r.id} />
						<input class="input input-sm min-w-0 flex-1 basis-48" name="hinweis" maxlength="500" placeholder="Hinweis (freiwillig, z. B. Grund der Ablehnung)" />
						<button class="btn btn-primary btn-sm" name="entscheidung" value="genehmigt"><Check size={16} aria-hidden="true" />Genehmigen</button>
						<button class="btn btn-secondary btn-sm" name="entscheidung" value="abgelehnt"><X size={16} aria-hidden="true" />Ablehnen</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if others && data.totals.length}
	<section class="card mb-4 p-4 lg:p-5">
		<h2 class="text-lg">Genehmigt {data.year}</h2>
		<ul class="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
			{#each data.totals as t (t.userId)}
				<li class="flex justify-between gap-3 border-b border-line py-1">
						<span>{t.name}</span><span class="num">{t.days} {t.days === 1 ? 'Tag' : 'Tage'} · {hoursText(t.hours)}</span>
					</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="card overflow-hidden">
	<h2 class="px-4 pt-4 text-lg lg:px-5">{others ? 'Alle Anträge' : 'Meine Anträge'} {data.year}</h2>
	{#if data.rows.length}
		<ul class="mt-2 divide-y divide-line">
			{#each data.rows as r (r.id)}
				{@const st = STATUS[r.status]}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 lg:px-5">
					<span class="min-w-0 flex-1">
						<span class="block font-medium">
							{#if others}{`${r.name} · `}{/if}<span class="num">{rangeLabel(r.from, r.to)}</span>
						</span>
						<span class="block text-[0.8125rem] text-ink-3">
							{[
								used(r.usage),
								r.note && `„${r.note}"`,
								r.status !== 'beantragt' && r.decidedByName && `${st.label.toLowerCase()} von ${r.decidedByName}${r.decidedAt ? ` am ${dateTime(r.decidedAt)}` : ''}`,
								r.decisionNote && `Hinweis: ${r.decisionNote}`
							]
								.filter(Boolean)
								.join(' · ')}
						</span>
						{#if r.usage.sickDays && r.status !== 'abgelehnt'}<span class="block text-[0.8125rem] text-info">{interrupted(r.usage)}</span>{/if}
					</span>
					{#if r.usage.sickDays && r.status === 'genehmigt'}<span class="badge badge-info">Unterbrochen</span>{/if}
					<span class="badge {st.tone}">{st.label}</span>
					{#if withdraw(r)}
						{@const verb = r.status === 'beantragt' && r.userId === data.me ? 'Zurückziehen' : 'Löschen'}
						{#if asking === r.id}
							<form method="POST" action="?/remove" class="flex items-center gap-1" use:enhance={() => async ({ update }) => ((asking = null), await update())}>
								<input type="hidden" name="id" value={r.id} />
								<button class="btn btn-sm bg-danger text-white hover:opacity-90">Ja, {verb.toLowerCase()}</button>
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => (asking = null)}>Nein</button>
							</form>
						{:else}
							<button type="button" class="btn btn-ghost btn-sm text-danger hover:bg-danger-soft" onclick={() => (asking = r.id)}>{verb}</button>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="px-4 pt-1 pb-4 text-sm text-ink-3 lg:px-5">Noch kein Urlaub für {data.year}.</p>
	{/if}
</section>
