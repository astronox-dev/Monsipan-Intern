<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Copy from '@lucide/svelte/icons/copy';
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import Trash from '@lucide/svelte/icons/trash';
	import Crown from '@lucide/svelte/icons/crown';
	import UserStar from '@lucide/svelte/icons/user-star';
	import Dialog from '$lib/components/Dialog.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { date, dateTime, fullName, initials, relativeDateTime } from '$lib/format';
	import { can, mayHaveParty, needsParty, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from '$lib/permissions';
	import { canBecomeOwner, denyReason, OWNER_HINT, OWNER_LABEL, type UserAction } from '$lib/user-rules';
	import { toast } from '$lib/stores/toast.svelte';

	let { data } = $props();

	/** Ansehen darf, wer Benutzer sieht – Anlegen, Ändern und Löschen sind eigene Rechte */
	const canCreate = $derived(can(data.user.role, 'benutzer.erstellen'));
	const canEdit = $derived(can(data.user.role, 'benutzer.bearbeiten'));
	const canDelete = $derived(can(data.user.role, 'benutzer.loeschen'));
	type U = (typeof data.users)[number];

	let formOpen = $state(false);
	let editing = $state<U | null>(null);
	let role = $state<Role>('arbeiter');
	let partyId = $state<number | null>(null);
	let mode = $state<'mail' | 'password'>('password');
	let email = $state('');
	let formError = $state('');
	let busy = $state(false);

	const me = $derived({ id: data.user.id, role: data.user.role, owner: data.user.owner });
	/** Warum eine Aktion für dieses Konto gesperrt ist – leer heißt erlaubt */
	const why = $derived((u: U, action: UserAction) => denyReason(me, u, action) ?? '');
	const ownerUser = $derived(data.users.find((u) => u.owner));
	const transferable = $derived(data.users.filter((u) => canBecomeOwner(u)));

	/** Rolle gesperrt (z. B. Admin ohne Inhaber-Recht) */
	const roleLocked = $derived(editing ? why(editing, 'role') : '');

	let transferOpen = $state(false);
	let transferTo = $state<number | null>(null);
	let transferPassword = $state('');
	let transferError = $state('');

	let resetUser = $state<U | null>(null);
	let resetOpen = $state(false);
	let deleteUser = $state<U | null>(null);
	let deleteOpen = $state(false);
	const resetModes = $derived<('mail' | 'password')[]>(resetUser?.email && data.mailConfigured ? ['mail', 'password'] : ['password']);

	/** Einmal angezeigtes Passwort bzw. Bestätigung */
	let secret = $state<{ title: string; name: string; username?: string; password: string | null; mailed: boolean } | null>(null);
	let secretOpen = $state(false);

	function openCreate() {
		editing = null;
		role = 'arbeiter';
		partyId = null;
		email = '';
		mode = data.mailConfigured ? 'mail' : 'password';
		formError = '';
		formOpen = true;
	}
	function openEdit(u: U) {
		editing = u;
		role = u.role;
		partyId = u.partyId;
		email = u.email ?? '';
		formError = '';
		formOpen = true;
	}

	const roleTone: Record<Role, string> = {
		admin: 'badge-brand',
		geschaeftsfuehrer: 'badge-brand',
		bauleiter: 'badge-info',
		buchhaltung: 'badge-info',
		partiefuehrer: '',
		arbeiter: '',
		viewer: ''
	};

	/** Zuletzt geöffnet – Konten von vor dieser Anzeige haben nur die letzte Anmeldung */
	const lastSeen = (u: U) => u.lastSeenAt ?? u.lastLoginAt;
	/** So lange gilt jemand als „gerade aktiv" – geschrieben wird höchstens alle 5 Minuten */
	const ACTIVE_WINDOW = 10 * 60_000;
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});
	function seen(u: U): { text: string; online: boolean; exact: string } {
		const d = lastSeen(u);
		if (!d) return { text: 'noch nie', online: false, exact: 'Noch nie geöffnet' };
		const ago = now - new Date(d).getTime();
		const exact = `Zuletzt geöffnet: ${dateTime(d)}`;
		if (ago < ACTIVE_WINDOW) return { text: 'gerade aktiv', online: true, exact };
		if (ago < 60 * 60_000) return { text: `vor ${Math.round(ago / 60_000)} Min.`, online: false, exact };
		return { text: relativeDateTime(d), online: false, exact };
	}
	const startOfToday = $derived(new Date(new Date(now).setHours(0, 0, 0, 0)).getTime());
	const seenToday = (list: U[]) => list.filter((u) => (lastSeen(u) ? new Date(lastSeen(u)!).getTime() >= startOfToday : false)).length;

	/** Je Gruppe die aktiven Zugänge, in der Reihenfolge der Rollen; Deaktivierte extra */
	const groups = $derived(ROLES.map((r) => ({ role: r, users: data.users.filter((u) => u.active && u.role === r) })).filter((g) => g.users.length));
	const inactive = $derived(data.users.filter((u) => !u.active));

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success('In die Zwischenablage kopiert');
		} catch {
			toast.error('Kopieren nicht möglich');
		}
	}
