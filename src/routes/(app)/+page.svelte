<script lang="ts">
	/**
	 * Übersicht: oben, was zu tun ist; darunter je Bereich die wichtigsten Zahlen –
	 * Auftragsmanagement, Dokumentation und Lager, jeweils nur mit Recht darauf.
	 * Dazu das Wetter in Eibesbrunn für heute und die nächsten 7 Tage.
	 * Ganz unten alle Bereiche als Kacheln.
	 */
	import { APP_NAME, pageTitle } from '$lib/app';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import X from '@lucide/svelte/icons/x';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import MessageSquareWarning from '@lucide/svelte/icons/message-square-warning';
	import HardHat from '@lucide/svelte/icons/hard-hat';
	import Inbox from '@lucide/svelte/icons/inbox';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Signature from '@lucide/svelte/icons/signature';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Clock from '@lucide/svelte/icons/clock';
	import PackageMinus from '@lucide/svelte/icons/package-minus';
	import TreePalm from '@lucide/svelte/icons/tree-palm';
	import Thermometer from '@lucide/svelte/icons/thermometer';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import BarChart from '$lib/components/BarChart.svelte';
	import CountUp from '$lib/components/CountUp.svelte';
	import WeatherCard from '$lib/components/WeatherCard.svelte';
	import MovementList from '$lib/modules/lager/components/MovementList.svelte';
	import ProductAvatar from '$lib/modules/lager/components/ProductAvatar.svelte';
	import { monthLong, monthShort } from '$lib/format';
	import { install } from '$lib/install.svelte';
	import { overviewCards } from '$lib/nav';
	import { can } from '$lib/permissions';
	import { money, ORDER_STATUS_LABELS, spacedNumber } from '$lib/modules/auftraege/offer';
	import type { Component } from 'svelte';

	let { data } = $props();

	// Bereiche der Anwendung; wächst mit jedem freigeschalteten Modul
	const areas = $derived(overviewCards(data.user.role));
	const has = (p: Parameters<typeof can>[1]) => can(data.user.role, p);

	const canBook = $derived(has('lager.bestand.buchen'));
	// Ohne Berichte-Recht führt "Nachbestellen" in den gefilterten Bestand statt zur Bestellliste
	const lowHref = $derived(has('lager.berichte.sehen') ? '/lager/bestellliste' : '/lager/bestand?status=nachbestellen');
	const lowLinkLabel = $derived(has('lager.berichte.sehen') ? 'Bestellliste' : 'Im Bestand ansehen');
	const hour = new Date().getHours();
	const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
	const todayLabel = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

	const lager = $derived(data.lager);
	const auftrag = $derived(data.auftrag);
	const doku = $derived(data.doku);

	const consumption = $derived(lager?.consumption ?? []);
	const chartData = $derived(
		consumption.map((c, i) => ({
			key: c.month,
			label: monthShort(c.month),
			longLabel: monthLong(c.month),
			value: c.qty,
			partial: i === consumption.length - 1
		}))
	);
	const thisMonth = $derived(consumption.at(-1)?.qty ?? 0);
	const lastMonth = $derived(consumption.at(-2)?.qty ?? 0);

	// Hinweis auf die App: nur am Handy, nur solange nicht installiert und nicht weggeklickt
	const HINT_KEY = 'lager-app-hinweis';
	let hintHidden = $state(false);
	$effect(() => {
		try {
			hintHidden = localStorage.getItem(HINT_KEY) === 'weg';
		} catch {
			/* kein Speicherzugriff */
		}
	});
	function hideHint() {
		hintHidden = true;
		try {
			localStorage.setItem(HINT_KEY, 'weg');
		} catch {
			/* kein Speicherzugriff */
		}
	}

	/** Symbol und Farbe je Punkt in „Zu erledigen" */
	const TODO_ICON: Record<string, Component> = {
		ueberfaellig: TriangleAlert,
		abrechnen: ReceiptText,
		aenderung: MessageSquareWarning,
		auftrag: HardHat,
		anfragen: Inbox,
		'tb-pruefen': ClipboardCheck,
		'tb-offen': NotebookPen,
		'tb-kunde': Signature,
		'sz-pruefen': ClipboardCheck,
		'sz-vorwoche': Clock,
		'auftraege-neu': HardHat,
		nachbestellen: PackageMinus,
		urlaub: TreePalm,
		krankmeldung: Thermometer
	};
	const TONE: Record<string, string> = {
		danger: 'bg-danger-soft text-danger',
		warn: 'bg-warn-soft text-warn',
		info: 'bg-surface-3 text-ink-2'
	};

	const SHEET_STATUS: Record<string, string> = { entwurf: 'In Arbeit', freigegeben: 'Freigegeben', geprueft: 'Geprüft' };
