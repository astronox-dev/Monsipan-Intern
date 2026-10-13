<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import Mail from '@lucide/svelte/icons/mail';
	import DatabaseBackup from '@lucide/svelte/icons/database-backup';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import FilePen from '@lucide/svelte/icons/file-pen-line';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import History from '@lucide/svelte/icons/history';
	import ScanBarcode from '@lucide/svelte/icons/scan-barcode';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Globe from '@lucide/svelte/icons/globe';
	import Copy from '@lucide/svelte/icons/copy';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Unplug from '@lucide/svelte/icons/unplug';
	import { goto, invalidateAll } from '$app/navigation';
	import Dialog from '$lib/components/Dialog.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { dateTime, int } from '$lib/format';
	import { can } from '$lib/permissions';
	import { isResetPhrase } from '$lib/reset-phrase';
	import { toast } from '$lib/stores/toast.svelte';

	let { data } = $props();
	/** Ansehen darf, wer Einstellungen sieht – ändern (auch Sicherungen) nur mit „Bearbeiten" */
	const canEdit = $derived(can(data.user.role, 'einstellungen.bearbeiten'));
	let busy = $state('');

	// Sicherung wiederherstellen
	let restoreOpen = $state(false);
	let restoreSource = $state<{ file: string; label: string; upload: File | null } | null>(null);
	let restorePassword = $state('');
	let restoreError = $state('');
	let restoreResult = $state<{ source: string; backup: string; products: number; movements: number; users: number } | null>(null);
	let uploadInput = $state<HTMLInputElement | null>(null);
	let restoreDone = $state(false);

	function askRestore(source: { file: string; label: string; upload: File | null }) {
		restoreSource = source;
		restorePassword = '';
		restoreError = '';
		restoreOpen = true;
	}

	function pickUpload(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (file.size > data.maxUploadBytes) {
			toast.error('Datei zu groß', `Erlaubt sind ${mb(data.maxUploadBytes)}.`);
			input.value = '';
			return;
		}
		askRestore({ file: '', label: file.name, upload: file });
	}

	// Alles zurücksetzen
	let resetOpen = $state(false);
	let phrase = $state('');
	let resetPassword = $state('');
	let resetError = $state('');
	const phraseOk = $derived(isResetPhrase(phrase));
	const c = $derived(data.resetCounts);
	const nothingLeft = $derived(c.products + c.movements + c.locations + c.parties + c.categories + c.colors === 0);

	function openReset() {
		phrase = '';
		resetPassword = '';
		resetError = '';
		resetOpen = true;
	}

	/** Angefangene Buchungen im Browser verweisen auf gelöschte Artikel */
	function clearDrafts() {
		try {
			for (const k of Object.keys(localStorage)) if (k.startsWith('lager-buchung-')) localStorage.removeItem(k);
		} catch {
			/* kein Speicherzugriff */
		}
	}

	const mb = (b: number) => `${(b / 1024 / 1024).toLocaleString('de-AT', { maximumFractionDigits: 1 })} MB`;

	async function copy(value: string, what: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`${what} kopiert`);
		} catch {
			toast.info('Kopieren ging nicht – bitte im Feld markieren und kopieren.');
		}
	}

	const done =
		(key: string, ok: (d: Record<string, unknown>) => string) =>
		() => {
			busy = key;
			return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
				busy = '';
				if (result.type === 'failure') toast.error(String(result.data?.message ?? 'Fehlgeschlagen'));
				else if (result.type === 'success') toast.success(ok(result.data ?? {}));
				await update({ reset: false });
			};
		};
</script>

<svelte:head><title>{pageTitle('Einstellungen')}</title></svelte:head>

