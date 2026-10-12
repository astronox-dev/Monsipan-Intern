<script lang="ts">
	/** Digitale Rechnungssignatur: Einstellungen, Zertifikat, Verbindungstest und Archivprüfung */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Upload from '@lucide/svelte/icons/upload';
	import PlugZap from '@lucide/svelte/icons/plug-zap';
	import Archive from '@lucide/svelte/icons/archive';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Info from '@lucide/svelte/icons/info';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { date as dateLabel, dateTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import { PADES_LEVEL_LABELS, PROVIDER_LABELS } from '$lib/modules/auftraege/signature';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();
	const canEdit = $derived(can(data.user.role, 'einstellungen.bearbeiten'));
	// svelte-ignore state_referenced_locally
	let provider = $state(data.settings.provider);
	// svelte-ignore state_referenced_locally
	let level = $state(data.settings.level);
	let busy = $state('');
	const failed = (action: string) => (form && 'message' in form && form.action === action ? String(form.message) : '');
	const steps = $derived(form && 'steps' in form ? form.steps : null);
	const check = $derived(form && 'result' in form && form.result ? form.result : data.lastCheck);

	function done(key: string, message: string): SubmitFunction {
		return () => {
			busy = key;
			return async ({ result, update }) => {
				busy = '';
				if (result.type === 'success' && message) toast.success(message);
				await update({ reset: false });
			};
		};
	}

	const LEVEL_HINTS: Record<string, string> = {
		'B-B': 'Nur die Signatur – ohne Zeitstempel. Die Signaturzeit ist dann nur eine Angabe des Servers.',
		'B-T': 'Mit Zeitstempel eines Zeitstempeldienstes: die Signaturzeit ist belegt.',
		'B-LT': 'Zusätzlich Zertifikate und Sperrinformationen in der PDF – prüfbar, auch wenn Aussteller und Dienste nicht mehr erreichbar sind. Empfohlen.',
		'B-LTA': 'Zusätzlich ein Archivzeitstempel über alles – Grundlage für die Langzeitarchivierung.'
	};
	const TSA = [
		['http://timestamp.digicert.com', 'DigiCert – kostenlos, nicht qualifiziert'],
		['http://timestamp.sectigo.com', 'Sectigo – kostenlos, nicht qualifiziert'],
		['https://freetsa.org/tsr', 'FreeTSA – kostenlos, nicht qualifiziert']
	];
</script>

<svelte:head><title>{pageTitle('Rechnungssignatur')}</title></svelte:head>

<a href="/verwaltung/einstellungen" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Einstellungen
</a>
<h1 class="mt-3 text-[2rem] leading-tight">Rechnungssignatur</h1>
<p class="mt-1 max-w-3xl text-ink-2">
	Ausgestellte Rechnungen werden unverändert archiviert und mit Prüfsumme geschützt. Ist die Signatur an, bekommt jede zusätzlich eine digitale Signatur nach
	PAdES (eIDAS) – prüfbar in Adobe Acrobat Reader und über den Prüfcode auf der Rechnung.
</p>

<section class="card mt-5 flex flex-wrap items-center gap-4 p-4 lg:p-5 {data.settings.enabled ? 'border-ok/50' : ''}">
	{#if data.settings.enabled}
		<ShieldCheck size={28} class="shrink-0 text-ok" aria-hidden="true" />
		<p class="min-w-[14rem] flex-1">
			<span class="font-medium">Signatur an</span> · {PROVIDER_LABELS[data.settings.provider]} · {PADES_LEVEL_LABELS[data.settings.level]}
		</p>
	{:else}
		<ShieldOff size={28} class="shrink-0 text-ink-3" aria-hidden="true" />
		<p class="min-w-[14rem] flex-1">
			<span class="font-medium">Signatur aus</span> – ausgestellte Rechnungen werden archiviert und mit Prüfsumme geschützt, aber nicht digital signiert.
		</p>
	{/if}
</section>

<div class="mt-4 grid gap-4 lg:grid-cols-2">
	<!-- Einstellungen -->
	<section class="card p-4 lg:col-span-2 lg:p-6" aria-labelledby="h-settings">
		<h2 id="h-settings" class="text-xl">Einstellungen</h2>
		<form method="POST" action="?/save" class="mt-4 space-y-5" use:enhance={done('save', 'Gespeichert')}>
			<fieldset disabled={!canEdit} class="space-y-5">
				<label class="flex items-start gap-3">
					<input type="checkbox" name="enabled" class="mt-1 size-5 shrink-0 accent-[var(--c-ink)]" checked={data.settings.enabled} />
					<span>
						<span class="font-medium">Ausgestellte Rechnungen digital signieren</span>
						<span class="block text-sm text-ink-2">Gilt für alle Rechnungen, die ab jetzt endgültig ausgestellt werden. Schon ausgestellte lassen sich nachträglich signieren.</span>
					</span>
				</label>

				<div>
					<p class="field-label">Signaturdienstleister</p>
					<div class="mt-1 grid gap-2 sm:grid-cols-2">
						{#each ['lokal', 'csc'] as p (p)}
							<label class="flex items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-brand">
								<input type="radio" name="provider" value={p} class="mt-1" bind:group={provider} />
								<span>
									<span class="font-medium">{PROVIDER_LABELS[p]}</span>
									<span class="block text-sm text-ink-2">
										{p === 'lokal'
											? 'Zertifikat und Schlüssel liegen verschlüsselt am Server. Kostenlos mit eigenem Zertifikat; ein gekauftes (nicht qualifiziertes) lässt sich hochladen.'
											: 'Signiert beim Vertrauensdiensteanbieter – Voraussetzung für ein qualifiziertes elektronisches Siegel. Kostenpflichtig, Zugangsdaten vom Anbieter.'}
									</span>
								</span>
							</label>
						{/each}
					</div>
				</div>

				{#if provider === 'csc'}
					<div class="space-y-3 rounded-xl bg-surface-2 p-4">
						<p class="text-sm text-ink-2">
							Angaben aus dem Vertrag mit dem Anbieter (bei A-Trust: „Hash-Signing über die CSC-API"). Geheimnisse gehören nicht hierher, sondern in die
							Umgebungsvariablen <code>SIGNATUR_CSC_SECRET</code> (Client-Secret bzw. Passwort) und gegebenenfalls <code>SIGNATUR_CSC_PIN</code>.
						</p>
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="block">
								<span class="field-label">Anbieter</span>
								<select class="input" name="cscPreset" value={data.settings.csc.preset}>
									<option value="a-trust">A-Trust (Österreich)</option>
									<option value="andere">Anderer Anbieter mit CSC-API</option>
								</select>
							</label>
							<label class="block">
								<span class="field-label">CSC-Version</span>
								<select class="input" name="cscVersion" value={data.settings.csc.version}>
									<option value="v1">v1</option>
									<option value="v2">v2</option>
								</select>
							</label>
							<label class="block sm:col-span-2">
								<span class="field-label">Adresse der CSC-API</span>
								<input class="input" name="cscBaseUrl" type="url" placeholder="https://…/csc/v1" value={data.settings.csc.baseUrl} />
							</label>
							<label class="block">
								<span class="field-label">Anmeldung</span>
								<select class="input" name="cscAuth" value={data.settings.csc.auth}>
									<option value="oauth2">OAuth2 (Client Credentials)</option>
									<option value="basic">Benutzer und Passwort (/auth/login)</option>
								</select>
							</label>
							<label class="block">
								<span class="field-label">Token-Adresse (OAuth2)</span>
								<input class="input" name="cscTokenUrl" type="url" placeholder="https://…/oauth2/token" value={data.settings.csc.tokenUrl} />
							</label>
							<label class="block">
								<span class="field-label">Client-ID bzw. Benutzer</span>
								<input class="input" name="cscClientId" autocomplete="off" value={data.settings.csc.clientId} />
							</label>
							<label class="block">
								<span class="field-label">Kennung des Siegels (credentialID)</span>
								<input class="input" name="cscCredentialId" autocomplete="off" value={data.settings.csc.credentialId} />
							</label>
						</div>
						<p class="text-sm">
							{#if data.secrets.cscSecret}<CircleCheck size={16} class="inline text-ok" aria-hidden="true" /> SIGNATUR_CSC_SECRET gesetzt{:else}<CircleX
									size={16}
									class="inline text-danger"
									aria-hidden="true"
								/> SIGNATUR_CSC_SECRET fehlt{/if}
							· {data.secrets.cscPin ? 'PIN gesetzt' : 'ohne PIN'}
						</p>
					</div>
				{:else}
					<input type="hidden" name="cscPreset" value={data.settings.csc.preset} />
					<input type="hidden" name="cscVersion" value={data.settings.csc.version} />
					<input type="hidden" name="cscBaseUrl" value={data.settings.csc.baseUrl} />
					<input type="hidden" name="cscAuth" value={data.settings.csc.auth} />
					<input type="hidden" name="cscTokenUrl" value={data.settings.csc.tokenUrl} />
					<input type="hidden" name="cscClientId" value={data.settings.csc.clientId} />
					<input type="hidden" name="cscCredentialId" value={data.settings.csc.credentialId} />
				{/if}

				<div class="grid gap-4 lg:grid-cols-2">
					<label class="block">
						<span class="field-label">Signaturverfahren</span>
						<select class="input" name="level" bind:value={level}>
							{#each data.levels as l (l)}<option value={l}>{PADES_LEVEL_LABELS[l]}</option>{/each}
						</select>
						<span class="field-hint">{LEVEL_HINTS[level]}</span>
					</label>
					<label class="block">
						<span class="field-label">Zeitstempeldienst (RFC 3161)</span>
						<input class="input" name="tsaUrl" list="tsa-list" placeholder="http://…" value={data.settings.tsaUrl} disabled={level === 'B-B'} />
						<datalist id="tsa-list">{#each TSA as [url, label] (url)}<option value={url}>{label}</option>{/each}</datalist>
						<span class="field-hint">
							Es geht nur eine Prüfsumme an den Dienst, nie die Rechnung. Qualifizierte Zeitstempel (z. B. A-Trust) sind kostenpflichtig; Zugang über
							<code>SIGNATUR_TSA_BENUTZER</code>/<code>SIGNATUR_TSA_PASSWORT</code>{data.secrets.tsaAuth ? ' (gesetzt)' : ''}.
						</span>
						{#if level === 'B-B'}<input type="hidden" name="tsaUrl" value={data.settings.tsaUrl} />{/if}
					</label>
				</div>

				<div class="grid gap-4 lg:grid-cols-2">
					<div>
						<label class="flex items-start gap-3">
							<input type="checkbox" name="verifyEnabled" class="mt-1 size-5 shrink-0 accent-[var(--c-ink)]" checked={data.settings.verifyEnabled} />
							<span>
								<span class="font-medium">Prüfcode und öffentliche Prüfseite</span>
								<span class="block text-sm text-ink-2">QR-Code auf jeder neu ausgestellten Rechnung; die Seite zeigt nur Nummer, Datum, Status und das Prüfergebnis.</span>
							</span>
						</label>
						<label class="mt-3 block">
							<span class="field-label">Adresse für den Prüfcode</span>
							<input class="input" name="verifyBaseUrl" type="url" placeholder={data.origin || 'https://portal.monsipan.at'} value={data.settings.verifyBaseUrl} />
							<span class="field-hint">Leer: die Adresse des Portals (ORIGIN). Steht dauerhaft auf der Rechnung – Beispiel: {data.verifyExample}</span>
						</label>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="block">
							<span class="field-label">Grund in der Signatur</span>
							<input class="input" name="reason" maxlength="120" value={data.settings.reason} />
						</label>
						<label class="block">
							<span class="field-label">Ort</span>
							<input class="input" name="location" maxlength="80" value={data.settings.location} />
						</label>
						<label class="block sm:col-span-2">
							<span class="field-label">Aufbewahrung</span>
							<span class="flex items-center gap-2"><input class="input num w-28" type="number" name="retentionYears" min="7" max="50" value={data.settings.retentionYears} />Jahre ab Ende des Rechnungsjahres</span>
							<span class="field-hint">§ 132 BAO: sieben Jahre; länger z. B. bei Grundstücken. Ausgestellte Rechnungen werden nie gelöscht – die Frist steht zur Information bei jeder Rechnung.</span>
						</label>
					</div>
				</div>
			</fieldset>
			{#if failed('save')}<p class="text-sm text-danger" role="alert">{failed('save')}</p>{/if}
			{#if canEdit}<button class="btn btn-primary" disabled={busy === 'save'}>Speichern</button>{/if}
		</form>
	</section>

	<!-- Zertifikat -->
	<section class="card p-4 lg:p-6" aria-labelledby="h-cert">
		<h2 id="h-cert" class="flex items-center gap-2 text-xl"><KeyRound size={20} aria-hidden="true" />Eigenes Zertifikat</h2>
		<p class="mt-1 text-sm">
			{#if data.secrets.keyPassword}<CircleCheck size={16} class="inline text-ok" aria-hidden="true" /> SIGNATUR_PASSWORT gesetzt{:else}<CircleX
					size={16}
					class="inline text-danger"
					aria-hidden="true"
				/>
				{#if data.secrets.keyPasswordShort}
					SIGNATUR_PASSWORT ist gesetzt, aber kürzer als 12 Zeichen. Steht ein <code>$</code> darin? Docker Compose liest es als Variable und lässt es samt
					Folgezeichen weg – <code>$</code> als <code>$$</code> schreiben oder ein Passwort ohne <code>$</code> wählen.
				{:else}
					SIGNATUR_PASSWORT fehlt (mindestens 12 Zeichen) – damit wird der Schlüssel verschlüsselt
				{/if}{/if}
		</p>
		{#if data.local.info}
			{@const c = data.local.info}
			<dl class="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
				<dt class="text-ink-3">Inhaber</dt>
				<dd>{c.name}{c.organization && c.organization !== c.name ? ` · ${c.organization}` : ''}</dd>
				<dt class="text-ink-3">Aussteller</dt>
				<dd>{c.selfSigned ? 'selbst ausgestellt' : c.issuerName}</dd>
				<dt class="text-ink-3">Gültig</dt>
				<dd>{dateLabel(c.notBefore)} – {dateLabel(c.notAfter)}</dd>
				<dt class="text-ink-3">Einstufung</dt>
				<dd>{c.label}</dd>
				<dt class="text-ink-3">SHA-256</dt>
				<dd class="num break-all text-xs">{c.fingerprint}</dd>
			</dl>
		{:else if data.local.problem}
			<p class="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{data.local.problem}</p>
		{:else}
			<p class="mt-3 rounded-xl bg-surface-2 p-3 text-sm text-ink-2">Noch kein Zertifikat hinterlegt.</p>
		{/if}

		{#if canEdit}
			<details class="mt-4 rounded-xl border border-line p-3">
				<summary class="cursor-pointer font-medium">Eigenes Zertifikat erzeugen</summary>
				<p class="mt-2 text-sm text-ink-2">
					Kostenlos und sofort: eine vollwertige PAdES-Signatur, Änderungen werden erkannt. Adobe zeigt dazu „Identität unbekannt", weil das Zertifikat von
					keiner anerkannten Stelle stammt – es ist <strong>nicht qualifiziert</strong>.
				</p>
				<form method="POST" action="?/generate" class="mt-3 grid gap-3 sm:grid-cols-2" use:enhance={done('generate', 'Zertifikat erzeugt')}>
					<label class="block">
						<span class="field-label">Firma</span>
						<input class="input" name="organization" required maxlength="64" value="Monsipan Bautenschutz GesmbH" />
					</label>
					<label class="block">
						<span class="field-label">Bezeichnung</span>
						<input class="input" name="commonName" required maxlength="64" value="Monsipan Rechnungssiegel" />
					</label>
					<label class="block">
						<span class="field-label">Gültig für</span>
						<span class="flex items-center gap-2"><input class="input num w-24" type="number" name="years" min="1" max="10" value="5" />Jahre</span>
					</label>
					<div class="flex items-end">
						<button class="btn btn-secondary" disabled={busy === 'generate' || !data.secrets.keyPassword}><KeyRound size={18} aria-hidden="true" />Erzeugen</button>
					</div>
				</form>
				{#if failed('generate')}<p class="mt-2 text-sm text-danger" role="alert">{failed('generate')}</p>{/if}
			</details>

			<details class="mt-3 rounded-xl border border-line p-3">
				<summary class="cursor-pointer font-medium">Gekauftes Zertifikat hochladen</summary>
				<p class="mt-2 text-sm text-ink-2">
					.p12/.pfx (RSA) oder PEM mit Schlüssel und Kette. Das Passwort gilt nur zum Öffnen; am Server wird der Schlüssel neu mit SIGNATUR_PASSWORT verschlüsselt.
					Ein qualifiziertes Siegel liegt nie als Datei vor – dafür den Anbieter über die CSC-API anbinden.
				</p>
				<form method="POST" action="?/upload" enctype="multipart/form-data" class="mt-3 space-y-3" use:enhance={done('upload', 'Zertifikat hinterlegt')}>
					<input
						type="file"
						name="datei"
						required
						accept=".p12,.pfx,.pem,application/x-pkcs12"
						class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:font-medium"
					/>
					<label class="block">
						<span class="field-label">Passwort der Datei</span>
						<PasswordInput id="cert-password" name="passwort" autocomplete="off" />
					</label>
					<button class="btn btn-secondary" disabled={busy === 'upload' || !data.secrets.keyPassword}><Upload size={18} aria-hidden="true" />Hochladen</button>
				</form>
				{#if failed('upload')}<p class="mt-2 text-sm text-danger" role="alert">{failed('upload')}</p>{/if}
			</details>
			<p class="field-hint mt-3">Abgelegt unter {data.keyFile}; ein ersetztes Zertifikat bleibt als .bak daneben. Alte Signaturen bleiben gültig – ihre Zertifikate stecken in den PDFs.</p>
		{/if}
	</section>

	<div class="space-y-4">
		<!-- Verbindung -->
		<section class="card p-4 lg:p-6" aria-labelledby="h-test">
			<h2 id="h-test" class="flex items-center gap-2 text-xl"><PlugZap size={20} aria-hidden="true" />Verbindung testen</h2>
			<p class="mt-1 text-sm text-ink-2">Prüft mit den gespeicherten Einstellungen Zertifikat, Signatur, Zeitstempel und Sperrinformationen – mit einem Testwert, keiner Rechnung.</p>
			{#if canEdit}
				<form method="POST" action="?/test" class="mt-3" use:enhance={done('test', '')}>
					<button class="btn btn-secondary" disabled={busy === 'test'}><PlugZap size={18} aria-hidden="true" />{busy === 'test' ? 'Wird getestet …' : 'Jetzt testen'}</button>
				</form>
			{/if}
			{#if steps}
				<ul class="mt-3 space-y-2">
					{#each steps as s, i (i)}
						<li class="flex items-start gap-2 text-sm">
							{#if s.ok}<CircleCheck size={18} class="mt-0.5 shrink-0 text-ok" aria-hidden="true" />{:else}<CircleX size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />{/if}
							<span><span class="font-medium">{s.label}</span><span class="block break-words text-ink-2">{s.detail}</span></span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Archiv -->
		<section class="card p-4 lg:p-6" aria-labelledby="h-archive">
			<h2 id="h-archive" class="flex items-center gap-2 text-xl"><Archive size={20} aria-hidden="true" />Archivprüfung</h2>
			<p class="mt-1 text-sm text-ink-2">Jede Nacht: alle ausgestellten Rechnungen (Datei, Prüfsumme, Daten, Signatur) und die Kette des Protokolls.</p>
			{#if check}
				<p class="mt-3 flex items-start gap-2 text-sm">
					{#if !check.problems.length && check.audit.ok}<CircleCheck size={18} class="mt-0.5 shrink-0 text-ok" aria-hidden="true" />{:else}<CircleX
							size={18}
							class="mt-0.5 shrink-0 text-danger"
							aria-hidden="true"
						/>{/if}
					<span>
						{dateTime(check.at)}: {check.invoices} Rechnung{check.invoices === 1 ? '' : 'en'} geprüft, {check.problems.length ? `${check.problems.length} mit Fehlern` : 'alle in Ordnung'};
						Protokoll {check.audit.ok ? `vollständig (${check.audit.entries} Einträge)` : `unterbrochen bei Eintrag ${check.audit.brokenAt}`}.
					</span>
				</p>
				{#if check.problems.length}
					<ul class="mt-2 space-y-1 text-sm">
						{#each check.problems as p (p.id)}
							<li><a class="font-medium text-danger underline" href="/rechnungen/{p.id}">{p.number}</a>: {p.detail}</li>
						{/each}
					</ul>
				{/if}
			{:else}
				<p class="mt-3 text-sm text-ink-3">Noch nicht geprüft.</p>
			{/if}
			{#if canEdit}
				<form method="POST" action="?/check" class="mt-3" use:enhance={done('check', 'Archiv geprüft')}>
					<button class="btn btn-secondary" disabled={busy === 'check'}><Archive size={18} aria-hidden="true" />Jetzt prüfen</button>
				</form>
			{/if}
		</section>

		<section class="card p-4 text-sm lg:p-6" aria-labelledby="h-info">
			<h2 id="h-info" class="flex items-center gap-2 text-xl"><Info size={20} aria-hidden="true" />Was kostet was?</h2>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-ink-2">
				<li>Kostenlos: Sperre nach dem Ausstellen, Archiv mit SHA-256, Protokoll, Prüfcode, PAdES mit eigenem Zertifikat, Zeitstempel von DigiCert/Sectigo.</li>
				<li>Vertrauenswürdig ohne Warnung in Adobe: Zertifikat eines Ausstellers aus der Adobe-Liste (AATL) bzw. der EU-Vertrauensliste – jährliche Kosten.</li>
				<li>Qualifiziertes elektronisches Siegel: nur über einen Vertrauensdiensteanbieter (z. B. A-Trust, CSC-API) – Vertrag, laufende Kosten je Siegel bzw. Paket.</li>
				<li>Für normale Rechnungen in Österreich ist keine qualifizierte Signatur vorgeschrieben – Echtheit der Herkunft, Unversehrtheit und Lesbarkeit müssen gesichert sein.</li>
			</ul>
		</section>
	</div>
</div>
