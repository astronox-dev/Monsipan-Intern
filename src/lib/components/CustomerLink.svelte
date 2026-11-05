<script lang="ts">
	/**
	 * Dauerhafter Link für den Kunden: kopieren, am Handy teilen oder per E-Mail
	 * schicken. Für Tagesberichte und Angebote – die Seite stellt die Aktionen
	 * ?/link (Link anlegen) und ?/sendLink (E-Mail) bereit.
	 */
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import LinkIcon from '@lucide/svelte/icons/link';
	import Copy from '@lucide/svelte/icons/copy';
	import Share from '@lucide/svelte/icons/share-2';
	import Send from '@lucide/svelte/icons/send';
	import { dateTime } from '$lib/format';
	import { toast } from '$lib/stores/toast.svelte';

	interface Props {
		url: string | null;
		description: string;
		/** Für das Teilen-Menü am Handy */
		shareTitle: string;
		shareText: string;
		mailConfigured: boolean;
		/** Vorschlag fürs E-Mail-Feld */
		email: string;
		sentTo: string | null;
		sentAt: Date | null;
	}
	let { url, description, shareTitle, shareText, mailConfigured, email, sentTo, sentAt }: Props = $props();

	let sending = $state(false);
	/** Teilen gibt es vor allem am Handy – erst im Browser bekannt */
	let canShare = $state(false);
	onMount(() => (canShare = typeof navigator.share === 'function'));

	async function copyLink() {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			toast.success('Link kopiert');
		} catch {
			toast.info('Kopieren ging nicht – bitte den Link im Feld markieren und kopieren.');
		}
	}
	async function shareLink() {
		if (!url) return;
		try {
			await navigator.share({ title: shareTitle, text: shareText, url });
		} catch {
			/* abgebrochen */
		}
	}
</script>

<section class="card mb-4 p-4 lg:p-5">
	<h2 class="flex items-center gap-2 text-lg"><LinkIcon size={18} aria-hidden="true" />Link für den Kunden</h2>
	<p class="mt-1 text-sm text-ink-2">{description}</p>
	{#if url}
		<div class="mt-3 flex flex-wrap gap-2">
			<input
				class="input min-w-0 flex-[1_1_18rem] font-mono text-sm"
				readonly
				value={url}
				onfocus={(e) => e.currentTarget.select()}
				aria-label="Link für den Kunden"
			/>
			<button type="button" class="btn btn-secondary" onclick={copyLink}><Copy size={18} aria-hidden="true" />Kopieren</button>
			{#if canShare}
				<button type="button" class="btn btn-secondary" onclick={shareLink}><Share size={18} aria-hidden="true" />Teilen</button>
			{/if}
		</div>
		{#if mailConfigured}
			<form
				method="POST"
				action="?/sendLink"
				class="mt-3 flex flex-wrap items-end gap-2"
				use:enhance={() => {
					sending = true;
					return async ({ result, update }) => {
						sending = false;
						if (result.type === 'success') toast.success('E-Mail an den Kunden verschickt');
						await update({ reset: false });
					};
				}}
			>
				<label class="block min-w-0 flex-[1_1_16rem]">
					<span class="field-label">Per E-Mail an den Kunden</span>
					<input class="input" type="text" inputmode="email" autocapitalize="off" spellcheck="false" name="email" required maxlength="200" autocomplete="email" placeholder="name@firma.at" value={email} />
				</label>
				<button class="btn btn-secondary" disabled={sending}><Send size={18} aria-hidden="true" />{sending ? 'Wird gesendet …' : 'Senden'}</button>
			</form>
		{:else}
			<p class="field-hint mt-2">Der E-Mail-Versand ist nicht eingerichtet – bitte den Link kopieren oder teilen.</p>
		{/if}
		{#if sentAt && sentTo}
			<p class="field-hint mt-2">Zuletzt am {dateTime(sentAt)} an {sentTo} geschickt.</p>
		{/if}
	{:else}
		<form method="POST" action="?/link" class="mt-3" use:enhance>
			<button class="btn btn-secondary"><LinkIcon size={18} aria-hidden="true" />Link erzeugen</button>
		</form>
	{/if}
</section>
