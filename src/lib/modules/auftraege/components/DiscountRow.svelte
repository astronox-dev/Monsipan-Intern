<script lang="ts">
	/**
	 * Nachlass in den Summen von Angebot und Rechnung – zwischen Netto und
	 * Umsatzsteuer: Zahl und Art (Prozent oder Euro), rechts der Betrag. Mit
	 * Nachlass folgt „Netto nach Nachlass". Steht in einem <dl> mit zwei Spalten
	 * und schickt nachlass und nachlassart mit.
	 */
	import { money } from '../offer';

	interface Props {
		/** Wie getippt */
		value: string;
		kind: 'prozent' | 'betrag';
		/** Der Nachlass in Euro und das Netto danach */
		discount: number;
		taxable: number;
	}
	let { value = $bindable(), kind = $bindable(), discount, taxable }: Props = $props();
</script>

<dt class="flex flex-wrap items-center gap-x-2 gap-y-1">
	<label for="nachlass">Nachlass</label>
	<span class="flex items-center gap-1">
		<input id="nachlass" class="input input-sm num w-20 text-right" name="nachlass" inputmode="decimal" maxlength="14" placeholder="0" bind:value />
		<select class="select input-sm w-[4.25rem] pr-7" name="nachlassart" bind:value={kind} aria-label="Nachlass in Prozent oder Euro">
			<option value="prozent">%</option>
			<option value="betrag">€</option>
		</select>
	</span>
</dt>
<dd class="self-center text-right {discount ? '' : 'text-ink-3'}">{discount ? `− ${money(Math.abs(discount))}` : '–'}</dd>
{#if discount}
	<dt>Netto nach Nachlass</dt>
	<dd class="text-right">{money(taxable)}</dd>
{/if}
