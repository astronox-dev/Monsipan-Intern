<script lang="ts">
	/**
	 * Urlaubskonten: alle Beschäftigten mit An- und Abmeldung, Anspruch,
	 * genehmigtem Urlaub und Rest – Stand heute, nach Partien gegliedert (wie die
	 * Wochenplanung, ohne Partie am Ende). Über den Stift Beschäftigungszeiten
	 * und Übertrag pflegen. Nur mit dem Recht „Urlaubskonten".
	 */
	import { pageTitle } from '$lib/app';
	import PiggyBank from '@lucide/svelte/icons/piggy-bank';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { hoursText, rangeLabel } from '$lib/modules/planung/days';
	import { hoursToDays } from '$lib/modules/planung/konto';
	import AccountDialog from '$lib/modules/planung/components/AccountDialog.svelte';

	let { data } = $props();

	type Account = (typeof data.accounts)[number];
	const decimal = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
	const stateText = (a: Account) =>
		!a.state
			? 'keine Beschäftigungszeit'
			: a.state.state === 'angemeldet'
				? `angemeldet seit ${rangeLabel(a.state.date, null)}`
				: a.state.state === 'ab'
					? `angemeldet ab ${rangeLabel(a.state.date, null)}`
					: `abgemeldet seit ${rangeLabel(a.state.date, null)}`;
	const missing = $derived(data.accounts.filter((a) => !a.setUp).length);
	/** Je Partie ein Block – die Reihenfolge kommt schon sortiert vom Server */
	const groups = $derived(
		data.accounts.reduce<{ key: number | null; name: string; accounts: Account[] }[]>((out, a) => {
			const last = out.at(-1);
			if (last && last.key === a.partyId) last.accounts.push(a);
			else out.push({ key: a.partyId, name: a.partyName ?? 'Ohne Partie', accounts: [a] });
			return out;
		}, [])
	);

	let editing = $state<number | null>(null);
	let editOpen = $state(false);
	const editAccount = $derived(data.accounts.find((a) => a.id === editing));
</script>

<svelte:head><title>{pageTitle('Urlaubskonten')}</title></svelte:head>

<div class="mt-1 mb-5">
	<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><PiggyBank size={26} aria-hidden="true" />Urlaubskonten</h1>
	<p class="text-ink-2">
		Stand heute: Anspruch (Übertrag + je Woche angemeldet erworben) − genehmigt = Rest. Wer über den Winter abgemeldet ist, erwirbt in der Zeit nichts.
		{#if missing}<span class="font-medium text-ink">{missing} {missing === 1 ? 'Konto ist' : 'Konten sind'} noch nicht eingerichtet.</span>{/if}
	</p>
</div>

<section class="card overflow-hidden">
	<div class="hidden gap-3 px-4 pt-4 text-[0.8125rem] text-ink-3 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_6rem_6rem_9rem_2.5rem] lg:px-5">
		<span>Name</span><span>Beschäftigung</span><span class="text-right" title="Übertrag + erworben">Anspruch</span><span class="text-right">Genehmigt</span><span class="text-right">Rest</span><span></span>
	</div>
	{#if data.accounts.length}
		<ul class="mt-1 divide-y divide-line">
			{#each groups as g (g.key)}
				<li class="bg-surface-3 px-4 py-1.5 text-sm font-semibold lg:px-5">
					{g.name}<span class="ml-2 font-normal text-ink-3">{g.accounts.length}</span>
				</li>
				{#each g.accounts as a (a.id)}
					<li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_6rem_6rem_9rem_2.5rem] lg:px-5">
						<span class="min-w-0 font-medium">{a.name}</span>
						<span class="col-start-1 text-sm text-ink-2 md:col-start-auto">{stateText(a)}</span>
						{#if a.setUp}
							<span class="num col-start-1 text-sm text-ink-2 md:col-start-auto md:text-right">
								<span class="md:hidden">Anspruch</span> {hoursText(a.account.carryover + a.account.earned)}
							</span>
							<span class="num col-start-1 text-sm text-ink-2 md:col-start-auto md:text-right"><span class="md:hidden">genehmigt</span> {hoursText(a.account.used)}</span>
							<span class="num col-start-2 row-start-1 text-right font-semibold md:col-start-auto md:row-start-auto {a.account.rest < 0 ? 'text-danger' : ''}">
								{hoursText(a.account.rest)}
								<span class="block text-[0.75rem] font-normal text-ink-3">≈ {decimal(hoursToDays(a.account.rest, a.weekHours))} Tage</span>
							</span>
						{:else}
							<span class="col-span-3 hidden text-sm text-ink-3 md:block">noch nicht eingerichtet</span>
						{/if}
						<button
							type="button"
							class="btn btn-ghost btn-sm btn-icon col-start-2 row-start-2 justify-self-end md:col-start-auto md:row-start-auto"
							aria-label="Urlaubskonto von {a.name} bearbeiten"
							onclick={() => ((editing = a.id), (editOpen = true))}
						>
							<Pencil size={16} />
						</button>
					</li>
				{/each}
			{/each}
		</ul>
	{:else}
		<p class="px-4 py-4 text-sm text-ink-3 lg:px-5">Niemand mit Urlaubskonto – unter Benutzer ist bei allen „Kein Urlaubskonto" angehakt.</p>
	{/if}
</section>

{#if editAccount}<AccountDialog bind:open={editOpen} account={editAccount} defaultWeeks={data.leaveWeeks} today={data.today} />{/if}
