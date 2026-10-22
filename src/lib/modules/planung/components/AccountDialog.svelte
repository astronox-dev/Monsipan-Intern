<script lang="ts">
	/**
	 * Urlaubskonto einer Person pflegen: Beschäftigungszeiten (anmelden, mit dem
	 * letzten Tag abmelden, wieder anmelden), Übertrag zum Stichtag und – falls
	 * abweichend – die Wochen Urlaub im Jahr. Darüber, wie sich der Rest ergibt.
	 */
	import { enhance } from '$app/forms';
	import Dialog from '$lib/components/Dialog.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { hoursText, rangeLabel } from '../days';
	import { employedDays, hoursToDays } from '../konto';

	interface Account {
		id: number;
		name: string;
		periods: { id: number; from: string; to: string | null }[];
		carryover: number;
		start: string | null;
		weeks: number;
		ownWeeks: number | null;
		rate: number;
		weekHours: number;
		account: { carryover: number; earned: number; used: number; rest: number };
	}
	interface Props {
		open: boolean;
		account: Account;
		/** Wochen Urlaub im Jahr laut Einstellungen */
		defaultWeeks: number;
		today: string;
	}
	let { open = $bindable(), account, defaultWeeks, today }: Props = $props();

	const days = $derived(employedDays(account.periods, today, account.start));
	const decimal = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

	const submit =
		(ok: string, clear = false) =>
		() =>
		async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
			if (result.type === 'failure') toast.error(String(result.data?.accountMessage ?? 'Fehlgeschlagen'));
			else if (result.type === 'success') toast.success(ok);
			// Nur das Formular für eine neue Anmeldung leeren – die anderen zeigen den gespeicherten Stand
			await update({ reset: clear && result.type === 'success' });
		};
</script>

<Dialog bind:open title="Urlaubskonto – {account.name}" wide>
	<p class="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
		<span class="num block">
			Übertrag {hoursText(account.account.carryover)} + erworben {hoursText(account.account.earned)} − genehmigt {hoursText(account.account.used)} =
			<span class="font-semibold {account.account.rest < 0 ? 'text-danger' : ''}">{hoursText(account.account.rest)} Rest</span>
			(≈ {decimal(hoursToDays(account.account.rest, account.weekHours))} Tage)
		</span>
		<span class="num mt-1 block text-ink-3">
			{days} Tage angemeldet{account.start ? ` seit dem Stichtag ${rangeLabel(account.start, null)}` : ''} ÷ 7 × {hoursText(account.rate)} je Woche ({decimal(account.weeks)} Wochen × {hoursText(
				account.weekHours
			)} ÷ 52)
		</span>
	</p>

	<h3 class="mt-5 font-display text-lg font-semibold">Beschäftigung</h3>
	<p class="text-sm text-ink-2">Angemeldet von – bis (letzter Tag). Über den Winter abmelden: das Ende eintragen; im Frühjahr eine neue Zeit anlegen.</p>
	<ul class="mt-2 space-y-2">
		{#each account.periods as p (p.id)}
			<li>
				<form method="POST" action="?/periode" class="flex flex-wrap items-end gap-2" use:enhance={submit('Gespeichert')}>
					<input type="hidden" name="person" value={account.id} />
					<input type="hidden" name="id" value={p.id} />
					<label class="block">
						<span class="field-label">Angemeldet ab</span>
						<input class="input input-sm num" type="date" name="von" required value={p.from} />
					</label>
					<label class="block">
						<span class="field-label">bis</span>
						<input class="input input-sm num" type="date" name="bis" min={p.from} value={p.to ?? ''} />
					</label>
					<button class="btn btn-secondary btn-sm">Speichern</button>
					<button class="btn btn-ghost btn-sm text-danger hover:bg-danger-soft" name="entfernen" value="1" formnovalidate>Entfernen</button>
					{#if !p.to}<span class="pb-2 text-sm text-ink-3">laufend</span>{/if}
				</form>
			</li>
		{:else}
			<li class="text-sm text-ink-3">Noch keine Beschäftigungszeit – ohne sie wird kein Urlaub erworben.</li>
		{/each}
	</ul>
	<form method="POST" action="?/periode" class="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3" use:enhance={submit('Angemeldet', true)}>
		<input type="hidden" name="person" value={account.id} />
		<label class="block">
			<span class="field-label">Neu angemeldet ab</span>
			<input class="input input-sm num" type="date" name="von" required />
		</label>
		<label class="block">
			<span class="field-label">bis (leer: laufend)</span>
			<input class="input input-sm num" type="date" name="bis" />
		</label>
		<button class="btn btn-secondary btn-sm">Hinzufügen</button>
	</form>

	<h3 class="mt-5 font-display text-lg font-semibold">Übertrag</h3>
	<p class="text-sm text-ink-2">
		Resturlaub in Stunden zum Stichtag – etwa aus der Zeit vor dem Portal. Ab dem Stichtag zählen erworbener und genehmigter Urlaub; ohne Stichtag zählt alles.
	</p>
	<form method="POST" action="?/konto" class="mt-2 flex flex-wrap items-end gap-2" use:enhance={submit('Gespeichert')}>
		<input type="hidden" name="person" value={account.id} />
		<label class="block">
			<span class="field-label">Übertrag</span>
			<span class="flex items-center gap-1.5">
				<input class="input input-sm num w-24 text-right" name="uebertrag" inputmode="decimal" maxlength="9" value={account.carryover ? decimal(account.carryover) : ''} placeholder="0" />Std.
			</span>
		</label>
		<label class="block">
			<span class="field-label">Stichtag</span>
			<input class="input input-sm num" type="date" name="stichtag" value={account.start ?? ''} />
		</label>
		<label class="block">
			<span class="field-label">Urlaub im Jahr</span>
			<span class="flex items-center gap-1.5">
				<input
					class="input input-sm num w-16 text-right"
					name="wochen"
					inputmode="decimal"
					maxlength="5"
					value={account.ownWeeks == null ? '' : decimal(account.ownWeeks)}
					placeholder={decimal(defaultWeeks)}
				/>Wochen
			</span>
		</label>
		<button class="btn btn-secondary btn-sm">Speichern</button>
	</form>
	<p class="mt-1 text-[0.8125rem] text-ink-3">Urlaub im Jahr leer lassen: wie in den Einstellungen ({decimal(defaultWeeks)} Wochen).</p>

	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (open = false)}>Schließen</button>
	{/snippet}
</Dialog>
