<script lang="ts">
	/** Prüfseite einer Rechnung: Ergebnis groß, darunter die Angaben und der Vergleich einer vorliegenden PDF */
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import FileSearch from '@lucide/svelte/icons/file-search';
	import { date as dateLabel, dateTime } from '$lib/format';
	import { spacedNumber } from '$lib/modules/auftraege/offer';
	import { CHECK_LABELS, PADES_LEVEL_LABELS } from '$lib/modules/auftraege/signature';

	let { data, form } = $props();
	const v = $derived(data.invoice);
	const result = $derived(v ? CHECK_LABELS[v.result] : null);
	const ICONS = { ok: CircleCheck, danger: CircleX, warn: CircleAlert, muted: CircleHelp } as const;
	const TONES = { ok: 'text-ok border-ok/50', danger: 'text-danger border-danger/50', warn: 'text-warn border-warn/50', muted: 'text-ink-3 border-line' } as const;

	let busy = $state(false);
	let fileName = $state('');
	let hash = $state('');
	let fileError = $state('');
	let compareForm = $state<HTMLFormElement | null>(null);

	async function pick(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		fileError = '';
		hash = '';
		if (!file) return;
		fileName = file.name;
		try {
			const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
			hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
			await tick();
			compareForm?.requestSubmit();
		} catch {
			fileError = 'Die Datei ließ sich in diesem Browser nicht lesen.';
		}
	}
</script>

<svelte:head>
	<title>Rechnung prüfen – Monsipan</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<h1 class="text-[1.75rem] leading-tight">Rechnung prüfen</h1>

{#if data.disabled || !v || !result}
	<div class="card mt-4 p-5">
		<p class="font-medium">Die Online-Prüfung ist derzeit abgeschaltet.</p>
		<p class="mt-1 text-ink-2">Bitte wenden Sie sich bei Fragen zur Rechnung direkt an uns.</p>
	</div>
{:else}
	{@const Icon = ICONS[result.tone as keyof typeof ICONS]}
	<section class="card mt-4 flex items-start gap-4 border-2 p-5 {TONES[result.tone as keyof typeof TONES]}" aria-live="polite">
		<Icon size={40} class="shrink-0" aria-hidden="true" />
		<div class="min-w-0">
			<p class="text-xl font-semibold">{result.label}</p>
			<p class="mt-1 text-ink-2">{result.text}</p>
		</div>
	</section>

	<section class="card mt-4 p-5">
		<dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[13rem_1fr]">
			<dt class="text-sm text-ink-3">Rechnungsnummer</dt>
			<dd class="num font-medium">{v.kindLabel} {spacedNumber(v.number)}</dd>
			<dt class="text-sm text-ink-3">Rechnungsdatum</dt>
			<dd>{dateLabel(v.date)}</dd>
			<dt class="text-sm text-ink-3">Ausgestellt am</dt>
			<dd>{v.issuedAt ? dateTime(v.issuedAt) : '–'}</dd>
			<dt class="text-sm text-ink-3">Rechnungssteller</dt>
			<dd>{v.issuer}</dd>
			<dt class="text-sm text-ink-3">Status der Rechnung</dt>
			<dd>{v.stage === 'storniert' ? `Storniert${v.cancelledAt ? ` am ${dateLabel(v.cancelledAt.slice(0, 10))}` : ''}` : 'Ausgestellt'}</dd>
			<dt class="text-sm text-ink-3">Digitale Signatur</dt>
			<dd>
				{#if v.signed}
					{v.level ? (PADES_LEVEL_LABELS[v.level] ?? v.level) : 'PAdES'}{v.sealName ? ` · ${v.sealName}` : ''}
					{#if v.qualification}<span class="block text-sm text-ink-2">{v.qualification}</span>{/if}
				{:else}
					Nicht digital signiert
				{/if}
			</dd>
			{#if v.signed}
				<dt class="text-sm text-ink-3">Zeitpunkt der Signierung</dt>
				<dd>
					{v.timestampAt ? dateTime(v.timestampAt) : v.signedAt ? dateTime(v.signedAt) : '–'}
					{#if v.timestampAt}<span class="block text-sm text-ink-2">laut Zeitstempeldienst</span>{/if}
				</dd>
			{/if}
			<dt class="text-sm text-ink-3">Integritätsprüfung</dt>
			<dd class={v.archive === false ? 'font-medium text-danger' : ''}>
				{v.archive === true ? 'Die archivierte Rechnung ist unverändert.' : v.archive === false ? 'Die archivierte Rechnung ist nicht mehr unverändert.' : 'Nicht möglich.'}
			</dd>
		</dl>
	</section>

	<section class="card mt-4 p-5" aria-labelledby="h-compare">
		<h2 id="h-compare" class="flex items-center gap-2 text-lg"><FileSearch size={20} aria-hidden="true" />Ihre PDF vergleichen</h2>
		<p class="mt-1 text-sm text-ink-2">
			Wählen Sie die Rechnung, die Ihnen vorliegt. Ihr Browser berechnet daraus eine Prüfsumme; nur diese wird verglichen – die Datei selbst verlässt Ihr Gerät
			nicht.
		</p>
		<form
			method="POST"
			action="?/compare"
			class="mt-3"
			bind:this={compareForm}
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					busy = false;
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="sha256" value={hash} />
			<label class="btn btn-secondary cursor-pointer">
				<FileSearch size={18} aria-hidden="true" />PDF auswählen
				<input type="file" accept="application/pdf,.pdf" class="sr-only" onchange={pick} />
			</label>
			{#if fileName}<span class="ml-2 text-sm text-ink-2">{fileName}</span>{/if}
		</form>
		{#if fileError}<p class="mt-3 text-sm text-danger" role="alert">{fileError}</p>{/if}
		{#if busy}<p class="mt-3 text-sm text-ink-2">Wird geprüft …</p>{/if}
		{#if !busy && form && 'compared' in form}
			<p class="mt-3 flex items-center gap-2 font-medium {form.match ? 'text-ok' : 'text-danger'}" role="status">
				{#if form.match}<CircleCheck size={20} aria-hidden="true" />Die Datei ist genau die ausgestellte Rechnung.{:else}<CircleX size={20} aria-hidden="true" />Die Datei
					stimmt nicht mit der ausgestellten Rechnung überein – sie wurde verändert oder ist eine andere Fassung.{/if}
			</p>
		{/if}
	</section>

	<p class="mt-4 text-sm text-ink-3">
		Dieser Prüfcode gehört zu unserem Rechnungssystem und ist kein Registrierkassen-Beleg (RKSV). Die digitale Signatur der PDF lässt sich zusätzlich in
		Programmen wie Adobe Acrobat Reader im Unterschriftenbereich prüfen.
	</p>
{/if}
