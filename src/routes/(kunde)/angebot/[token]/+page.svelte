<script lang="ts">
	import { enhance } from '$app/forms';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FileText from '@lucide/svelte/icons/file-text';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import PdfViewer from '$lib/components/PdfViewer.svelte';
	import SignaturePad from '$lib/modules/stunden/components/SignaturePad.svelte';
	import OfferSummary from '$lib/modules/auftraege/components/OfferSummary.svelte';
	import { spacedNumber } from '$lib/modules/auftraege/offer';
	import { dateTime } from '$lib/format';

	let { data, form } = $props();

	/** Blatt oder Liste – die Liste ist am Handy ohne Zoomen lesbar */
	let view = $state<'formular' | 'liste'>('formular');
	let mode = $state<'annehmen' | 'aendern'>('annehmen');

	// svelte-ignore state_referenced_locally
	let name = $state(form && 'name' in form ? String(form.name ?? '') : '');
	// svelte-ignore state_referenced_locally
	let text = $state(form && 'text' in form ? String(form.text ?? '') : '');
	let signature = $state('');
	let busy = $state(false);

	const title = $derived(`Angebot Nr. ${spacedNumber(data.number)}`);
	const submit = () => {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			busy = false;
			await update({ reset: false });
		};
	};
</script>

<svelte:head>
	<title>{title} – Monsipan</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<h1 class="text-[1.75rem] leading-tight">{title}</h1>

{#if !data.offer}
	<div class="card mt-4 p-5">
		<p class="font-medium">Dieses Angebot wird gerade überarbeitet.</p>
		<p class="mt-1 text-ink-2">Sobald es wieder bereit ist, können Sie es über denselben Link ansehen und annehmen.</p>
	</div>
{:else}
	{#if data.status === 'angenommen' && data.offer.acceptedAt}
		<div class="card mt-4 flex flex-wrap items-center gap-4 p-4 sm:p-5">
			<CircleCheck size={28} class="shrink-0 text-ok" aria-hidden="true" />
			<p class="min-w-[14rem] flex-1">
				Angenommen{#if data.offer.acceptedName}
					von <span class="font-medium">{data.offer.acceptedName}</span>{/if} am {dateTime(data.offer.acceptedAt)}. Vielen Dank für Ihren Auftrag!
				<span class="block text-sm text-ink-2">Über diesen Link können Sie das Angebot jederzeit wieder öffnen, drucken oder herunterladen.</span>
			</p>
		</div>
	{:else if data.status === 'aenderung'}
		<div class="card mt-4 flex flex-wrap items-center gap-4 p-4 sm:p-5">
			<MessageSquare size={26} class="shrink-0 text-ink-2" aria-hidden="true" />
			<p class="min-w-[14rem] flex-1">
				Danke – Ihr Änderungswunsch{data.requestedAt ? ` vom ${dateTime(data.requestedAt)}` : ''} ist bei uns angekommen.
				<span class="block text-sm text-ink-2">Das überarbeitete Angebot finden Sie danach wieder über diesen Link.</span>
			</p>
		</div>
	{:else}
		<p class="mt-1 text-ink-2">Bitte prüfen Sie unser Angebot. Sie können es unten annehmen oder uns Änderungswünsche schicken.</p>
	{/if}

	<div class="mt-4 flex flex-wrap items-center justify-between gap-2">
		<div class="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Ansicht">
			{#each [['formular', 'Angebot'], ['liste', 'Liste']] as [key, label] (key)}
				<button
					type="button"
					role="tab"
					aria-selected={view === key}
					class="rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors {view === key ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-3'}"
					onclick={() => (view = key as 'formular' | 'liste')}
				>
					{label}
				</button>
			{/each}
		</div>
		<PdfButton href="/angebot/{data.token}/pdf" class="btn btn-secondary btn-sm"><FileText size={16} aria-hidden="true" />Als PDF</PdfButton>
	</div>

	{#if view === 'formular'}
		<div class="mt-3"><PdfViewer url="/angebot/{data.token}/pdf?ansehen" title={title} /></div>
	{:else}
		<section class="card mt-3 p-4 sm:p-5"><OfferSummary offer={data.offer} /></section>
	{/if}

	{#if data.status === 'freigegeben'}
		<div class="mt-5 inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Ihre Antwort">
			<button
				type="button"
				role="tab"
				aria-selected={mode === 'annehmen'}
				class="rounded-lg px-3.5 py-1.5 text-sm font-medium {mode === 'annehmen' ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-3'}"
				onclick={() => (mode = 'annehmen')}>Annehmen</button
			>
			<button
				type="button"
				role="tab"
				aria-selected={mode === 'aendern'}
				class="rounded-lg px-3.5 py-1.5 text-sm font-medium {mode === 'aendern' ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-3'}"
				onclick={() => (mode = 'aendern')}>Änderungen wünschen</button
			>
		</div>

		{#if mode === 'annehmen'}
			<form method="POST" action="?/accept" class="card mt-3 space-y-4 p-4 sm:p-5" use:enhance={submit}>
				<h2 class="text-lg">Angebot annehmen</h2>
				<label class="block">
					<span class="field-label">Ihr Name</span>
					<input class="input" name="name" required minlength="2" maxlength="120" autocomplete="name" bind:value={name} />
				</label>
				<SignaturePad bind:path={signature} label="Hier unterschreiben" />
				<input type="hidden" name="unterschrift" value={signature} />
				{#if form && 'message' in form && form.message}<p class="field-error" role="alert">{form.message}</p>{/if}
				<p class="field-hint">Mit Ihrer Unterschrift nehmen Sie das Angebot zu den oben genannten Bedingungen an.</p>
				<button class="btn btn-primary w-full sm:w-auto" disabled={busy || !signature || name.trim().length < 2}>
					<PenLine size={18} aria-hidden="true" />{busy ? 'Wird gespeichert …' : 'Angebot annehmen'}
				</button>
			</form>
		{:else}
			<form method="POST" action="?/change" class="card mt-3 space-y-4 p-4 sm:p-5" use:enhance={submit}>
				<h2 class="text-lg">Änderungen wünschen</h2>
				<label class="block">
					<span class="field-label">Ihr Name</span>
					<input class="input" name="name" required minlength="2" maxlength="120" autocomplete="name" bind:value={name} />
				</label>
				<label class="block">
					<span class="field-label">Was sollen wir ändern?</span>
					<textarea class="textarea" name="nachricht" rows="5" required minlength="3" maxlength="4000" bind:value={text}></textarea>
				</label>
				{#if form && 'changeMessage' in form && form.changeMessage}<p class="field-error" role="alert">{form.changeMessage}</p>{/if}
				<p class="field-hint">Wir überarbeiten das Angebot und schicken es Ihnen über denselben Link wieder.</p>
				<button class="btn btn-primary w-full sm:w-auto" disabled={busy || name.trim().length < 2 || text.trim().length < 3}>
					<MessageSquare size={18} aria-hidden="true" />{busy ? 'Wird gesendet …' : 'Änderungswunsch senden'}
				</button>
			</form>
		{/if}
	{/if}
{/if}
