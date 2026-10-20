<script lang="ts">
	/**
	 * Umsatzsteuer für Angebot und Rechnung: die üblichen Sätze oder – bei einer
	 * Bauleistung an ein Bauunternehmen – Übergang der Steuerschuld, 0 % mit dem
	 * Hinweis auf § 19 Abs. 1a UStG. Schickt „ust" (Prozent) und bei Übergang
	 * der Steuerschuld „reverse=on" mit.
	 */
	import { VAT_RATES } from '../offer';

	interface Props {
		/** Prozent als Text, „20" bzw. „20,5" */
		vat: string;
		reverse: boolean;
		disabled?: boolean;
		class?: string;
	}
	let { vat = $bindable(), reverse = $bindable(), disabled = false, class: cls = '' }: Props = $props();

	const RC = 'rc';
	/** Ein Satz, der nicht zur Wahl steht (ältere Angebote), bleibt wählbar */
	const rates = $derived([...new Set([...VAT_RATES.map(String), vat.replace(',', '.')])].filter((r) => r !== '' && !Number.isNaN(Number(r))));
	const choice = $derived(reverse ? RC : vat.replace(',', '.'));

	function pick(value: string) {
		reverse = value === RC;
		// Beim Übergang der Steuerschuld bleibt der Satz stehen – fürs Zurückschalten
		if (!reverse) vat = value.replace('.', ',');
		else if (!vat.trim()) vat = '20';
	}
</script>

<label class="block {cls}">
	<span class="field-label">Umsatzsteuer</span>
	<select class="select" value={choice} onchange={(e) => pick(e.currentTarget.value)} {disabled}>
		{#each rates as r (r)}<option value={r}>{r.replace('.', ',')} % Umsatzsteuer</option>{/each}
		<option value={RC}>0 % – Übergang der Steuerschuld (§ 19 Abs. 1a UStG)</option>
	</select>
	{#if reverse}<span class="field-hint">Bauleistung an ein Bauunternehmen: ohne Umsatzsteuer, mit Hinweis und UID-Nummer des Kunden.</span>{/if}
</label>
<input type="hidden" name="ust" value={vat} {disabled} />
{#if reverse}<input type="hidden" name="reverse" value="on" {disabled} />{/if}
