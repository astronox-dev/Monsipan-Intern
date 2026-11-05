<script lang="ts">
	/** Offene Rechnung ändern */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import InvoiceEditor from '$lib/modules/auftraege/components/InvoiceEditor.svelte';
	import { invoiceLabel, invoiceNo } from '$lib/modules/auftraege/offer';
	import { Autosave } from '$lib/autosave.svelte';
	import SaveState from '$lib/components/SaveState.svelte';

	let { data, form } = $props();
	let busy = $state(false);
	// svelte-ignore state_referenced_locally
	let version = $state(data.version);
	let formEl = $state<HTMLFormElement>();
	const saver = new Autosave({
		form: () => formEl,
		action: '',
		enabled: () => !busy,
		extra: { auto: '1' },
		onsaved: (d) => {
			if (typeof d.version === 'number') version = d.version;
		}
	});
	const message = $derived(form && 'message' in form && !('conflict' in form) ? String(form.message ?? '') : '');
</script>

<svelte:head><title>{pageTitle(`${invoiceLabel(data.invoice.kind)} ${invoiceNo(data.invoice)} bearbeiten`)}</title></svelte:head>

<a href="/rechnungen/{data.invoice.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />{invoiceLabel(data.invoice.kind)} {invoiceNo(data.invoice)}
</a>

<div class="mt-3 mb-5">
	<h1 class="text-[2rem] leading-tight">{invoiceLabel(data.invoice.kind)} {invoiceNo(data.invoice)} bearbeiten</h1>
	<p class="text-ink-2">Solange sie offen ist. Wurde sie schon verschickt, am besten eine neue PDF mitschicken.</p>
</div>

<form
	method="POST"
	bind:this={formEl}
	use:enhance={() => {
		busy = true;
		saver.cancel();
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'failure' && result.data?.conflict) {
				saver.markConflict(String((result.data.conflict as { by?: string }).by ?? ''), String(result.data.message ?? ''));
			}
			await update({ reset: false });
		};
	}}
>
	<input type="hidden" name="version" value={version} />
	<SaveState {saver} what="die Rechnung" />
	<InvoiceEditor
		head={data.head}
		lines={data.lines}
		paymentDays={data.paymentDays}
		units={data.units}
		{busy}
		submitLabel="Speichern"
		{message}
		onchange={() => saver.touch()}
	>
		{#snippet status()}<SaveState {saver} what="die Rechnung" compact />{/snippet}
	</InvoiceEditor>
</form>
