<script lang="ts">
	/**
	 * Anfragen: E-Mails, aus denen Angebote werden. Beim Einfügen werden Betreff,
	 * Absender, Adresse und Telefon erkannt und vorgeschlagen – was man selbst
	 * ändert, bleibt stehen.
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchInput from '$lib/components/SearchInput.svelte';
	import { liveSubmit } from '$lib/live-search';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Dialog from '$lib/components/Dialog.svelte';
	import { date as dateLabel } from '$lib/format';
	import { guessFromEmail, MAX_INQUIRY_TEXT } from '$lib/modules/auftraege/inquiry';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();

	let newOpen = $state(false);
	let busy = $state(false);

	// Neue Anfrage: Vorschläge aus dem Text, solange das Feld nicht selbst geändert wurde
	let text = $state('');
	let fields = $state({ subject: '', name: '', email: '', phone: '' });
	let touched = $state<Record<string, boolean>>({});
	function guess() {
		const g = guessFromEmail(text);
		for (const k of ['subject', 'name', 'email', 'phone'] as const) if (!touched[k]) fields[k] = g[k];
	}
	function openNew() {
		text = '';
		fields = { subject: '', name: '', email: '', phone: '' };
		touched = {};
		newOpen = true;
	}

	function stateOf(i: (typeof data.inquiries)[number]): { label: string; tone: string } {
		return i.closedAt ? { label: 'Erledigt', tone: 'badge-ok' } : { label: 'Offen', tone: 'badge-info' };
	}
	const TABS = $derived([
		{ key: 'offen', label: 'Offen', count: data.counts.open },
		{ key: 'erledigt', label: 'Erledigt', count: data.counts.done }
	]);
</script>

<svelte:head><title>{pageTitle('Anfragen')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Inbox size={26} aria-hidden="true" />Anfragen</h1>
		<p class="text-ink-2">E-Mail hineinkopieren oder über das Kontaktformular der Webseite – daraus das Angebot schreiben; damit ist die Anfrage erledigt.</p>
	</div>
	{#if data.canCreate}
		<button class="btn btn-primary" onclick={openNew}><Plus size={18} aria-hidden="true" />Neue Anfrage</button>
	{/if}
</div>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Stand">
		{#each TABS as t (t.key)}
			<a
				href="/anfragen?stand={t.key}{data.filter.q ? `&q=${encodeURIComponent(data.filter.q)}` : ''}"
				role="tab"
				aria-selected={data.filter.state === t.key}
				class="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors {data.filter.state === t.key
					? 'bg-ink text-surface'
					: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
			>
				{t.label}<span class="num text-[0.75rem] opacity-70">{t.count}</span>
			</a>
		{/each}
	</div>
	<form method="GET" class="flex min-w-[14rem] flex-1 gap-2">
		<input type="hidden" name="stand" value={data.filter.state} />
		<div class="flex-1"><SearchInput value={data.filter.q} placeholder="Betreff, Absender, Kunde, Ort" label="Suche" /></div>
	</form>
</div>

<div class="card overflow-hidden">
	<ul>
		{#each data.inquiries as i (i.id)}
			{@const st = stateOf(i)}
			<li class="border-b border-line last:border-0">
				<a href="/anfragen/{i.id}" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
					<span class="num w-24 shrink-0 text-sm text-ink-2">{dateLabel(i.receivedOn)}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{i.subject || 'Ohne Betreff'}</span>
						<span class="block truncate text-[0.8125rem] text-ink-3">
							{[i.customerName || i.senderCompany || i.senderName || i.senderEmail, i.location].filter(Boolean).join(' · ') || 'Absender unbekannt'}
						</span>
					</span>
					{#if i.offerNumber}<span class="num hidden shrink-0 text-sm text-ink-2 sm:block">Angebot {spacedNumber(i.offerNumber)}</span>{/if}
					{#if i.source === 'webseite'}<span class="badge hidden sm:inline-flex" title="Über das Kontaktformular der Webseite">Webseite</span>{/if}
					<span class="badge {st.tone}">{st.label}</span>
					<ChevronRight size={18} class="shrink-0 text-ink-3" aria-hidden="true" />
				</a>
			</li>
		{:else}
			<li class="p-10 text-center">
				<p class="font-medium">
					{data.filter.q
						? 'Keine Anfrage gefunden'
						: data.filter.state === 'erledigt'
							? 'Noch nichts erledigt'
							: 'Keine offenen Anfragen'}
				</p>
				{#if data.canCreate && data.filter.state === 'offen' && !data.filter.q}
					<p class="mt-1 text-sm text-ink-3">Mit „Neue Anfrage" eine E-Mail einfügen.</p>
				{/if}
			</li>
		{/each}
	</ul>
</div>

{#if data.canCreate}
	<Dialog bind:open={newOpen} title="Neue Anfrage" wide>
		<form
			method="POST"
			action="?/create"
			class="space-y-4"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					busy = false;
					await update({ reset: false });
				};
			}}
		>
			<label class="block">
				<span class="field-label">E-Mail</span>
				<textarea
					class="textarea min-h-48 text-sm"
					name="text"
					rows="10"
					maxlength={MAX_INQUIRY_TEXT}
					placeholder="Die ganze E-Mail hier einfügen – mit Von, Betreff und Signatur, dann werden die Angaben erkannt."
					bind:value={text}
					oninput={guess}
				></textarea>
			</label>
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="block sm:col-span-2">
					<span class="field-label">Betreff</span>
					<input class="input" name="betreff" maxlength="300" bind:value={fields.subject} oninput={() => (touched.subject = true)} />
				</label>
				<label class="block">
					<span class="field-label">Absender</span>
					<input class="input" name="name" maxlength="160" bind:value={fields.name} oninput={() => (touched.name = true)} />
				</label>
				<label class="block">
					<span class="field-label">E-Mail-Adresse</span>
					<input class="input" type="email" name="email" maxlength="200" bind:value={fields.email} oninput={() => (touched.email = true)} />
				</label>
				<label class="block">
					<span class="field-label">Telefon</span>
					<input class="input" name="telefon" maxlength="60" bind:value={fields.phone} oninput={() => (touched.phone = true)} />
				</label>
				<label class="block">
					<span class="field-label">Eingang</span>
					<input class="input num" type="date" name="eingang" value={data.today} />
				</label>
				<label class="block sm:col-span-2">
					<span class="field-label">Ausführungsort</span>
					<input class="input" name="ort" maxlength="300" placeholder="Wo gearbeitet werden soll – geht ins Angebot" />
				</label>
			</div>
			<p class="field-hint">Der passende Kunde wird über die E-Mail-Adresse gesucht; zuordnen lässt er sich auch danach.</p>
			{#if form?.message}<p class="field-error" role="alert">{form.message}</p>{/if}
			<div class="flex justify-end gap-2 pt-1">
				<button type="button" class="btn btn-ghost" onclick={() => (newOpen = false)}>Abbrechen</button>
				<button class="btn btn-primary" disabled={busy}>Anfrage anlegen</button>
			</div>
		</form>
	</Dialog>
{/if}
