<script lang="ts">
	/**
	 * Zahlungsbedingungen in Angebot und Rechnung: Zahlungsziel, Skonto und
	 * Frist fürs Skonto. Darunter gleich, was nach Skonto zu zahlen ist, und
	 * der Satz, wie er im PDF steht. Schickt ziel, skonto und skontotage mit.
	 */
	import { afterSkonto, hasSkonto, money, parseAmount, paymentTermsText } from '../offer';

	interface Props {
		/** Als Text, wie getippt */
		days: string;
		percent: string;
		skontoDays: string;
		/** Gesamtbetrag, von dem das Skonto abgeht */
		gross: number;
		/** Rechnung: „zahlbar bis" und „Skonto bis" als Datum – beim Angebot leer */
		dates?: { due: string; skonto: string } | null;
		disabled?: boolean;
	}
	let { days = $bindable(), percent = $bindable(), skontoDays = $bindable(), gross, dates = null, disabled = false }: Props = $props();

	const terms = $derived({
		paymentDays: Math.max(0, Math.trunc(Number(days) || 0)),
		skontoPercent: Math.max(0, parseAmount(percent) ?? 0),
		skontoDays: Math.max(0, Math.trunc(Number(skontoDays) || 0))
	});
	const skonto = $derived(hasSkonto(terms));
	const text = $derived(paymentTermsText(terms, gross, dates ?? undefined));
</script>

<section class="card mt-4 p-4 lg:p-5">
	<h2 class="text-lg">Zahlungsbedingungen</h2>
	<div class="mt-3 grid grid-cols-3 gap-3 sm:max-w-xl">
		<label class="block">
			<span class="field-label">Zahlungsziel</span>
			<span class="flex items-center gap-2">
				<input class="input num text-right" type="number" name="ziel" min="0" max="365" required bind:value={days} {disabled} />Tage
			</span>
		</label>
		<label class="block">
			<span class="field-label">Skonto</span>
			<span class="flex items-center gap-2"><input class="input num text-right" name="skonto" inputmode="decimal" maxlength="5" placeholder="0" bind:value={percent} {disabled} />%</span>
		</label>
		<label class="block">
			<span class="field-label">innerhalb von</span>
			<span class="flex items-center gap-2">
				<input class="input num text-right" type="number" name="skontotage" min="0" max="365" placeholder="–" bind:value={skontoDays} {disabled} />Tagen
			</span>
		</label>
	</div>
	{#if skonto}
		<dl class="num mt-3 ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 font-semibold">
			<dt>Gesamtbetrag nach Skonto</dt>
			<dd class="text-right">{money(afterSkonto(gross, terms.skontoPercent))}</dd>
		</dl>
	{/if}
	<p class="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
		{#each text as t, i (i)}<span class="block {i === 0 && dates ? 'font-semibold' : ''}">{t}</span>{/each}
	</p>
	<p class="mt-2 text-[0.8125rem] text-ink-3">So steht es {dates ? 'auf der Rechnung' : 'im Angebot'}. Die Vorgaben für neue Angebote und Rechnungen stehen in den Einstellungen.</p>
</section>
