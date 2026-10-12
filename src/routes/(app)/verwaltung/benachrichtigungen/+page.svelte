<script lang="ts">
	/**
	 * Wer welche Benachrichtigung bekommt – unter der Glocke samt Push und als
	 * Info-Mail, je Weg eigens: je Ereignis die Gruppen anhaken und bei Bedarf
	 * einzelne Personen dazunehmen. Ankommen kann nur, was die Person auch sehen
	 * darf; bei Ereignissen einer Partie nur die eigene Partie.
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import Mail from '@lucide/svelte/icons/mail';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Users from '@lucide/svelte/icons/users';
	import Dialog from '$lib/components/Dialog.svelte';
	import PushToggle from '$lib/components/PushToggle.svelte';
	import { fullName } from '$lib/format';
	import { can, ROLE_LABELS, ROLES, type Role } from '$lib/permissions';
	import {
		CHANNEL_LABELS,
		eventSections,
		NOTIFICATION_CHANNELS,
		NOTIFICATION_EVENTS,
		type NotificationChannel,
		type NotificationEvent,
		type NotificationEventDef
	} from '$lib/notifications';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();
	let uploading = $state(false);

	type Selection = { roles: Set<string>; people: Set<string> };
	const toSets = (settings: { roles: Record<string, string[]>; people: Record<string, number[]> }): Selection => {
		const roles = new Set<string>();
		const people = new Set<string>();
		for (const [event, list] of Object.entries(settings.roles)) for (const r of list) roles.add(`${event}|${r}`);
		for (const [event, list] of Object.entries(settings.people)) for (const id of list) people.add(`${event}|${id}`);
		return { roles, people };
	};
	const fromSettings = (): Record<NotificationChannel, Selection> => ({ push: toSets(data.settings), mail: toSets(data.mailSettings) });
	// Arbeitsstand im Browser – gespeichert wird erst mit dem Knopf, beide Wege zusammen
	let all = $derived(fromSettings());
	const saved = $derived(fromSettings());
	let channel = $state<NotificationChannel>('push');
	const current = $derived(all[channel]);
	const setCurrent = (next: Selection) => (all = { ...all, [channel]: next });

	let busy = $state(false);
	let resetOpen = $state(false);

	const sections = eventSections();
	const def = (e: NotificationEvent): NotificationEventDef => NOTIFICATION_EVENTS[e];
	const personName = (id: number) => {
		const p = data.people.find((x) => x.id === id);
		return p ? fullName(p) : `#${id}`;
	};

	function toggleRole(event: NotificationEvent, role: Role) {
		const next = new Set(current.roles);
		const key = `${event}|${role}`;
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setCurrent({ ...current, roles: next });
	}
	function addPerson(event: NotificationEvent, id: string) {
		if (!id) return;
		setCurrent({ ...current, people: new Set([...current.people, `${event}|${id}`]) });
	}
	function removePerson(event: NotificationEvent, id: number) {
		const next = new Set(current.people);
		next.delete(`${event}|${id}`);
		setCurrent({ ...current, people: next });
	}
	const noEmail = (id: number) => channel === 'mail' && data.people.find((p) => p.id === id)?.hasEmail === false;
	const peopleOf = (event: NotificationEvent) =>
		[...current.people].filter((k) => k.startsWith(`${event}|`)).map((k) => Number(k.split('|')[1]));

	const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));
	const changedIn = (c: NotificationChannel) => !same(all[c].roles, saved[c].roles) || !same(all[c].people, saved[c].people);
	const changed = $derived(NOTIFICATION_CHANNELS.some(changedIn));
</script>

<svelte:head><title>{pageTitle('Benachrichtigungen')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><BellRing size={26} aria-hidden="true" />Benachrichtigungen</h1>
		<p class="text-ink-2">Wer bei welchem Schritt Bescheid bekommt – unter der Glocke und als Push aufs Handy bzw. den PC, und als Info-Mail.</p>
	</div>
	{#if data.canEdit}
		<button type="button" class="btn btn-ghost" onclick={() => (resetOpen = true)}><RotateCcw size={18} aria-hidden="true" />Auf Standard zurücksetzen</button>
	{/if}
</div>

<section class="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:p-5">
	<div class="text-sm">
		<p class="font-medium">Push im Browser und als Web-App</p>
		<p class="text-ink-2">Bereit · {data.push.webDevices} {data.push.webDevices === 1 ? 'Gerät' : 'Geräte'} angemeldet</p>
	</div>
	<div class="text-sm">
		<p class="font-medium">Push in der Android-App</p>
		{#if data.push.firebase}
			<p class="text-ink-2">
				Bereit · {data.push.appDevices} {data.push.appDevices === 1 ? 'Gerät' : 'Geräte'} angemeldet · Firebase-Projekt
				<span class="num font-medium text-ink">{data.push.firebase.projectId}</span>{data.push.firebase.source === 'env' ? ' (aus dem Server-Stack)' : ''}
			</p>
			{#if data.canEdit && data.push.firebase.source === 'upload'}
				<form method="POST" action="?/firebaseRemove" class="mt-1" use:enhance={() => async ({ update }) => (toast.success('Schlüssel entfernt'), await update())}>
					<button class="text-[0.8125rem] font-medium text-ink-3 underline-offset-2 hover:text-danger hover:underline">Schlüssel entfernen</button>
				</form>
			{/if}
		{:else}
			<p class="text-warn">Noch nicht eingerichtet – bis dahin kommt in der App alles unter der Glocke an.</p>
		{/if}
	</div>
	{#if data.canEdit && !data.push.firebase}
		<details class="rounded-xl bg-surface-2 p-3 text-sm sm:col-span-2">
			<summary class="cursor-pointer font-medium">Push in der Android-App einrichten</summary>
			<ol class="mt-2 list-decimal space-y-1.5 pl-5 text-ink-2">
				<li>
					In der <a href="https://console.firebase.google.com" target="_blank" rel="noopener" class="font-medium text-ink underline">Firebase-Konsole</a>
					ein Projekt anlegen (Google Analytics braucht es nicht).
				</li>
				<li>
					<b>Android-App hinzufügen</b> mit dem Paketnamen <code class="num rounded bg-surface-3 px-1">at.monsipan.intern</code> und die Datei
					<b>google-services.json</b> herunterladen. Ihr Inhalt kommt auf GitHub als Secret <code class="num rounded bg-surface-3 px-1">GOOGLE_SERVICES_JSON</code>;
					danach unter Actions den Workflow „Android-App (APK)“ starten und die neue App installieren.
				</li>
				<li>
					In Firebase unter Projekteinstellungen → <b>Dienstkonten</b> → „Neuen privaten Schlüssel generieren“ – die heruntergeladene JSON-Datei hier
					hochladen:
				</li>
			</ol>
			<form
				method="POST"
				action="?/firebase"
				enctype="multipart/form-data"
				class="mt-3 flex flex-wrap items-center gap-2"
				use:enhance={() => {
					uploading = true;
					return async ({ result, update }) => {
						uploading = false;
						if (result.type === 'success') toast.success('Firebase eingerichtet', 'Push in der App ist jetzt bereit.');
						await update();
					};
				}}
			>
				<input
					type="file"
					name="schluessel"
					accept="application/json,.json"
					required
					class="block w-full max-w-xs text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:font-medium"
				/>
				<button class="btn btn-secondary btn-sm" disabled={uploading}>{uploading ? 'Wird geprüft …' : 'Schlüssel hochladen'}</button>
			</form>
			{#if form && 'firebaseMessage' in form && form.firebaseMessage}<p class="field-error mt-2" role="alert">{form.firebaseMessage}</p>{/if}
			<p class="mt-2 text-[0.8125rem] text-ink-3">Der Schlüssel bleibt am Server und wird nie wieder angezeigt.</p>
		</details>
	{/if}
	<div class="sm:col-span-2"><PushToggle /></div>
</section>

<form
	method="POST"
	action="?/save"
	use:enhance={() => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') toast.success('Benachrichtigungen gespeichert');
			await update({ reset: false });
			await invalidateAll();
		};
	}}
>
	{#each [...all.push.roles] as k (k)}<input type="hidden" name="rolle" value={k} />{/each}
	{#each [...all.push.people] as k (k)}<input type="hidden" name="person" value={k} />{/each}
	{#each [...all.mail.roles] as k (k)}<input type="hidden" name="mail-rolle" value={k} />{/each}
	{#each [...all.mail.people] as k (k)}<input type="hidden" name="mail-person" value={k} />{/each}

	<div class="mb-3 flex flex-wrap items-center gap-3">
		<div class="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Weg">
			{#each NOTIFICATION_CHANNELS as c (c)}
				<button
					type="button"
					role="tab"
					aria-selected={channel === c}
					class="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors {channel === c
						? 'bg-ink text-surface'
						: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
					onclick={() => (channel = c)}
				>
					{#if c === 'mail'}<Mail size={16} aria-hidden="true" />{:else}<BellRing size={16} aria-hidden="true" />{/if}{CHANNEL_LABELS[c]}{#if changedIn(c)}<span
							class="size-2 rounded-full bg-warn"
							aria-label="ungespeichert"
						></span>{/if}
				</button>
			{/each}
		</div>
		{#if channel === 'mail'}
			{#if data.mail.configured}
				<p class="text-sm text-ink-2">Je Person eine eigene Mail von {data.mail.from || data.mail.host} – mit Link ins Portal.</p>
			{:else}
				<p class="flex items-center gap-1.5 text-sm text-warn">
					<CircleAlert size={16} aria-hidden="true" />Der E-Mail-Versand ist noch nicht eingerichtet (Einstellungen → E-Mail-Versand) – bis dahin geht keine Info-Mail raus.
				</p>
			{/if}
		{/if}
	</div>

	<section class="card overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full min-w-[56rem] border-collapse text-sm">
				<thead>
					<tr class="border-b border-line bg-surface-2">
						<th scope="col" class="sticky left-0 z-10 w-[19rem] bg-surface-2 px-4 py-2.5 text-left font-semibold">Ereignis und Personen</th>
						{#each ROLES as r (r)}
							<th scope="col" class="px-2 py-2.5 text-center align-bottom text-[0.8125rem] font-semibold">
								{ROLE_LABELS[r]}
								{#if channel === 'mail'}
									<span class="block text-[0.6875rem] font-normal {data.mail.emailsPerRole[r] ? 'text-ink-3' : 'text-warn'}">{data.mail.emailsPerRole[r]} mit E-Mail</span>
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each sections as [section, events] (section)}
						<tr class="border-b border-line">
							<th colspan={ROLES.length + 1} scope="colgroup" class="px-4 pt-4 pb-1.5 text-left font-display text-[0.9375rem] font-semibold">
								<span class="sticky left-4">{section}</span>
							</th>
						</tr>
						{#each events as e (e)}
							{@const d = def(e)}
							<tr class="border-b border-line align-top last:border-0">
								<th scope="row" class="sticky left-0 z-10 bg-surface px-4 py-2.5 text-left font-normal">
									<span class="block font-medium">{d.label}</span>
									{#if d.hint || d.all}
										<span class="block text-[0.75rem] text-ink-3">{[d.hint, d.all ? 'Ohne „alle sehen“ nur die eigene Partie' : ''].filter(Boolean).join(' · ')}</span>
									{/if}
									{#if channel === 'mail' && d.mailAlways}
										<span class="block text-[0.75rem] text-ink-3">{d.mailAlways}</span>
									{/if}
									<!-- Einzelne Personen gleich hier – die Spalte bleibt beim seitlichen Scrollen stehen -->
									<div class="mt-1.5 flex flex-wrap items-center gap-1">
										{#each peopleOf(e) as id (id)}
											<span class="badge h-auto gap-1 py-0.5 pr-1 {noEmail(id) ? 'badge-warn' : ''}" title={noEmail(id) ? 'Keine E-Mail-Adresse hinterlegt' : undefined}>
												{personName(id)}{noEmail(id) ? ' (ohne E-Mail)' : ''}
												{#if data.canEdit}
													<button type="button" class="grid size-4 place-items-center rounded-full hover:bg-surface-3" aria-label="{personName(id)} entfernen" onclick={() => removePerson(e, id)}>
														<X size={12} />
													</button>
												{/if}
											</span>
										{/each}
										{#if data.canEdit}
											<select
												class="select h-8 min-h-0 w-auto max-w-[9rem] py-0 text-[0.8125rem]"
												aria-label="{d.label}: Person dazunehmen"
												value=""
												onchange={(ev) => {
													addPerson(e, ev.currentTarget.value);
													ev.currentTarget.value = '';
												}}
											>
												<option value="">+ Person</option>
												{#each data.people.filter((p) => !peopleOf(e).includes(p.id)) as p (p.id)}
													<option value={String(p.id)}>{fullName(p)} ({ROLE_LABELS[p.role]}){channel === 'mail' && !p.hasEmail ? ' – ohne E-Mail' : ''}</option>
												{/each}
											</select>
										{/if}
									</div>
								</th>
								{#each ROLES as r (r)}
									{@const allowed = can(r, d.requires)}
									<td class="px-2 py-2.5 text-center">
										<input
											type="checkbox"
											class="size-5 accent-[var(--c-ink)] disabled:opacity-30"
											checked={allowed && current.roles.has(`${e}|${r}`)}
											disabled={!data.canEdit || !allowed}
											title={allowed ? '' : `${ROLE_LABELS[r]} darf das nicht sehen – siehe Berechtigungen`}
											aria-label="{d.label}: {ROLE_LABELS[r]}"
											onchange={() => toggleRole(e, r)}
										/>
									</td>
								{/each}
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	{#if data.canEdit && (changed || busy)}
		<div class="sticky bottom-24 mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-[var(--shadow-1)] backdrop-blur lg:bottom-6">
			<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Änderungen speichern'}</button>
			<button type="button" class="btn btn-ghost" disabled={busy} onclick={() => (all = fromSettings())}>Verwerfen</button>
			<p class="text-sm text-ink-2">Ungespeichert</p>
		</div>
	{/if}

	<p class="field-hint mt-3 flex gap-2">
		<Users size={16} class="mt-0.5 shrink-0" aria-hidden="true" />
		<span>
			Ankommen kann nur, was die Person auch öffnen darf – ausgegraute Gruppen dürfen das unter Berechtigungen nicht sehen. Bei Ereignissen einer Partie
			bekommen Partieführer und Arbeiter es nur für ihre eigene Partie. Wer einen Schritt selbst macht, bekommt dazu keine Benachrichtigung. Info-Mails
			gehen nur an Personen mit E-Mail-Adresse. Jede Person kann einzelne unter „Mein Konto“ für sich abschalten – Glocke/Push und Info-Mail getrennt.
		</span>
	</p>
</form>

<Dialog bind:open={resetOpen} title="Auf Standard zurücksetzen?">
	<p class="text-ink-2">
		Alle Ereignisse bekommen wieder die ausgelieferten Gruppen – bei Glocke/Push und bei den Info-Mails; einzeln eingetragene Personen werden entfernt.
	</p>
	<form
		method="POST"
		action="?/reset"
		class="mt-5 flex justify-end gap-2"
		use:enhance={() => async ({ update }) => {
			resetOpen = false;
			toast.success('Zurückgesetzt');
			await update();
			await invalidateAll();
		}}
	>
		<button type="button" class="btn btn-ghost" onclick={() => (resetOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary">Zurücksetzen</button>
	</form>
</Dialog>
