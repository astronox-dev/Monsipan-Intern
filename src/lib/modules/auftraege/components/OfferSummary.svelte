<script lang="ts">
	/** Das Angebot untereinander statt als Blatt – am Handy ohne Zoomen lesbar */
	import { date as dateLabel } from '$lib/format';
	import {
		addressLines,
		lineNumbers,
		money,
		offerTotals,
		paymentTermsText,
		priceLabel,
		quantityLabel,
		REVERSE_CHARGE_NOTE,
		shownTotal,
		spacedNumber,
		vatLabel
	} from '../offer';

	interface Offer {
		number: string;
		date: string;
		title: string;
		location?: string;
		customerName: string;
		customerAddition: string;
		customerStreet: string;
		customerZip: string;
		customerCity: string;
		intro: string;
		closing: string;
		vatRate: number;
		reverseCharge: boolean;
		customerUid: string;
		/** Ältere Angebote haben kein Zahlungsziel – dann steht nichts dazu da */
		paymentDays: number | null;
		skontoPercent: number;
		skontoDays: number;
		lines: { id: number; kind: 'position' | 'titel'; text: string; note?: string; quantity: number | null; unit: string; unitPrice: number | null; alternative?: boolean }[];
	}
	let { offer }: { offer: Offer } = $props();

	const numbers = $derived(lineNumbers(offer.lines));
	const totals = $derived(offerTotals(offer.lines, offer.vatRate, offer.reverseCharge));
	const terms = $derived(
		offer.paymentDays == null
			? []
			: paymentTermsText({ paymentDays: offer.paymentDays, skontoPercent: offer.skontoPercent, skontoDays: offer.skontoDays }, totals.gross)
	);
	const address = $derived(
		addressLines({ name: offer.customerName, addition: offer.customerAddition, street: offer.customerStreet, zip: offer.customerZip, city: offer.customerCity })
	);
</script>

<div class="space-y-4">
	<div class="flex flex-wrap justify-between gap-4 text-sm">
		<p class="leading-relaxed">{#each address as l, i (i)}<span class="block {i === 0 ? 'font-medium' : ''}">{l}</span>{/each}</p>
		<dl class="grid grid-cols-[auto_auto] gap-x-4 text-ink-2">
			<dt>Angebotsdatum</dt>
			<dd class="num text-ink">{dateLabel(offer.date)}</dd>
			<dt>Angebotsnummer</dt>
			<dd class="num text-ink">{offer.number}</dd>
		</dl>
	</div>

	<h2 class="text-xl leading-snug">Angebot Nr. {spacedNumber(offer.number)}{offer.title ? ` / BV: ${offer.title}` : ''}</h2>
	{#if offer.location}<p><span class="font-medium">Ausführungsort:</span> {offer.location}</p>{/if}
	{#if offer.intro}<p class="whitespace-pre-line text-ink-2">{offer.intro}</p>{/if}

	<ul class="divide-y divide-line rounded-xl border border-line">
		{#each offer.lines as l, i (l.id)}
			{#if l.kind === 'titel'}
				<li class="bg-surface-2 px-3 py-2 font-semibold"><span class="num mr-2">{numbers[i]}</span>{l.text}</li>
			{:else}
				<li class="px-3 py-2.5">
					<div class="flex gap-3">
						<span class="num w-8 shrink-0 text-sm text-ink-3">{numbers[i]}</span>
						<span class="min-w-0 flex-1">
							<span class="block font-medium whitespace-pre-line">{l.text}</span>
							{#if l.note}<span class="mt-0.5 block text-sm whitespace-pre-line text-ink-2">{l.note}</span>{/if}
							{#if l.alternative}<span class="mt-0.5 block text-sm text-ink-3 italic">Alternativposition – nicht im Gesamtbetrag enthalten</span>{/if}
						</span>
						<span class="num shrink-0 text-right font-semibold">{money(shownTotal(l))}</span>
					</div>
					<p class="num mt-0.5 pl-11 text-[0.8125rem] text-ink-3">{quantityLabel(l.quantity)} {l.unit} × {priceLabel(l.unitPrice)}</p>
				</li>
			{/if}
		{/each}
	</ul>

	<dl class="num ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
		<dt>Gesamt Netto</dt>
		<dd class="text-right">{money(totals.net)}</dd>
		{#if !offer.reverseCharge}
			<dt>{vatLabel(offer.vatRate, false)}</dt>
			<dd class="text-right">{money(totals.vat)}</dd>
		{/if}
		<dt class="border-t border-ink pt-1 text-lg font-semibold">Gesamtbetrag</dt>
		<dd class="border-t border-ink pt-1 text-right text-lg font-semibold">{money(totals.gross)}</dd>
	</dl>
	{#if offer.reverseCharge}
		<p class="text-sm text-ink-2">{REVERSE_CHARGE_NOTE}{offer.customerUid ? ` UID-Nummer des Leistungsempfängers: ${offer.customerUid}` : ''}</p>
	{/if}
	{#if terms.length}<p class="text-sm">{#each terms as t, i (i)}<span class="block">{t}</span>{/each}</p>{/if}

	{#if offer.closing}<p class="text-sm whitespace-pre-line text-ink-2">{offer.closing}</p>{/if}
</div>