</script>

<svelte:head><title>{pageTitle('Benutzer')}</title></svelte:head>

{#snippet row(u: U, showRole: boolean)}
	{@const s = seen(u)}
	<li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 lg:px-6" class:opacity-55={!u.active}>
		<span class="relative grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 font-display font-semibold">
			{initials(u)}
			{#if s.online}<span class="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-ok ring-2 ring-surface" title="Gerade aktiv"></span>{/if}
		</span>
		<div class="min-w-[11rem] flex-1">
			<p class="font-medium">
				{fullName(u)}
				<span class="font-normal text-ink-3">@{u.username}</span>
			</p>
			<p class="truncate text-sm text-ink-3">{[u.partyName, u.email ?? 'Keine E-Mail'].filter(Boolean).join(' · ')}</p>
			<!-- Am Handy steht „zuletzt geöffnet" unter dem Namen -->
			<p class="text-sm sm:hidden" title={s.exact}>
				<span class="text-ink-3">Zuletzt geöffnet:</span> <span class="whitespace-nowrap {s.online ? 'font-medium text-ok' : ''}">{s.text}</span>
			</p>
		</div>
		<p class="hidden w-36 shrink-0 text-right text-sm leading-tight sm:block" title={s.exact}>
			<span class="block text-[0.75rem] text-ink-3">Zuletzt geöffnet</span>
			<span class={s.online ? 'font-medium text-ok' : u.active && !lastSeen(u) ? 'text-ink-3' : ''}>{s.text}</span>
		</p>
		<div class="flex flex-wrap items-center gap-2">
			{#if !u.active}<span class="badge">Deaktiviert</span>{/if}
			{#if u.active && needsParty(u.role) && !u.partyId}<span class="badge badge-danger">Partie fehlt</span>{/if}
			{#if u.mustChangePassword && u.active}<span class="badge badge-warn">Passwort offen</span>{/if}
			{#if u.owner}<span class="badge badge-brand"><Crown size={13} aria-hidden="true" />{OWNER_LABEL}</span>{/if}
			{#if u.timesheetExempt}<span class="badge">Keine Stundenzettel</span>{/if}
			{#if u.leaveAccountExempt}<span class="badge">Kein Urlaubskonto</span>{/if}
			{#if u.leadUntil}<span class="badge badge-info" title="Vorübergehend – in der Wochenplanung gesetzt"><UserStar size={13} aria-hidden="true" />Partieführer bis {date(u.leadUntil)}</span>{/if}
			{#if showRole}<span class="badge {roleTone[u.role]}">{ROLE_LABELS[u.role]}</span>{/if}
			{#if canEdit}
			<button
				class="btn btn-ghost btn-sm btn-icon"
				aria-label="Passwort von {fullName(u)} zurücksetzen"
				title={why(u, 'password') || 'Passwort zurücksetzen'}
				disabled={Boolean(why(u, 'password'))}
				onclick={() => ((resetUser = u), (resetOpen = true))}
			>
				<KeyRound size={16} />
			</button>
			<button
				class="btn btn-ghost btn-sm btn-icon"
				aria-label="{fullName(u)} bearbeiten"
				title={why(u, 'edit') || 'Bearbeiten'}
				disabled={Boolean(why(u, 'edit'))}
				onclick={() => openEdit(u)}
			>
				<Pencil size={16} />
			</button>
			{/if}
			{#if canDelete && u.id !== data.user.id}
				<button
					class="btn btn-ghost btn-sm btn-icon hover:text-danger"
					aria-label="{fullName(u)} löschen"
					title={why(u, 'delete') || 'Löschen'}
					disabled={Boolean(why(u, 'delete'))}
					onclick={() => ((deleteUser = u), (deleteOpen = true))}
				>
					<Trash size={16} />
				</button>
			{:else}
				<span class="size-9" aria-hidden="true"></span>
			{/if}
		</div>
	</li>
{/snippet}

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="text-[2rem] leading-tight">Benutzer</h1>
		<p class="text-ink-2">
			{data.users.filter((u) => u.active).length} aktive Zugänge · heute {seenToday(data.users.filter((u) => u.active))} geöffnet
		</p>
	</div>
	{#if canCreate}<button class="btn btn-primary" onclick={openCreate}><UserPlus size={18} aria-hidden="true" />Benutzer anlegen</button>{/if}
</div>

<!-- Je Gruppe eine Karte, in der Reihenfolge der Rollen -->
{#each groups as g (g.role)}
	<section class="card mb-4 overflow-hidden" aria-labelledby="gruppe-{g.role}">
		<header class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line bg-surface-2 px-4 py-2.5 lg:px-6">
			<h2 id="gruppe-{g.role}" class="font-display text-lg font-semibold">{ROLE_LABELS[g.role]}</h2>
			<span class="num text-sm text-ink-3">{g.users.length} {g.users.length === 1 ? 'Zugang' : 'Zugänge'} · heute {seenToday(g.users)} geöffnet</span>
		</header>
		<ul class="divide-y divide-line">
			{#each g.users as u (u.id)}{@render row(u, false)}{/each}
		</ul>
	</section>
{/each}

{#if inactive.length}
	<section class="card mb-4 overflow-hidden" aria-labelledby="gruppe-deaktiviert">
		<header class="flex flex-wrap items-baseline gap-x-3 border-b border-line bg-surface-2 px-4 py-2.5 lg:px-6">
			<h2 id="gruppe-deaktiviert" class="font-display text-lg font-semibold text-ink-2">Deaktiviert</h2>
			<span class="num text-sm text-ink-3">{inactive.length}</span>
		</header>
		<ul class="divide-y divide-line">
			{#each inactive as u (u.id)}{@render row(u, true)}{/each}
		</ul>
	</section>
{/if}

<section class="card mt-4 p-4 lg:p-6" aria-labelledby="h-owner">
	<h2 id="h-owner" class="flex items-center gap-2 text-xl"><Crown size={20} aria-hidden="true" />{OWNER_LABEL}-Konto</h2>
	<p class="mt-1 max-w-3xl text-ink-2">
		{#if ownerUser}
			<span class="font-medium text-ink">{fullName(ownerUser)}</span> (@{ownerUser.username}) ist {OWNER_LABEL}. {OWNER_HINT}
			Das {OWNER_LABEL}-Konto selbst lässt sich nicht löschen, deaktivieren oder herabstufen.
		{:else}
			Kein Konto ist als {OWNER_LABEL} gekennzeichnet. {OWNER_HINT}
		{/if}
	</p>
	{#if data.user.owner && canEdit}
		<button class="btn btn-secondary mt-3" disabled={transferable.length === 0} onclick={() => ((transferTo = transferable[0]?.id ?? null), (transferPassword = ''), (transferError = ''), (transferOpen = true))}>
			<Crown size={18} aria-hidden="true" />Inhaberschaft übergeben
		</button>
		{#if transferable.length === 0}
			<p class="mt-2 text-sm text-ink-3">Dafür braucht es einen zweiten aktiven Admin.</p>
		{/if}
	{/if}
</section>

<Dialog bind:open={formOpen} title={editing ? 'Benutzer bearbeiten' : 'Benutzer anlegen'} wide>
	<form
		id="user-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		class="grid gap-4 sm:grid-cols-2"
		use:enhance={() => {
			busy = true;
			formError = '';
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'failure') {
					formError = String(result.data?.message ?? 'Speichern fehlgeschlagen');
					return;
				}
				if (result.type === 'success') {
					formOpen = false;
					const c = result.data?.created as { name: string; username: string; invited: boolean; password: string | null } | undefined;
					if (c) {
						secret = { title: 'Benutzer angelegt', name: c.name, username: c.username, password: c.password, mailed: c.invited };
						secretOpen = true;
					} else toast.success('Gespeichert');
				}
				await update({ reset: false });
			};
		}}
	>
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<div>
			<label for="u-first" class="field-label">Vorname *</label>
			<input id="u-first" name="firstName" class="input" required maxlength="60" value={editing?.firstName ?? ''} autocomplete="off" />
		</div>
		<div>
			<label for="u-last" class="field-label">Nachname</label>
			<input id="u-last" name="lastName" class="input" maxlength="60" value={editing?.lastName ?? ''} autocomplete="off" />
		</div>
		<div>
			<label for="u-name" class="field-label">Benutzername *</label>
			<input id="u-name" name="username" class="input" required maxlength="40" autocapitalize="none" spellcheck="false" value={editing?.username ?? ''} autocomplete="off" />
		</div>
		<div>
			<label for="u-mail" class="field-label">E-Mail</label>
			<input id="u-mail" name="email" type="email" class="input" maxlength="120" bind:value={email} autocomplete="off" />
			<p class="field-hint">Für „Passwort vergessen“ und Info-Mails.</p>
		</div>

		<!-- Gesperrte Felder schickt der Browser nicht mit – ihr Wert kommt deshalb versteckt mit -->
		{#if roleLocked}<input type="hidden" name="role" value={role} />{/if}
		<fieldset class="sm:col-span-2" disabled={Boolean(roleLocked)}>
			<legend class="field-label">Rolle</legend>
			{#if roleLocked}<p class="field-hint mb-2">{roleLocked}</p>{/if}
			<div class="grid gap-2 sm:grid-cols-2 {roleLocked ? 'opacity-60' : ''}">
				{#each ROLES as r (r)}
					<label class="flex cursor-pointer items-start gap-3 rounded-xl border border-line-strong p-3 transition-colors has-[:checked]:border-ink has-[:checked]:bg-surface-3">
						<input type="radio" name="role" value={r} bind:group={role} class="mt-1 accent-[var(--c-ink)]" />
						<span>
							<span class="block font-medium">{ROLE_LABELS[r]}</span>
							<span class="block text-sm text-ink-3">{ROLE_DESCRIPTIONS[r]}</span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<!-- Partieführer und Arbeiter brauchen eine Partie, Leitung und Büro können eine haben -->
		{#if mayHaveParty(role)}
			{@const required = needsParty(role)}
			<div class="sm:col-span-2">
				<label for="u-party" class="field-label">Partie{required ? ' *' : ' (optional)'}</label>
				<select id="u-party" name="partyId" class="select" {required} bind:value={partyId}>
					<option value={null}>{required ? 'Partie wählen' : 'Keine Partie'}</option>
					{#each data.parties as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
				<p class="field-hint">
					{#if !data.parties.length}
						Noch keine Partien angelegt – das geht unter Stammdaten.
					{:else if required}
						Wird beim Ausbuchen und bei Rückgaben automatisch eingesetzt und lässt sich dort ändern.
					{:else}
						Nur, wenn die Person selbst in einer Partie mitarbeitet – dann steht sie dort auch bei den Stundenzetteln.
					{/if}
				</p>
			</div>
		{/if}

		<label class="flex items-center gap-3 rounded-xl bg-surface-2 p-3 sm:col-span-2">
			<input type="checkbox" name="timesheetExempt" class="size-5 accent-[var(--c-ink)]" checked={editing?.timesheetExempt ?? false} />
			<span>
				<span class="font-medium">Keine Stundenzettel</span>
				<span class="block text-sm text-ink-3">Fehlt in der Stundenzettel-Liste – etwa für Admin- oder Büro-Konten.</span>
			</span>
		</label>

		<label class="flex items-center gap-3 rounded-xl bg-surface-2 p-3 sm:col-span-2">
			<input type="checkbox" name="leaveAccountExempt" class="size-5 accent-[var(--c-ink)]" checked={editing?.leaveAccountExempt ?? false} />
			<span>
				<span class="font-medium">Kein Urlaubskonto</span>
				<span class="block text-sm text-ink-3">Fehlt in den Urlaubskonten, kein Resturlaub – Urlaub beantragen geht trotzdem. Etwa für Admin- oder Büro-Konten.</span>
			</span>
		</label>

		{#if editing}
			{@const activeLocked = why(editing, 'deactivate')}
			{#if activeLocked && editing.active}<input type="hidden" name="active" value="on" />{/if}
			<label class="flex items-center gap-3 rounded-xl bg-surface-2 p-3 sm:col-span-2 {activeLocked ? 'opacity-60' : ''}">
				<input type="checkbox" name="active" class="size-5 accent-[var(--c-ink)]" checked={editing.active} disabled={Boolean(activeLocked)} />
				<span>
					<span class="font-medium">Zugang aktiv</span>
					<span class="block text-sm text-ink-3">{activeLocked || 'Deaktivierte Benutzer werden sofort abgemeldet.'}</span>
				</span>
			</label>
		{:else}
			<fieldset class="sm:col-span-2">
				<legend class="field-label">Erstes Passwort</legend>
				<div class="grid gap-2 sm:grid-cols-2">
					<label class="flex items-start gap-3 rounded-xl border border-line-strong p-3 has-[:checked]:border-ink has-[:checked]:bg-surface-3 {!data.mailConfigured || !email ? 'opacity-50' : ''}">
						<input type="radio" name="mode" value="mail" bind:group={mode} disabled={!data.mailConfigured || !email} class="mt-1 accent-[var(--c-ink)]" />
						<span><span class="block font-medium">Einladung per E-Mail</span><span class="block text-sm text-ink-3">{data.mailConfigured ? 'Person legt ihr Passwort selbst fest' : 'E-Mail-Versand ist nicht eingerichtet'}</span></span>
					</label>
					<label class="flex items-start gap-3 rounded-xl border border-line-strong p-3 has-[:checked]:border-ink has-[:checked]:bg-surface-3">
						<input type="radio" name="mode" value="password" bind:group={mode} class="mt-1 accent-[var(--c-ink)]" />
						<span><span class="block font-medium">Vorläufiges Passwort</span><span class="block text-sm text-ink-3">Wird einmal angezeigt, beim ersten Login geändert</span></span>
					</label>
				</div>
			</fieldset>
		{/if}
		{#if formError}<p class="field-error sm:col-span-2" role="alert">{formError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (formOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary" form="user-form" disabled={busy}>{editing ? 'Speichern' : 'Anlegen'}</button>
	{/snippet}
</Dialog>

<Dialog bind:open={resetOpen} title="Passwort zurücksetzen">
	{#if resetUser}
		<p class="text-ink-2">Für <span class="font-medium text-ink">{fullName(resetUser)}</span>. Bestehende Anmeldungen werden beim vorläufigen Passwort beendet.</p>
	{/if}
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (resetOpen = false)}>Abbrechen</button>
		{#each resetModes as m (m)}
			<form
				method="POST"
				action="?/reset"
				use:enhance={() =>
					async ({ result }) => {
						resetOpen = false;
						if (result.type === 'failure') {
							toast.error(String(result.data?.message ?? 'Zurücksetzen fehlgeschlagen'));
							return;
						}
						if (result.type === 'success') {
							const r = result.data?.reset as { name: string; mailed: boolean; password: string | null };
							secret = { title: 'Passwort zurückgesetzt', name: r.name, password: r.password, mailed: r.mailed };
							secretOpen = true;
						}
					}}
			>
				<input type="hidden" name="id" value={resetUser?.id} />
				<input type="hidden" name="mode" value={m} />
				<button class="btn {m === 'mail' ? 'btn-secondary' : 'btn-primary'}">{m === 'mail' ? 'Link per E-Mail' : 'Vorläufiges Passwort'}</button>
			</form>
		{/each}
	{/snippet}
</Dialog>

<Dialog bind:open={deleteOpen} title="Benutzer löschen?">
	{#if deleteUser}
		<p class="text-ink-2">
			<span class="font-medium text-ink">{fullName(deleteUser)}</span> (@{deleteUser.username}) kann sich danach nicht mehr anmelden und
			verschwindet aus dieser Liste. Bisherige Buchungen bleiben mit dem Namen erhalten.
		</p>
		<p class="mt-2 text-sm text-ink-3">Benutzername und E-Mail-Adresse werden wieder frei. Das lässt sich nicht rückgängig machen.</p>
	{/if}
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (deleteOpen = false)}>Abbrechen</button>
		<form
			method="POST"
			action="?/delete"
			use:enhance={() =>
				async ({ result, update }) => {
					deleteOpen = false;
					if (result.type === 'failure') {
						toast.error(String(result.data?.message ?? 'Löschen fehlgeschlagen'));
						return;
					}
					if (result.type === 'success') toast.success('Benutzer gelöscht', String(result.data?.deleted ?? ''));
					await update();
				}}
		>
			<input type="hidden" name="id" value={deleteUser?.id} />
			<button class="btn btn-danger">Endgültig löschen</button>
		</form>
	{/snippet}
</Dialog>

<Dialog bind:open={secretOpen} title={secret?.title ?? ''}>
	{#if secret}
		{#if secret.mailed}
			<div class="flex gap-3 rounded-xl bg-ok-soft p-4 text-ok">
				<MailCheck size={22} class="shrink-0" aria-hidden="true" />
				<p class="font-medium">{secret.name} hat eine E-Mail mit einem Link zum Festlegen des Passworts bekommen.</p>
			</div>
		{:else if secret.password}
			<p class="text-ink-2">Gib {secret.name} dieses vorläufige Passwort weiter. Es wird nur jetzt angezeigt und muss beim ersten Login geändert werden.</p>
			{#if secret.username}<p class="mt-3 text-sm text-ink-3">Benutzername: <span class="font-medium text-ink">{secret.username}</span></p>{/if}
			<div class="mt-2 flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-3">
				<code class="num flex-1 font-display text-2xl font-semibold tracking-wider">{secret.password}</code>
				<button class="btn btn-secondary btn-sm" onclick={() => copy(secret!.password!)}><Copy size={16} aria-hidden="true" />Kopieren</button>
			</div>
		{:else}
			<p class="text-ink-2">Die Einladung konnte nicht gesendet werden. Setze das Passwort über das Schlüssel-Symbol zurück.</p>
		{/if}
	{/if}
	{#snippet footer()}
		<button class="btn btn-primary" onclick={() => (secretOpen = false)}>Fertig</button>
	{/snippet}
</Dialog>

<Dialog bind:open={transferOpen} title="Inhaberschaft übergeben">
	<form
		id="owner-form"
		method="POST"
		action="?/transferOwner"
		use:enhance={() => {
			busy = true;
			transferError = '';
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'failure') {
					transferError = String(result.data?.message ?? 'Übergabe fehlgeschlagen');
					return;
				}
				if (result.type === 'success') {
					transferOpen = false;
					toast.success('Inhaberschaft übergeben', String(result.data?.ownerTransferred ?? ''));
				}
				await update({ reset: false });
			};
		}}
	>
		<p class="text-ink-2">
			Der neue {OWNER_LABEL} darf danach als Einziger Admins löschen, deaktivieren und herabstufen. Dein Konto bleibt Admin, verliert aber
			diese Rechte.
		</p>
		<div class="mt-4">
			<label for="owner-to" class="field-label">Neuer {OWNER_LABEL}</label>
			<select id="owner-to" name="id" class="select" required bind:value={transferTo}>
				{#each transferable as u (u.id)}<option value={u.id}>{fullName(u)} (@{u.username})</option>{/each}
			</select>
		</div>
		<div class="mt-4">
			<label for="owner-pw" class="field-label">Dein Passwort zur Bestätigung</label>
			<PasswordInput id="owner-pw" name="password" autocomplete="current-password" bind:value={transferPassword} />
		</div>
		{#if transferError}<p class="field-error mt-3" role="alert">{transferError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (transferOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary" form="owner-form" disabled={!transferTo || !transferPassword || busy}>Übergeben</button>
	{/snippet}
</Dialog>