<div class="pt-2 pb-5">
	<h1 class="text-[2rem] leading-tight">Einstellungen</h1>
	<p class="text-ink-2">E-Mail-Versand, Kontaktformular der Webseite, Vorlagen und Datensicherung.</p>
	{#if !canEdit}<p class="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">Nur zum Ansehen – ändern darf, wer Einstellungen bearbeiten darf.</p>{/if}
</div>

<fieldset disabled={!canEdit} class="contents">
<div class="grid gap-4 lg:grid-cols-2">
	<section class="card p-4 lg:col-span-2 lg:p-6" aria-labelledby="h-mail">
		<h2 id="h-mail" class="flex items-center gap-2 text-xl"><Mail size={20} aria-hidden="true" />E-Mail-Versand</h2>
		{#if data.mail.configured}
			<p class="mt-3 flex items-center gap-2 text-ok"><CircleCheck size={18} aria-hidden="true" /><span class="font-medium">Eingerichtet über {data.mail.host}</span></p>
			<p class="mt-1 text-sm text-ink-3">Absender: {data.mail.from || '–'}</p>
		{:else}
			<p class="mt-3 flex items-center gap-2 text-warn"><CircleAlert size={18} aria-hidden="true" /><span class="font-medium">Nicht eingerichtet</span></p>
			<p class="mt-1 text-sm text-ink-2">
				Ohne SMTP landen Mails nur im Server-Log. Zum Einrichten <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> und <code>MAIL_FROM</code> in der <code>.env</code> setzen und den Container neu starten.
			</p>
		{/if}
		<p class="mt-2 text-sm text-ink-2">
			Welche Info-Mails an wen gehen, steht unter <a href="/verwaltung/benachrichtigungen" class="font-medium text-ink underline underline-offset-2">Benachrichtigungen</a>.
		</p>
		<form method="POST" action="?/testMail" class="mt-4 flex max-w-xl gap-2" use:enhance={done('mail', (d) => `Test-Mail an ${d.mailed} gesendet`)}>
			<label for="test-to" class="sr-only">Empfänger der Test-Mail</label>
			<input id="test-to" name="to" type="email" class="input flex-1" placeholder="E-Mail-Adresse" value={data.myEmail ?? ''} required />
			<button class="btn btn-secondary" disabled={busy === 'mail'}>Test senden</button>
		</form>
	</section>

	<section class="card p-4 lg:col-span-2 lg:p-6" aria-labelledby="h-website">
		<h2 id="h-website" class="flex items-center gap-2 text-xl"><Globe size={20} aria-hidden="true" />Kontaktformular der Webseite</h2>
		<p class="mt-1 text-sm text-ink-2">
			Anfragen über das Kontaktformular auf monsipan.at landen automatisch unter <a href="/anfragen" class="font-medium text-ink underline underline-offset-2">Anfragen</a> –
			zusätzlich zur E-Mail ans Büro. Bewerbungen gehen weiter nur per E-Mail.
		</p>
		{#if data.website.link}
			{@const link = data.website.link}
			<p class="mt-3 flex items-center gap-2 text-ok"><CircleCheck size={18} aria-hidden="true" /><span class="font-medium">Verbunden</span></p>
			<p class="mt-1 text-sm text-ink-3">{link.lastAt ? `Zuletzt eine Anfrage eingegangen: ${dateTime(new Date(link.lastAt))}` : 'Noch keine Anfrage eingegangen.'}</p>
			<div class="mt-4 grid max-w-3xl gap-3">
				{#each [{ name: 'PORTAL_URL', value: data.website.portalUrl }, { name: 'PORTAL_KEY', value: link.key }] as v (v.name)}
					<div>
						<label class="field-label" for="web-{v.name}"><code>{v.name}</code></label>
						<div class="flex gap-2">
							<input id="web-{v.name}" class="input flex-1 font-mono text-[0.8125rem]" readonly value={v.value} onfocus={(e) => e.currentTarget.select()} />
							<button type="button" class="btn btn-secondary btn-icon" title="Kopieren" aria-label="{v.name} kopieren" onclick={() => copy(v.value, v.name)}><Copy size={18} /></button>
						</div>
					</div>
				{/each}
			</div>
			<p class="mt-3 max-w-3xl text-sm text-ink-2">
				Diese beiden Werte in Portainer im Stack der Webseite unter „Environment variables" eintragen und den Stack neu laden („Update the stack").
				Danach eine Testanfrage über die Webseite schicken – sie steht gleich unter Anfragen.
			</p>
			<div class="mt-4 flex flex-wrap gap-2">
				<form method="POST" action="?/websiteKey" use:enhance={done('websiteKey', () => 'Neuer Schlüssel – bitte im Stack der Webseite eintragen')}>
					<button class="btn btn-secondary" disabled={busy === 'websiteKey'}><RefreshCw size={18} aria-hidden="true" />Neuer Schlüssel</button>
				</form>
				<form method="POST" action="?/websiteOff" use:enhance={done('websiteOff', () => 'Webseite getrennt')}>
					<button class="btn btn-ghost" disabled={busy === 'websiteOff'}><Unplug size={18} aria-hidden="true" />Trennen</button>
				</form>
			</div>
		{:else}
			<p class="mt-3 flex items-center gap-2 text-ink-2"><CircleAlert size={18} aria-hidden="true" /><span class="font-medium">Nicht verbunden</span></p>
			<form method="POST" action="?/websiteKey" class="mt-4" use:enhance={done('websiteKey', () => 'Schlüssel erzeugt')}>
				<button class="btn btn-secondary" disabled={busy === 'websiteKey'}><Globe size={18} aria-hidden="true" />Verbindung einrichten</button>
			</form>
		{/if}
	</section>

	<section class="card p-4 lg:col-span-2 lg:p-6" aria-labelledby="h-offers">
		<h2 id="h-offers" class="flex items-center gap-2 text-xl"><FilePen size={20} aria-hidden="true" />Angebote, Aufträge und Rechnungen</h2>
		<p class="mt-1 text-sm text-ink-2">Briefkopf und Vorlagetexte. Einleitung und Schlusstext kommen in jedes neue Angebot und lassen sich dort ändern.</p>

		<div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
			<div>
				<p class="field-label">Briefkopf</p>
				{#if data.letterhead}
					<img src="/verwaltung/einstellungen/briefkopf" alt="Briefkopf" class="max-h-28 w-full rounded-xl border border-line bg-white object-contain p-2" />
				{:else}
					<p class="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">Noch kein Bild – das PDF setzt den Briefkopf aus dem Logo und der Anschrift.</p>
				{/if}
				<form method="POST" action="?/letterhead" enctype="multipart/form-data" class="mt-3 flex flex-wrap items-center gap-2" use:enhance={done('letterhead', () => 'Briefkopf gespeichert')}>
					<input type="file" name="bild" accept="image/png,image/jpeg" required class="block w-full max-w-xs text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:font-medium" />
					<button class="btn btn-secondary btn-sm" disabled={busy === 'letterhead'}><Upload size={16} aria-hidden="true" />Hochladen</button>
				</form>
				{#if data.letterhead}
					<form method="POST" action="?/letterheadRemove" class="mt-2" use:enhance={done('letterheadRemove', () => 'Briefkopf entfernt')}>
						<button class="btn btn-ghost btn-sm">Bild entfernen</button>
					</form>
				{/if}
				<p class="field-hint mt-2">PNG oder JPG, am besten der ganze Kopf als breiter Streifen (Logo, Firmenname, Anschrift). Er wird oben mittig eingepasst.</p>
			</div>

			<form method="POST" action="?/offerTexts" class="space-y-3" use:enhance={done('offerTexts', () => 'Vorlagen gespeichert')}>
				<label class="block">
					<span class="field-label">Einleitung</span>
					<textarea class="textarea" name="intro" rows="2" maxlength="3000">{data.settings.offerIntro}</textarea>
				</label>
				<label class="block">
					<span class="field-label">Schlusstext</span>
					<textarea class="textarea" name="closing" rows="4" maxlength="5000">{data.settings.offerClosing}</textarea>
				</label>
				<div class="grid gap-3 sm:grid-cols-3">
					<label class="block">
						<span class="field-label">Fußzeile: Anschrift</span>
						<textarea class="textarea text-sm" name="footerAddress" rows="4" maxlength="400">{data.settings.offerFooterAddress}</textarea>
					</label>
					<label class="block">
						<span class="field-label">Fußzeile: Bank</span>
						<textarea class="textarea text-sm" name="footerBank" rows="4" maxlength="400">{data.settings.offerFooterBank}</textarea>
					</label>
					<label class="block">
						<span class="field-label">Fußzeile: Kontakt</span>
						<textarea class="textarea text-sm" name="footerContact" rows="4" maxlength="400">{data.settings.offerFooterContact}</textarea>
					</label>
				</div>
				<button class="btn btn-secondary" disabled={busy === 'offerTexts'}>Speichern</button>
			</form>
		</div>

		<form method="POST" action="?/invoiceTexts" class="mt-6 space-y-3 border-t border-line pt-5" use:enhance={done('invoiceTexts', () => 'Vorlagen für Rechnungen gespeichert')}>
			<h3 class="font-display text-lg font-semibold">Rechnungen</h3>
			<p class="text-sm text-ink-2">Briefkopf und Fußzeile wie bei den Angeboten. Einleitung, Schlusstext und Zahlungsziel kommen in jede neue Rechnung und lassen sich dort ändern.</p>
			<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
				<label class="block">
					<span class="field-label">Einleitung</span>
					<textarea class="textarea" name="intro" rows="3" maxlength="3000">{data.settings.invoiceIntro}</textarea>
				</label>
				<label class="block">
					<span class="field-label">Schlusstext</span>
					<textarea class="textarea" name="closing" rows="3" maxlength="5000">{data.settings.invoiceClosing}</textarea>
				</label>
				<label class="block">
					<span class="field-label">Zahlungsziel</span>
					<span class="flex items-center gap-2"><input class="input num" type="number" name="days" min="0" max="365" required value={data.settings.invoicePaymentDays} />Tage</span>
				</label>
			</div>
			<button class="btn btn-secondary" disabled={busy === 'invoiceTexts'}>Speichern</button>
		</form>

		<div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
			<div class="min-w-0">
				<h3 class="font-display text-lg font-semibold">Digitale Signatur und Archiv</h3>
				<p class="text-sm text-ink-2">PAdES-Signatur ausgestellter Rechnungen, Prüfcode, Zertifikat und Archivprüfung.</p>
			</div>
			<a href="/verwaltung/einstellungen/signatur" class="btn btn-secondary"><ShieldCheck size={18} aria-hidden="true" />Rechnungssignatur</a>
		</div>
	</section>

	<section class="card p-4 lg:p-6" aria-labelledby="h-backup">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 id="h-backup" class="flex items-center gap-2 text-xl"><DatabaseBackup size={20} aria-hidden="true" />Datensicherung</h2>
				<p class="mt-1 text-sm text-ink-2">
					Jede Nacht automatisch, die letzten 14 Stände bleiben erhalten. Sicherungen vor einem Zurücksetzen werden getrennt aufbewahrt (die letzten 10). Datenbank derzeit {mb(data.stats.dbSize)}.
				</p>
			</div>
			<form method="POST" action="?/backup" use:enhance={done('backup', (d) => `Sicherung ${d.backup} erstellt`)}>
				<button class="btn btn-secondary" disabled={busy === 'backup'}>Jetzt sichern</button>
			</form>
		</div>
		<ul class="mt-4 divide-y divide-line rounded-xl border border-line">
			{#each data.backups as b (b.file)}
				<li class="flex items-center gap-3 px-3 py-2 text-sm">
					<span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
						{dateTime(b.createdAt)}
						{#if b.label}
							<span class="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">{b.label}</span>
						{/if}
					</span>
					<span class="text-ink-3">{mb(b.size)}</span>
					<button
						class="btn btn-ghost btn-sm btn-icon"
						aria-label="Sicherung vom {dateTime(b.createdAt)} wiederherstellen"
						title="Wiederherstellen"
						onclick={() => askRestore({ file: b.file, label: `Sicherung vom ${dateTime(b.createdAt)}`, upload: null })}
					>
						<History size={16} />
					</button>
					{#if canEdit}
						<a href="/export/backup/{b.file}" class="btn btn-ghost btn-sm btn-icon" aria-label="Sicherung vom {dateTime(b.createdAt)} herunterladen" download>
							<Download size={16} />
						</a>
					{/if}
				</li>
			{:else}
				<li class="px-3 py-4 text-sm text-ink-3">Noch keine Sicherung vorhanden.</li>
			{/each}
		</ul>
		<div class="mt-4 rounded-xl border border-dashed border-line-strong p-3">
			<p class="text-sm text-ink-2">
				Sicherung von außerhalb einspielen, zum Beispiel nach einem Serverumzug. Der jetzige Stand wird vorher automatisch gesichert.
			</p>
			<input bind:this={uploadInput} type="file" accept=".db,application/vnd.sqlite3,application/octet-stream" class="sr-only" onchange={pickUpload} />
			<button class="btn btn-secondary btn-sm mt-3" onclick={() => uploadInput?.click()}>
				<Upload size={16} aria-hidden="true" />Sicherungsdatei hochladen
			</button>
		</div>
	</section>

	<section class="card p-4 lg:p-6" aria-labelledby="h-system">
		<h2 id="h-system" class="text-xl">System</h2>
		<dl class="mt-3 divide-y divide-line text-[0.9375rem]">
			<div class="flex justify-between py-2"><dt class="text-ink-3">Artikel</dt><dd class="num">{int(data.stats.products)}</dd></div>
			<div class="flex justify-between py-2"><dt class="text-ink-3">Buchungen</dt><dd class="num">{int(data.stats.movements)}</dd></div>
			<div class="flex justify-between py-2"><dt class="text-ink-3">Aktive Benutzer</dt><dd class="num">{int(data.stats.users)}</dd></div>
		</dl>
		<a href="/lager/scanner-test" class="btn btn-secondary mt-4"><ScanBarcode size={18} aria-hidden="true" />Scanner testen</a>
	</section>

	<!-- Gefahrenbereich -->
	<section class="card border-danger/40 p-4 lg:col-span-2 lg:p-6" aria-labelledby="h-danger">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="max-w-2xl">
				<h2 id="h-danger" class="flex items-center gap-2 text-xl text-danger"><TriangleAlert size={20} aria-hidden="true" />Alles zurücksetzen</h2>
				<p class="mt-1 text-sm text-ink-2">
					Löscht alle Artikel, Bestände, Bewegungen und Stammdaten (Lagerorte, Partien, Materialarten, Farben). Benutzerkonten und
					Einstellungen bleiben erhalten. Vorher wird automatisch eine Sicherung erstellt.
				</p>
			</div>
			<button class="btn btn-danger" onclick={openReset} disabled={nothingLeft}>Alles zurücksetzen …</button>
		</div>
	</section>
</div>
</fieldset>

<Dialog bind:open={resetOpen} title="Wirklich alle Daten löschen?" description="Dieser Schritt lässt sich in der App nicht rückgängig machen.">
	<form
		id="reset-form"
		method="POST"
		action="?/reset"
		class="space-y-4"
		use:enhance={() => {
			busy = 'reset';
			resetError = '';
			return async ({ result }) => {
				busy = '';
				if (result.type === 'failure') {
					resetError = String(result.data?.message ?? 'Zurücksetzen fehlgeschlagen');
					return;
				}
				if (result.type === 'success') {
					resetOpen = false;
					clearDrafts();
					toast.success('Alle Daten gelöscht', `Sicherung vorher: ${result.data?.backup ?? '–'}`);
					await invalidateAll();
					await goto('/');
				}
			};
		}}
	>
		<div class="rounded-xl bg-danger-soft p-4 text-sm">
			<p class="font-semibold text-danger">Das wird gelöscht:</p>
			<ul class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-ink">
				<li><span class="num font-semibold">{int(c.products)}</span> Artikel samt Codes und Bestand</li>
				<li><span class="num font-semibold">{int(c.movements)}</span> Bewegungen</li>
				<li><span class="num font-semibold">{int(c.locations)}</span> Lagerorte</li>
				<li><span class="num font-semibold">{int(c.parties)}</span> Partien</li>
				<li><span class="num font-semibold">{int(c.categories)}</span> Materialarten</li>
				<li><span class="num font-semibold">{int(c.colors)}</span> Farben</li>
			</ul>
			<p class="mt-3 text-ink-2">
				Die Sicherung davor findest du danach unter Datensicherung – nur damit lässt sich der alte Stand wiederherstellen.
			</p>
		</div>

		<div class="space-y-2">
			<label class="flex items-start gap-3 rounded-xl border border-line-strong p-3">
				<input type="checkbox" name="deleteUsers" class="mt-0.5 size-5 accent-[var(--c-danger)]" disabled={c.otherUsers === 0} />
				<span>
					<span class="font-medium">Auch alle anderen Benutzer löschen</span>
					<span class="block text-sm text-ink-3">{c.otherUsers} {c.otherUsers === 1 ? 'Konto' : 'Konten'} – dein eigenes Konto bleibt bestehen.</span>
				</span>
			</label>
			<label class="flex items-start gap-3 rounded-xl border border-line-strong p-3">
				<input type="checkbox" name="reseedCatalog" class="mt-0.5 size-5 accent-[var(--c-ink)]" />
				<span>
					<span class="font-medium">Standard-Materialarten und Verkehrsfarben neu anlegen</span>
					<span class="block text-sm text-ink-3">Kaltplastik, Farbe, Markierungsband … und RAL 9016, 1023, 3020 usw. Sonst startet alles leer.</span>
				</span>
			</label>
		</div>

		<div>
			<label for="reset-phrase" class="field-label">1. Zur Bestätigung <span class="font-semibold text-ink">{data.resetPhrase}</span> eintippen</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="reset-phrase"
				name="phrase"
				autofocus
				class="input"
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
				bind:value={phrase}
				aria-invalid={phrase.length > 0 && !phraseOk ? true : undefined}
			/>
		</div>
		<div>
			<label for="reset-password" class="field-label">2. Dein Passwort</label>
			<PasswordInput id="reset-password" name="password" autocomplete="current-password" bind:value={resetPassword} disabled={!phraseOk} />
		</div>
		{#if resetError}<p class="field-error" role="alert">{resetError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (resetOpen = false)}>Abbrechen</button>
		<button class="btn btn-danger" form="reset-form" disabled={!phraseOk || !resetPassword || busy === 'reset'}>
			{busy === 'reset' ? 'Wird gelöscht …' : 'Alle Daten endgültig löschen'}
		</button>
	{/snippet}
</Dialog>

<Dialog bind:open={restoreOpen} title="Sicherung einspielen?">
	<form
		id="restore-form"
		method="POST"
		action="?/restore"
		enctype="multipart/form-data"
		use:enhance={({ formData }) => {
			busy = 'restore';
			restoreError = '';
			if (restoreSource?.upload) formData.set('file', restoreSource.upload);
			else formData.set('backup', restoreSource?.file ?? '');
			return async ({ result }) => {
				busy = '';
				if (result.type === 'failure') {
					restoreError = String(result.data?.message ?? 'Einspielen fehlgeschlagen');
					return;
				}
				if (result.type === 'success') {
					const d = (result.data ?? {}) as { source?: string; backup?: string; contents?: { products: number; movements: number; users: number } };
					restoreOpen = false;
					clearDrafts();
					restoreDone = true;
					restoreResult = {
						source: d.source ?? '',
						backup: d.backup ?? '',
						products: d.contents?.products ?? 0,
						movements: d.contents?.movements ?? 0,
						users: d.contents?.users ?? 0
					};
				}
			};
		}}
	>
		<p class="text-ink-2">
			Der gesamte jetzige Stand wird durch
			<span class="font-medium text-ink">{restoreSource?.label ?? ''}</span>
			ersetzt: Artikel, Bestand, Bewegungen, Stammdaten und Benutzer.
		</p>
		<ul class="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
			<li>Vorher entsteht automatisch eine Sicherung des jetzigen Standes.</li>
			<li>Auch die Anmeldungen kommen aus der Sicherung. Wer dadurch abgemeldet wird, meldet sich einfach neu an.</li>
			<li>Ältere Sicherungen werden beim Einspielen automatisch auf den aktuellen Stand gebracht.</li>
		</ul>
		<div class="mt-4">
			<label for="restore-password" class="field-label">Zur Bestätigung dein Passwort</label>
			<!-- svelte-ignore a11y_autofocus -->
			<PasswordInput id="restore-password" name="password" autofocus autocomplete="current-password" bind:value={restorePassword} />
		</div>
		{#if restoreError}<p class="field-error mt-3" role="alert">{restoreError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (restoreOpen = false)}>Abbrechen</button>
		<button class="btn btn-danger" form="restore-form" disabled={!restorePassword || busy === 'restore'}>
			{busy === 'restore' ? 'Wird eingespielt …' : 'Sicherung einspielen'}
		</button>
	{/snippet}
</Dialog>

<Dialog bind:open={restoreDone} title="Sicherung eingespielt">
	{#if restoreResult}
		<p class="text-ink-2">
			<span class="font-medium text-ink">{restoreResult.source}</span> ist jetzt der aktuelle Stand:
			{int(restoreResult.products)} Artikel, {int(restoreResult.movements)} Bewegungen, {int(restoreResult.users)} Benutzer.
		</p>
		<p class="mt-2 text-sm text-ink-3">
			Der Stand von vorher liegt als <span class="num">{restoreResult.backup}</span> in der Liste der Sicherungen. Falls du dabei abgemeldet
			wurdest, einfach neu anmelden.
		</p>
	{/if}
	{#snippet footer()}
		<button class="btn btn-primary" onclick={() => ((restoreDone = false), goto('/', { invalidateAll: true }))}>Weiter</button>
	{/snippet}
</Dialog>

