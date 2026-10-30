<script lang="ts">
	/**
	 * Eine Anfrage: links die E-Mail, rechts Absender, Kunde und Ort. Von hier
	 * aus wird das Angebot geschrieben – Kunde, BV und Ausführungsort gehen mit.
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import FilePen from '@lucide/svelte/icons/file-pen-line';
	import Archive from '@lucide/svelte/icons/archive';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Trash from '@lucide/svelte/icons/trash';
	import Mail from '@lucide/svelte/icons/mail';
	import Phone from '@lucide/svelte/icons/phone';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Dialog from '$lib/components/Dialog.svelte';
	import CustomerFields from '$lib/modules/auftraege/components/CustomerFields.svelte';
	import CaseDocuments from '$lib/modules/auftraege/components/CaseDocuments.svelte';
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';
	import { date as dateLabel, dateTime } from '$lib/format';
	import { MAX_INQUIRY_TEXT } from '$lib/modules/auftraege/inquiry';
	import { OFFER_TITLE_DEFAULT, spacedNumber, titleToEnd } from '$lib/modules/auftraege/offer';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();
	const inquiry = $derived(data.inquiry);

	let offerOpen = $state(false);
	let customerOpen = $state(false);
	let deleteOpen = $state(false);
	let busy = $state(false);

	const stand = $derived(inquiry.closedAt ? { label: 'Erledigt', tone: 'badge-ok' } : { label: 'Offen', tone: 'badge-info' });
	const author = $derived([inquiry.creatorFirst, inquiry.creatorLast].filter(Boolean).join(' '));
	const fromWebsite = $derived(inquiry.source === 'webseite');
</script>

<svelte:head><title>{pageTitle(inquiry.subject || 'Anfrage')}</title></svelte:head>

<a href="/anfragen" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Anfragen
</a>

<div class="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-[2rem] leading-tight">{inquiry.subject || 'Anfrage ohne Betreff'}</h1>
		<p class="text-ink-2">
			Eingang {dateLabel(inquiry.receivedOn)}{inquiry.senderName || inquiry.senderEmail ? ` · von ${inquiry.senderName || inquiry.senderEmail}` : ''}{inquiry.senderCompany
				? ` (${inquiry.senderCompany})`
				: ''}{fromWebsite ? ' · über die Webseite' : ''}
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<span class="badge {stand.tone}">{stand.label}</span>
		{#if inquiry.offerId && data.canSeeOffer}
			<a href="/angebote/{inquiry.offerId}" class="btn btn-secondary"><FilePen size={18} aria-hidden="true" />Angebot {spacedNumber(inquiry.offerNumber ?? '')}</a>
		{:else if data.canCreateOffer}
			<button class="btn btn-primary" onclick={() => (offerOpen = true)}><FilePen size={18} aria-hidden="true" />Angebot erstellen</button>
		{/if}
	</div>
</div>

{#if form && 'message' in form && form.message}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>{/if}

<form
	method="POST"
	action="?/save"
	class="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
	use:enhance={() => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') toast.success('Anfrage gespeichert');
			await update({ reset: false });
		};
	}}
>
	<section class="card p-4 lg:p-5">
		<h2 class="flex items-center gap-2 text-lg"><Mail size={18} aria-hidden="true" />{fromWebsite ? 'Nachricht über die Webseite' : 'E-Mail'}</h2>
		{#if data.canEdit}
			<textarea class="textarea mt-3 min-h-[24rem] font-mono text-[0.8125rem] leading-relaxed" name="text" maxlength={MAX_INQUIRY_TEXT} value={inquiry.body}></textarea>
		{:else}
			<p class="mt-3 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap">{inquiry.body || 'Kein Text eingefügt.'}</p>
		{/if}
	</section>

	<section class="card p-4 lg:p-5">
		<h2 class="text-lg">Angaben</h2>
		<fieldset class="contents" disabled={!data.canEdit}>
			<div class="mt-3 grid gap-3">
				<label class="block">
					<span class="field-label">Betreff</span>
					<input class="input" name="betreff" maxlength="300" value={inquiry.subject} />
				</label>
				<div class="grid gap-3 sm:grid-cols-2">
					<label class="block">
						<span class="field-label">Absender</span>
						<input class="input" name="name" maxlength="160" value={inquiry.senderName} />
					</label>
					<label class="block">
						<span class="field-label">Firma</span>
						<input class="input" name="firma" maxlength="160" value={inquiry.senderCompany} />
					</label>
					<label class="block">
						<span class="field-label">E-Mail-Adresse</span>
						<input class="input" type="email" name="email" maxlength="200" value={inquiry.senderEmail} />
					</label>
					<label class="block">
						<span class="field-label">Telefon</span>
						<input class="input" name="telefon" maxlength="60" value={inquiry.senderPhone} />
					</label>
					<label class="block">
						<span class="field-label">Eingang</span>
						<input class="input num" type="date" name="eingang" required value={inquiry.receivedOn} />
					</label>
				</div>
				{#if inquiry.senderEmail || inquiry.senderPhone}
					<p class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
						{#if inquiry.senderEmail}
							<a href="mailto:{inquiry.senderEmail}" class="inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline"><Mail size={15} aria-hidden="true" />Antworten</a>
						{/if}
						{#if inquiry.senderPhone}
							<a href="tel:{inquiry.senderPhone.replace(/[^\d+]/g, '')}" class="inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline"
								><Phone size={15} aria-hidden="true" />Anrufen</a
							>
						{/if}
					</p>
				{/if}
				<div>
					<span class="field-label" id="kunde-label">Kunde</span>
					<div class="flex gap-2">
						<select class="select flex-1" name="kunde" aria-labelledby="kunde-label" value={inquiry.customerId ? String(inquiry.customerId) : ''}>
							<option value="">Noch keiner</option>
							{#each data.customers as c (c.id)}<option value={String(c.id)}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>{/each}
							{#if inquiry.customerId && !data.customers.some((c) => c.id === inquiry.customerId)}
								<option value={String(inquiry.customerId)}>{inquiry.customerName}</option>
							{/if}
						</select>
						{#if data.canAddCustomer}
							<button type="button" class="btn btn-secondary btn-icon" title="Neuer Kunde aus der Anfrage" aria-label="Neuer Kunde" onclick={() => (customerOpen = true)}>
								<UserPlus size={18} />
							</button>
						{/if}
					</div>
				</div>
				<label class="block">
					<span class="field-label">Ausführungsort</span>
					<input class="input" name="ort" maxlength="300" value={inquiry.location} placeholder="Geht ins Angebot" />
				</label>
				<label class="block">
					<span class="field-label">Notiz</span>
					<textarea class="textarea" name="notiz" rows="3" maxlength="2000" value={inquiry.note}></textarea>
				</label>
			</div>
		</fieldset>
		{#if data.canEdit}<button class="btn btn-secondary mt-4" disabled={busy}>Speichern</button>{/if}
		<p class="mt-4 text-[0.8125rem] text-ink-3">
			{fromWebsite ? `Über das Kontaktformular der Webseite eingegangen am ${dateTime(inquiry.createdAt)}.` : `Angelegt ${dateTime(inquiry.createdAt)}${author ? ` von ${author}` : ''}.`}
		</p>
	</section>
</form>

<div class="grid gap-x-4 xl:grid-cols-2">
	<CaseDocuments
		documents={data.documents}
		here="anfrage"
		hrefBase="/anfragen/{inquiry.id}/unterlagen"
		canManage={data.canEdit}
		crewDefault
		message={form && 'docError' in form ? String(form.docError ?? '') : ''}
	/>
	<PhotoGallery
		base="/anfragen/{inquiry.id}/fotos"
		photos={data.photos}
		editable={data.canEdit}
		hint="Gehören zum ganzen Vorgang – an Anfrage, Angebot und Auftrag stehen dieselben. Nicht beim Kunden."
		empty="Noch keine Fotos – z. B. vom Besichtigungstermin, auch direkt mit der Kamera."
	/>
</div>

<div class="mt-4 flex flex-wrap gap-2">
	{#if data.canEdit && inquiry.offerStatus !== 'angenommen'}
		{#if inquiry.closedAt}
			<form method="POST" action="?/reopen" use:enhance={() => async ({ update }) => (toast.success('Wieder bei den offenen'), await update())}>
				<button class="btn btn-ghost"><ArchiveRestore size={18} aria-hidden="true" />Wieder öffnen</button>
			</form>
		{:else}
			<form method="POST" action="?/close" use:enhance={() => async ({ update }) => (toast.success('Anfrage abgelegt'), await update())}>
				<button class="btn btn-ghost" title="Etwa wenn kein Angebot kommt"><Archive size={18} aria-hidden="true" />Als erledigt ablegen</button>
			</form>
		{/if}
	{/if}
	{#if data.canDelete}
		<button type="button" class="btn btn-ghost ml-auto text-danger hover:bg-danger-soft" onclick={() => (deleteOpen = true)}>
			<Trash size={18} aria-hidden="true" />Anfrage löschen
		</button>
	{/if}
</div>

{#if data.suggestion}
	<Dialog bind:open={offerOpen} title="Angebot aus der Anfrage">
		<form
			method="POST"
			action="?/offer"
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
				<span class="field-label">Kunde</span>
				<select class="select" name="kunde" value={inquiry.customerId ? String(inquiry.customerId) : ''}>
					<option value="">Später auswählen bzw. neu anlegen</option>
					{#each data.customers as c (c.id)}<option value={String(c.id)}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>{/each}
				</select>
			</label>
			<label class="block">
				<span class="field-label">Bauvorhaben (BV)</span>
				<input class="input" name="titel" maxlength="300" value={inquiry.subject || OFFER_TITLE_DEFAULT} onfocus={titleToEnd} />
			</label>
			<div class="grid grid-cols-2 gap-4">
				<label class="block">
					<span class="field-label">Angebotsnummer *</span>
					<input class="input num" name="nummer" required maxlength="30" />
				</label>
				<label class="block">
					<span class="field-label">Datum *</span>
					<input class="input num" type="date" name="datum" required value={data.suggestion.date} />
				</label>
			</div>
			<p class="field-hint">
				{inquiry.location ? `Ausführungsort „${inquiry.location}“ geht mit.` : 'Ausführungsort lässt sich im Angebot eintragen.'} Speichere vorher geänderte Angaben der Anfrage.
			</p>
			{#if form && 'offerMessage' in form && form.offerMessage}<p class="field-error" role="alert">{form.offerMessage}</p>{/if}
			<div class="flex justify-end gap-2 pt-1">
				<button type="button" class="btn btn-ghost" onclick={() => (offerOpen = false)}>Abbrechen</button>
				<button class="btn btn-primary" disabled={busy}>Angebot anlegen</button>
			</div>
		</form>
	</Dialog>
{/if}

{#if data.canAddCustomer}
	<Dialog bind:open={customerOpen} title="Neuer Kunde aus der Anfrage" wide>
		<form
			method="POST"
			action="?/newCustomer"
			class="space-y-4"
			use:enhance={() => async ({ result, update }) => {
				if (result.type === 'success') {
					customerOpen = false;
					toast.success('Kunde angelegt und zugeordnet');
				}
				await update({ reset: false });
			}}
		>
			<CustomerFields customer={{ name: inquiry.senderCompany || inquiry.senderName, email: inquiry.senderEmail, phone: inquiry.senderPhone, contact: inquiry.senderName }} />
			{#if form && 'customerMessage' in form && form.customerMessage}<p class="field-error" role="alert">{form.customerMessage}</p>{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-ghost" onclick={() => (customerOpen = false)}>Abbrechen</button>
				<button class="btn btn-primary">Kunde anlegen</button>
			</div>
		</form>
	</Dialog>
{/if}

<Dialog bind:open={deleteOpen} title="Anfrage löschen?">
	<p class="text-ink-2">Die Anfrage samt eingefügter E-Mail wird gelöscht.{inquiry.offerId ? ' Das Angebot bleibt, nur ohne Verweis auf die Anfrage.' : ''}</p>
	<form method="POST" action="?/delete" class="mt-5 flex justify-end gap-2" use:enhance>
		<button type="button" class="btn btn-ghost" onclick={() => (deleteOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary"><Trash size={18} aria-hidden="true" />Löschen</button>
	</form>
</Dialog>