</script>

<!-- Eine Kennzahl als Feld im Streifen; Beträge (Text) etwas kleiner, damit sie auch am Handy passen -->
{#snippet tile(href: string, label: string, value: number | string, sub: string, tone = '', wordy = false)}
	<a {href} class="min-w-0 bg-surface p-4 transition-colors hover:bg-surface-2 lg:flex-1 lg:p-5">
		<p class="text-sm text-ink-2">{label}</p>
		<p
			class="mt-1 font-display leading-none font-semibold {typeof value === 'number'
				? 'text-[2.25rem]'
				: wordy
					? 'text-[1.375rem] leading-tight'
					: 'truncate text-[1.625rem] lg:text-[2rem]'} {tone}"
		>
			{#if typeof value === 'number'}<CountUp {value} />{:else}{value}{/if}
		</p>
		<p class="mt-2 text-[0.8125rem] leading-snug text-ink-3">{sub}</p>
	</a>
{/snippet}

{#snippet heading(title: string, href: string)}
	<div class="mt-8 mb-3 flex items-center justify-between gap-2">
		<h2 class="text-xl">{title}</h2>
		<a {href} class="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">Zum Bereich<ChevronRight size={16} aria-hidden="true" /></a>
	</div>
{/snippet}

<svelte:head><title>{pageTitle('Übersicht')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-4 pt-2 pb-6">
	<div>
		<h1 class="text-[2rem] leading-tight">{greeting}, {data.user.firstName || data.user.username}</h1>
		<p class="text-ink-2">{todayLabel}</p>
	</div>
	{#if canBook}
		<div class="flex w-full gap-2 sm:w-auto">
			<a href="/lager/buchen?art=OUT" class="btn btn-primary flex-1 sm:flex-none"><ArrowUpFromLine size={18} aria-hidden="true" />Ausbuchen</a>
			<a href="/lager/buchen?art=IN" class="btn btn-secondary flex-1 sm:flex-none"><ArrowDownToLine size={18} aria-hidden="true" />Einbuchen</a>
			<a href="/lager/buchen?art=TRANSFER" class="btn btn-secondary hidden sm:inline-flex"><ArrowLeftRight size={18} aria-hidden="true" />Umlagern</a>
		</div>
	{/if}
</div>

{#if install.suggest && !hintHidden}
	<div class="card mb-4 flex items-center gap-3 p-3">
		<span class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-ink"><Smartphone size={20} aria-hidden="true" /></span>
		<p class="min-w-0 flex-1 text-sm">
			<span class="font-medium">{APP_NAME} als App</span>
			<span class="block text-ink-3">Symbol am Startbildschirm, Vollbild ohne Browserleiste.</span>
		</p>
		<a href="/app" class="btn btn-primary btn-sm shrink-0">Einrichten</a>
		<button class="btn btn-ghost btn-sm btn-icon shrink-0" aria-label="Hinweis ausblenden" onclick={hideHint}><X size={16} /></button>
	</div>
{/if}

<!-- Heute laut Wochenplanung – für die eigene Partie -->
{#if data.plan.today}
	<section class="card mb-4 p-4 lg:p-5" aria-labelledby="h-heute">
		<div class="flex items-center justify-between gap-2">
			<h2 id="h-heute" class="flex items-center gap-2 text-xl"><CalendarDays size={20} aria-hidden="true" />Heute laut Plan</h2>
			<a href="/planung" class="btn btn-ghost btn-sm">Ganze Woche<ChevronRight size={16} aria-hidden="true" /></a>
		</div>
		{#if data.plan.today.length}
			<ul class="mt-2 flex flex-wrap gap-2">
				{#each data.plan.today as e (e.id)}
					<li class="rounded-xl border border-line bg-surface-2 px-3 py-2">
						{#if e.orderId && has('auftraege.sehen')}
							<a href="/auftraege/{e.orderId}" class="block font-medium hover:underline">{e.orderLocation || e.orderTitle || 'Auftrag'}</a>
						{:else}
							<span class="block font-medium">{e.orderId ? e.orderLocation || e.orderTitle || 'Auftrag' : e.text}</span>
						{/if}
						{#if e.orderId}<span class="num block text-[0.75rem] text-ink-3">{spacedNumber(e.orderNumber ?? '')}{e.text ? ` · ${e.text}` : ''}</span>{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-ink-2">Für heute ist nichts eingeplant.</p>
		{/if}
	</section>
{/if}

<WeatherCard weather={data.weather} place={data.weatherPlace} />

<!-- Zu erledigen: nur, was diese Person angehen darf -->
{#if lager || auftrag || doku || data.plan.openLeave != null || data.plan.sick}
	<section class="card p-4 lg:p-6" aria-labelledby="h-todo">
		<h2 id="h-todo" class="text-xl">Zu erledigen</h2>
		{#if data.todos.length}
			<ul class="mt-3 grid gap-x-6 gap-y-1 md:grid-cols-2">
				{#each data.todos as t (t.key)}
					{@const Icon = TODO_ICON[t.key] ?? CircleCheck}
					<li>
						<a href={t.href} class="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
							<span class="grid size-9 shrink-0 place-items-center rounded-xl {TONE[t.tone]}"><Icon size={18} aria-hidden="true" /></span>
							<span class="min-w-0 flex-1 text-[0.9375rem] leading-snug font-medium">{t.label}</span>
							<span class="num font-display text-xl font-semibold {t.tone === 'danger' ? 'text-danger' : ''}">{t.count}</span>
							<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 flex items-center gap-2 text-ink-2"><CircleCheck size={18} class="text-ok" aria-hidden="true" />Nichts offen – alles erledigt.</p>
		{/if}
	</section>
{/if}

<!-- Auftragsmanagement -->
{#if auftrag}
	{@render heading('Auftragsmanagement', has('auftraege.sehen') ? '/auftraege' : has('angebote.sehen') ? '/angebote' : has('anfragen.sehen') ? '/anfragen' : '/rechnungen')}
	<section class="card grid grid-cols-2 gap-px overflow-hidden bg-line lg:flex [&>*:last-child:nth-child(odd)]:col-span-2" aria-label="Kennzahlen Auftragsmanagement">
		{#if auftrag.inquiries}
			{@render tile('/anfragen', 'Offene Anfragen', auftrag.inquiries.open, `${auftrag.inquiries.fresh} ohne Angebot`)}
		{/if}
		{#if auftrag.offers}
			{@render tile(
				'/angebote?status=offen',
				'Angebote ausstehend',
				auftrag.offers.freigegeben,
				[`${auftrag.offers.entwurf} in Arbeit`, auftrag.offers.aenderung ? `${auftrag.offers.aenderung} Änderung` : ''].filter(Boolean).join(' · ')
			)}
		{/if}
		{#if auftrag.orders}
			{@render tile('/auftraege?status=in_arbeit', 'Aufträge in Arbeit', auftrag.orders.in_arbeit, `${auftrag.orders.erstellt} neu · ${auftrag.orders.abgeschlossen} abgeschlossen`)}
		{/if}
		{#if auftrag.invoices}
			{@render tile(
				'/rechnungen?stand=offen',
				'Offene Rechnungen',
				money(auftrag.invoices.openGross),
				`${auftrag.invoices.open} offen${auftrag.invoices.overdue ? ` · ${auftrag.invoices.overdue} überfällig` : ''}`,
				auftrag.invoices.overdue ? 'text-danger' : ''
			)}
		{/if}
	</section>

	{#if auftrag.running?.length}
		<section class="card mt-4 overflow-hidden" aria-labelledby="h-running">
			<div class="flex items-center justify-between gap-2 px-4 pt-4 pb-2 lg:px-6 lg:pt-5">
				<h3 id="h-running" class="text-lg">Laufende Aufträge</h3>
				<a href="/auftraege" class="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">Alle<ChevronRight size={16} aria-hidden="true" /></a>
			</div>
			<ul class="divide-y divide-line">
				{#each auftrag.running as o (o.id)}
					{@const st = ORDER_STATUS_LABELS[o.status] ?? ORDER_STATUS_LABELS.erstellt}
					<li>
						<a href="/auftraege/{o.id}" class="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 lg:px-6">
							<span class="num w-16 shrink-0 font-display font-semibold">{spacedNumber(o.number)}</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium">{o.title || 'Ohne BV'}</span>
								<span class="block truncate text-[0.8125rem] text-ink-3">{[o.location || o.customerName, o.partyName].filter(Boolean).join(' · ')}</span>
							</span>
							<span class="badge {st.tone}">{st.label}</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<!-- Dokumentation -->
{#if doku}
	{@render heading('Dokumentation', doku.reports ? '/tagesberichte' : '/stundenzettel')}
	<section class="card grid grid-cols-2 gap-px overflow-hidden bg-line lg:flex [&>*:last-child:nth-child(odd)]:col-span-2" aria-label="Kennzahlen Dokumentation">
		{#if doku.reports}
			{@render tile(
				'/tagesberichte',
				'Tagesberichte diese Woche',
				doku.reports.week,
				has('tagesberichte.pruefen') ? `${doku.reports.freigegeben} zu prüfen` : `${doku.reports.entwurf} noch in Arbeit`
			)}
			{#if has('tagesberichte.kundenlink')}
				{@render tile('/tagesberichte?stand=geprueft', 'Warten auf den Kunden', doku.reports.geprueft, 'geprüft, Unterschrift offen')}
			{/if}
		{/if}
		{#if doku.sheets}
			{#if doku.sheets.others}
				{@render tile('/stundenzettel', `Stundenzettel KW ${data.week}`, `${doku.sheets.released} / ${doku.sheets.total}`, 'freigegeben')}
				{#if doku.released !== null}
					{@render tile('/stundenzettel', 'Stundenzettel zu prüfen', doku.released, 'freigegeben, noch nicht geprüft')}
				{/if}
			{:else}
				{@render tile(
					'/stundenzettel',
					'Dein Stundenzettel',
					doku.sheets.own === undefined ? '–' : doku.sheets.own ? SHEET_STATUS[doku.sheets.own] : 'Noch keiner',
					`KW ${data.week}`,
					'',
					true
				)}
			{/if}
		{/if}
	</section>
{/if}

<!-- Lagermanagement -->
{#if lager}
	{@render heading('Lagermanagement', '/lager/bestand')}

	<section class="card grid grid-cols-2 gap-px overflow-hidden bg-line lg:flex [&>*:last-child:nth-child(odd)]:col-span-2" aria-label="Kennzahlen Lager">
		{@render tile('/lager/bestand', 'Aktive Artikel', lager.kpi.products, 'im Sortiment')}
		{@render tile('/lager/bestand', 'Stück auf Lager', lager.kpi.units, `verteilt auf ${lager.kpi.locations} Lagerorte`)}
		<a
			href={lowHref}
			class="relative min-w-0 overflow-hidden bg-surface p-4 transition-colors hover:bg-surface-2 lg:flex-1 lg:p-5"
		>
			{#if lager.kpi.low > 0}<span class="lane absolute inset-x-0 top-0 h-1" aria-hidden="true"></span>{/if}
			<p class="text-sm text-ink-2">Nachbestellen</p>
			<p class="mt-1 font-display text-[2.25rem] leading-none font-semibold {lager.kpi.low > 0 ? 'text-warn' : ''}"><CountUp value={lager.kpi.low} /></p>
			<p class="mt-2 text-[0.8125rem] text-ink-3">Artikel am Mindestbestand</p>
		</a>
		{#if lager.kpi.today !== null}
			{@render tile('/lager/bewegungen', 'Buchungen heute', lager.kpi.today, 'ohne Stornos')}
		{/if}
	</section>

	<div class="mt-4 grid gap-4 lg:grid-cols-3">
		<!-- Verbrauch -->
		{#if lager.consumption}
			<section class="card min-w-0 p-4 lg:col-span-2 lg:p-6" aria-labelledby="h-consumption">
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div>
						<h3 id="h-consumption" class="text-lg">Verbrauch je Monat</h3>
						<p class="text-sm text-ink-3">Ausgaben minus Rückgaben, in Stück</p>
					</div>
					<div class="text-right">
						<p class="text-sm text-ink-3">Bisher diesen Monat</p>
						<p class="font-display text-2xl leading-tight font-semibold">
							{thisMonth} <span class="text-base font-medium text-ink-3">Stück</span>
						</p>
						{#if lastMonth > 0}<p class="text-[0.8125rem] text-ink-3">Vormonat gesamt {lastMonth}</p>{/if}
					</div>
				</div>
				<div class="mt-4">
					<BarChart data={chartData} title="Verbrauch je Monat" />
				</div>
			</section>
		{/if}

		<!-- Nachbestellen -->
		<section class="card flex min-w-0 flex-col p-4 lg:p-6 {lager.consumption ? '' : 'lg:col-span-3'}" aria-labelledby="h-low">
			<div class="flex items-center justify-between gap-2">
				<h3 id="h-low" class="text-lg">Nachbestellen</h3>
				{#if lager.kpi.low > 0}
					<a href={lowHref} class="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
						{lowLinkLabel}<ChevronRight size={16} aria-hidden="true" />
					</a>
				{/if}
			</div>
			{#if lager.low.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center py-8 text-center">
					<span class="grid size-12 place-items-center rounded-2xl bg-ok-soft text-ok"><CircleCheck size={24} aria-hidden="true" /></span>
					<p class="mt-3 font-medium">Alles ausreichend auf Lager</p>
					<p class="text-sm text-ink-3">Kein Artikel hat den Mindestbestand erreicht.</p>
				</div>
			{:else}
				<ul class="mt-3 space-y-1">
					{#each lager.low as p (p.id)}
						{@const ratio = Math.min(1, p.total / Math.max(1, p.minStock ?? 1))}
						<li>
							<a href="/lager/artikel/{p.id}" class="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
								<ProductAvatar colorHex={p.colorHex} category={p.categoryName} size="sm" />
								<span class="min-w-0 flex-1">
									<span class="block truncate text-[0.9375rem] font-medium">{p.name}</span>
									<span class="mt-1.5 block h-1.5 overflow-hidden rounded-full {p.total <= 0 ? 'bg-danger-soft' : 'bg-warn-soft'}">
										<span class="block h-full rounded-full {p.total <= 0 ? 'bg-danger' : 'bg-warn'}" style="width: {Math.max(4, ratio * 100)}%"></span>
									</span>
								</span>
								<span class="num text-right text-sm whitespace-nowrap">
									<span class="font-semibold">{p.total}</span><span class="text-ink-3"> / {p.minStock}</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<!-- Letzte Bewegungen -->
	{#if lager.recent}
		<section class="card mt-4 overflow-hidden" aria-labelledby="h-recent">
			<div class="flex items-center justify-between gap-2 px-4 pt-4 pb-3 lg:px-6 lg:pt-5">
				<h3 id="h-recent" class="text-lg">Letzte Bewegungen</h3>
				<a href="/lager/bewegungen" class="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">Alle<ChevronRight size={16} aria-hidden="true" /></a>
			</div>
			<MovementList rows={lager.recent} />
		</section>
	{/if}
{/if}

<!-- Alle Bereiche -->
{#if areas.length > 1}
	<h2 class="mt-8 mb-3 text-xl">Bereiche</h2>
	<section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Bereiche">
		{#each areas as m (m.key)}
			<a href={m.href} class="card flex min-w-0 items-center gap-3 p-4 transition-shadow hover:shadow-[var(--shadow-2)]">
				<span class="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2"><m.icon size={20} aria-hidden="true" /></span>
				<span class="min-w-0">
					<span class="block truncate font-semibold">{m.label}</span>
					{#if m.hint}<span class="block truncate text-[0.8125rem] text-ink-3">{m.hint}</span>{/if}
				</span>
			</a>
		{/each}
	</section>
{/if}
