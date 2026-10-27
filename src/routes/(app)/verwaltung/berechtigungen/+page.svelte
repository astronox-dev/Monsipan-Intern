<script lang="ts">
	/**
	 * Rechte je Gruppe: oben die Gruppe wählen, darunter je Bereich eine Karte mit
	 * Sehen, Erstellen, Bearbeiten, Status und Löschen. Ohne „Sehen" bleibt die
	 * Karte zu – alles andere setzt Sehen ohnehin voraus. Der Vergleich zeigt alle
	 * Gruppen nebeneinander; ein Klick springt zur Karte der Gruppe.
	 */
	import { tick } from 'svelte';
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Lock from '@lucide/svelte/icons/lock';
	import Check from '@lucide/svelte/icons/check';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Table2 from '@lucide/svelte/icons/table-2';
	import Dialog from '$lib/components/Dialog.svelte';
	import {
		areaActions,
		can,
		isLocked,
		PERMISSION_AREAS,
		ROLE_DESCRIPTIONS,
		ROLE_LABELS,
		ROLES,
		withImplied,
		type Permission,
		type PermissionArea,
		type PermissionLevel,
		type Role
	} from '$lib/permissions';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();

	const canEdit = $derived(can(data.user.role, 'berechtigungen.bearbeiten'));

	const fromMatrix = (matrix: Record<string, string[]>) => {
		const set = new Set<string>();
		for (const [permission, roles] of Object.entries(matrix)) for (const r of roles) set.add(`${r}|${permission}`);
		return set;
	};
	const saved = $derived(fromMatrix(data.matrix));
	// Arbeitsstand im Browser – beginnt beim gespeicherten Stand und wird beim Ändern
	// überschrieben; gespeichert wird erst mit dem Knopf
	let allowed = $derived(fromMatrix(data.matrix));
	let role = $state<Role>('bauleiter');
	let view = $state<'gruppe' | 'vergleich'>('gruppe');
	let busy = $state(false);
	let confirmReset = $state(false);
	/** Kurz hervorgehobene Karte nach dem Sprung aus dem Vergleich */
	let flash = $state('');

	const key = (p: Permission, r: Role = role) => `${r}|${p}`;
	const has = (p: Permission | undefined, r: Role = role) => !!p && allowed.has(key(p, r));
	const locked = (p: Permission | undefined) => !!p && isLocked(role, p);

	/** Rechte setzen und ergänzen, was dazugehört; gesperrte bleiben an */
	function change(on: Permission[], off: Permission[] = []) {
		const next = new Set(allowed);
		for (const p of off) if (!isLocked(role, p)) next.delete(key(p));
		for (const p of on) next.add(key(p));
		allowed = withImplied(next);
	}

	type Level = 'none' | 'self' | 'own' | 'all';
	const levelOf = (l: PermissionLevel, r: Role = role): Level =>
		has(l.all, r) ? 'all' : has(l.own, r) ? 'own' : has(l.self, r) ? 'self' : 'none';
	const keysOf = (l: PermissionLevel) => [l.self, l.own, l.all].filter((p): p is Permission => !!p);
	const stepped = (l: PermissionLevel) => !!(l.own || l.self);

	/** Auswahl für eine Stufe: Nein/Ja oder Nein, (Nur eigene,) Eigene Partie, Alle */
	function choices(l: PermissionLevel): { value: Level; label: string }[] {
		if (!stepped(l)) return [{ value: 'none', label: 'Nein' }, { value: 'all', label: 'Ja' }];
		return [
			{ value: 'none', label: 'Nein' },
			...(l.self ? [{ value: 'self' as const, label: l.selfLabel ?? 'Nur eigene' }] : []),
			...(l.own ? [{ value: 'own' as const, label: l.ownLabel ?? 'Eigene' }] : []),
			{ value: 'all', label: 'Alle' }
		];
	}

	function setLevel(area: PermissionArea, which: 'view' | 'edit' | 'remove', value: Level) {
		const l = area[which]!;
		if (which === 'view' && value === 'none') {
			// Wer nichts sieht, darf im Bereich auch sonst nichts
			change([], [...keysOf(l), ...areaActions(area)]);
			return;
		}
		if (which === 'view' && value === 'self' && l.self) {
			// Nur den eigenen Zettel ansehen – alles andere im Bereich setzt mehr voraus
			change([l.self], [l.own, l.all, ...areaActions(area)].filter((p): p is Permission => !!p));
			return;
		}
		if (value === 'none') change([], keysOf(l));
		else if (value === 'own' && l.own) change([l.own], [l.all]);
		else change([l.all]);
	}

	function toggle(p: Permission) {
		if (has(p)) change([], [p]);
		else change([p]);
	}

	const sections = $derived.by(() => {
		const out = new Map<string, PermissionArea[]>();
		for (const a of PERMISSION_AREAS) out.set(a.section, [...(out.get(a.section) ?? []), a]);
		return [...out.entries()];
	});

	const areaKeys = (a: PermissionArea) => [...keysOf(a.view), ...areaActions(a)];
	const differs = (a: PermissionArea, r: Role) => areaKeys(a).some((p) => allowed.has(key(p, r)) !== saved.has(key(p, r)));

	const changed = $derived.by(() => {
		if (saved.size !== allowed.size) return true;
		for (const k of allowed) if (!saved.has(k)) return true;
		return false;
	});
	/** Gruppen mit ungespeicherten Änderungen – als Punkt an der Auswahl */
	const changedRoles = $derived(ROLES.filter((r) => PERMISSION_AREAS.some((a) => differs(a, r))));
	/** Wie viele Bereiche die Gruppe sieht – als kleine Zahl an der Auswahl */
	const areasFor = (r: Role) => PERMISSION_AREAS.filter((a) => levelOf(a.view, r) !== 'none').length;

	/** Aus dem Vergleich zur Karte einer Gruppe springen */
	async function openArea(r: Role, area: PermissionArea) {
		role = r;
		view = 'gruppe';
		await tick();
		document.getElementById(`bereich-${area.key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		flash = area.key;
		setTimeout(() => {
			if (flash === area.key) flash = '';
		}, 1600);
	}

	// Vergleich: Stufe als Wort, die übrigen Rechte als kleine Felder
	function levelText(l: PermissionLevel, r: Role) {
		const v = levelOf(l, r);
		if (v === 'none') return '–';
		if (v === 'self') return l.selfLabel ?? 'Nur eigene';
		if (v === 'own') return l.ownLabel ?? 'Eigene';
		return stepped(l) ? 'Alle' : 'Ja';
	}

	interface Mark {
		letter: string;
		title: string;
		state: 'full' | 'part' | 'off';
	}
	function marks(area: PermissionArea, r: Role): Mark[] {
		const out: Mark[] = [];
		const level = (letter: string, name: string, l: PermissionLevel | undefined) => {
			if (!l) return;
			const v = levelOf(l, r);
			out.push({
				letter,
				title: `${name}: ${v === 'none' ? 'nein' : levelText(l, r)}`,
				state: v === 'all' ? 'full' : v === 'none' ? 'off' : 'part'
			});
		};
		if (area.create) {
			const on = has(area.create.key, r);
			out.push({ letter: 'E', title: `${area.create.label ?? 'Erstellen'}: ${on ? 'ja' : 'nein'}`, state: on ? 'full' : 'off' });
		}
		level('B', area.edit?.label ?? 'Bearbeiten', area.edit);
		if (area.status?.length) {
			const names = area.status.filter((s) => has(s.key, r)).map((s) => s.label);
			out.push({
				letter: 'S',
				title: `Status: ${names.length} von ${area.status.length}${names.length ? ` – ${names.join(', ')}` : ''}`,
				state: names.length === area.status.length ? 'full' : names.length ? 'part' : 'off'
			});
		}
		level('L', 'Löschen', area.remove);
		return out;
	}
</script>

<!-- Stufen als Umschalter: Nein/Ja oder Nein, (Nur eigene,) Eigene Partie, Alle -->
{#snippet choice(area: PermissionArea, which: 'view' | 'edit' | 'remove', l: PermissionLevel, title: string)}
	{@const current = levelOf(l)}
	{@const fixed = locked(l.all)}
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<div class="inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-surface p-0.5" role="radiogroup" aria-label="{area.title}: {title}">
			{#each choices(l) as c (c.value)}
				{@const on = current === c.value}
				<button
					type="button"
					role="radio"
					aria-checked={on}
					disabled={!canEdit || (fixed && !on)}
					class="rounded-[0.6rem] px-2.5 py-1 text-[0.8125rem] font-medium whitespace-nowrap transition-colors {on
						? c.value === 'none'
							? 'bg-surface-3 text-ink'
							: 'bg-ink text-surface'
						: 'text-ink-2 enabled:hover:bg-surface-3 enabled:hover:text-ink disabled:opacity-40'}"
					onclick={() => {
						if (!on) setLevel(area, which, c.value);
					}}
				>
					{c.label}
				</button>
			{/each}
		</div>
		{#if fixed}<span class="text-ink-3" title="Kann dem Admin nicht entzogen werden"><Lock size={15} aria-label="Fest beim Admin" /></span>{/if}
		{#if l.hint}<span class="text-[0.8125rem] leading-tight text-ink-3">{l.hint}</span>{/if}
	</div>
{/snippet}

{#snippet single(area: PermissionArea, p: Permission, title: string, hint: string | undefined)}
	{@const on = has(p)}
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<div class="inline-flex gap-0.5 rounded-xl border border-line bg-surface p-0.5" role="radiogroup" aria-label="{area.title}: {title}">
			{#each [false, true] as value (value)}
				<button
					type="button"
					role="radio"
					aria-checked={on === value}
					disabled={!canEdit}
					class="rounded-[0.6rem] px-2.5 py-1 text-[0.8125rem] font-medium transition-colors {on === value
						? value
							? 'bg-ink text-surface'
							: 'bg-surface-3 text-ink'
						: 'text-ink-2 enabled:hover:bg-surface-3 enabled:hover:text-ink'}"
					onclick={() => {
						if (on !== value) toggle(p);
					}}
				>
					{value ? 'Ja' : 'Nein'}
				</button>
			{/each}
		</div>
		{#if hint}<span class="text-[0.8125rem] leading-tight text-ink-3">{hint}</span>{/if}
	</div>
{/snippet}

{#snippet label(text: string)}
	<dt class="pt-1 text-[0.75rem] font-semibold tracking-wide text-ink-3 uppercase sm:pt-[0.45rem]">{text}</dt>
{/snippet}

<svelte:head><title>{pageTitle('Berechtigungen')}</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 pt-2 pb-5">
	<div>
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><ShieldCheck size={26} aria-hidden="true" />Berechtigungen</h1>
		<p class="text-ink-2">Was jede Gruppe darf – je Bereich Sehen, Erstellen, Bearbeiten, Status und Löschen.</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<div class="inline-flex rounded-xl border border-line bg-surface p-1" role="group" aria-label="Ansicht">
			{#each [{ key: 'gruppe' as const, label: 'Je Gruppe', icon: Rows3 }, { key: 'vergleich' as const, label: 'Vergleich', icon: Table2 }] as v (v.key)}
				<button
					type="button"
					aria-pressed={view === v.key}
					class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {view === v.key
						? 'bg-ink text-surface'
						: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
					onclick={() => (view = v.key)}
				>
					<v.icon size={16} aria-hidden="true" />{v.label}
				</button>
			{/each}
		</div>
		{#if canEdit}
			<button type="button" class="btn btn-ghost" onclick={() => (confirmReset = true)}>
				<RotateCcw size={18} aria-hidden="true" />Auf Standard zurücksetzen
			</button>
		{/if}
	</div>
</div>

{#if form && 'message' in form && form.message}
	<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>
{/if}

<form
	method="POST"
	action="?/save"
	use:enhance={() => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') toast.success('Berechtigungen gespeichert');
			await update({ reset: false });
			await invalidateAll();
		};
	}}
>
	<!-- Der ganze Stand aller Gruppen geht mit – sichtbar ist immer nur eine -->
	{#each [...allowed] as k (k)}<input type="hidden" name="erlaubt" value={k} />{/each}

	{#if view === 'gruppe'}
		<!-- Gruppe wählen -->
		<div class="mb-3 flex gap-1.5 overflow-x-auto px-1 pt-1.5 pb-1" role="tablist" aria-label="Gruppe">
			{#each ROLES as r (r)}
				<button
					type="button"
					role="tab"
					aria-selected={role === r}
					class="relative shrink-0 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors {role === r
						? 'border-ink bg-ink text-surface'
						: 'border-line-strong bg-surface text-ink-2 hover:bg-surface-3'}"
					onclick={() => (role = r)}
					title="Sieht {areasFor(r)} von {PERMISSION_AREAS.length} Bereichen"
				>
					{ROLE_LABELS[r]}<span class="num ml-1.5 text-[0.75rem] opacity-60">{areasFor(r)}</span>
					{#if changedRoles.includes(r)}
						<span class="absolute -top-1 -right-1 size-2.5 rounded-full bg-warn ring-2 ring-surface" title="Ungespeicherte Änderungen"></span>
					{/if}
				</button>
			{/each}
		</div>
		<p class="mb-5 text-sm text-ink-2"><span class="font-medium text-ink">{ROLE_LABELS[role]}:</span> {ROLE_DESCRIPTIONS[role]}</p>

		{#each sections as [section, areas] (section)}
			<section class="mb-6">
				<h2 class="mb-2.5 flex items-baseline gap-2 font-display text-lg font-semibold">
					{section}
					<span class="num text-sm font-normal text-ink-3">{areas.filter((a) => levelOf(a.view) !== 'none').length} von {areas.length} sichtbar</span>
				</h2>
				<div class="gap-4 xl:columns-2">
					{#each areas as area (area.key)}
						{@const closed = levelOf(area.view) === 'none'}
						<article
							id="bereich-{area.key}"
							class="card mb-4 break-inside-avoid p-4 transition-shadow {closed ? 'bg-surface-2' : ''} {flash === area.key ? 'ring-2 ring-brand' : ''}"
						>
							<header class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<h3 class="font-medium {closed ? 'text-ink-2' : ''}">{area.title}</h3>
									{#if area.hint}<p class="text-[0.8125rem] text-ink-3">{area.hint}</p>{/if}
								</div>
								<div class="flex shrink-0 items-center gap-1.5">
									{#if differs(area, role)}<span class="badge badge-warn">Geändert</span>{/if}
									{#if closed}<span class="badge">Kein Zugriff</span>{/if}
								</div>
							</header>

							<dl class="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-y-2.5">
								{@render label('Sehen')}
								<dd class="mb-2 sm:mb-0">{@render choice(area, 'view', area.view, 'Sehen')}</dd>

								{#if !closed}
									{#if area.create}
										{@render label(area.create.label ?? 'Erstellen')}
										<dd class="mb-2 sm:mb-0">{@render single(area, area.create.key, area.create.label ?? 'Erstellen', area.create.hint)}</dd>
									{/if}
									{#if area.edit}
										{@render label(area.edit.label ?? 'Bearbeiten')}
										<dd class="mb-2 sm:mb-0">
											{#if stepped(area.edit) || locked(area.edit.all)}
												{@render choice(area, 'edit', area.edit, area.edit.label ?? 'Bearbeiten')}
											{:else}
												{@render single(area, area.edit.all, area.edit.label ?? 'Bearbeiten', area.edit.hint)}
											{/if}
										</dd>
									{/if}
									{#if area.status?.length}
										{@render label('Status')}
										<dd class="mb-2 flex flex-wrap gap-1.5 sm:mb-0" role="group" aria-label="{area.title}: Status">
											{#each area.status as st (st.key)}
												{@const on = has(st.key)}
												<button
													type="button"
													role="checkbox"
													aria-checked={on}
													disabled={!canEdit}
													title={st.hint}
													class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.8125rem] font-medium transition-colors {on
														? 'border-ink bg-ink text-surface'
														: 'border-line-strong text-ink-2 enabled:hover:border-ink-3 enabled:hover:text-ink'}"
													onclick={() => toggle(st.key)}
												>
													{#if on}<Check size={14} aria-hidden="true" />{/if}{st.label}
												</button>
											{/each}
										</dd>
									{/if}
									{#if area.remove}
										{@render label('Löschen')}
										<dd>
											{#if stepped(area.remove)}
												{@render choice(area, 'remove', area.remove, 'Löschen')}
											{:else}
												{@render single(area, area.remove.all, 'Löschen', area.remove.hint)}
											{/if}
										</dd>
									{/if}
								{/if}
							</dl>
							{#if closed && areaActions(area).length}
								<p class="mt-2 text-[0.8125rem] text-ink-3">Die übrigen Rechte erscheinen, sobald Sehen erlaubt ist.</p>
							{/if}
						</article>
					{/each}
				</div>
			</section>
		{/each}
	{:else}
		<!-- Vergleich: alle Gruppen nebeneinander -->
		<section class="card overflow-hidden">
			<div class="overflow-x-auto">
				<table class="w-full min-w-[56rem] border-collapse text-sm">
					<thead>
						<tr class="border-b border-line bg-surface-2">
							<th scope="col" class="sticky left-0 z-10 w-[12rem] bg-surface-2 px-4 py-2.5 text-left font-semibold">Bereich</th>
							{#each ROLES as r (r)}
								<th scope="col" class="px-2 py-2.5 text-left align-bottom font-semibold">
									{ROLE_LABELS[r]}
									{#if changedRoles.includes(r)}
										<span class="ml-1 inline-block size-2 rounded-full bg-warn align-middle" title="Ungespeicherte Änderungen"></span>
									{/if}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each sections as [section, areas] (section)}
							<tr class="border-b border-line">
								<th colspan={ROLES.length + 1} scope="colgroup" class="px-4 pt-4 pb-1.5 text-left font-display text-[0.9375rem] font-semibold">
									<span class="sticky left-4">{section}</span>
								</th>
							</tr>
							{#each areas as area (area.key)}
								<tr class="border-b border-line last:border-0">
									<th scope="row" class="sticky left-0 z-10 bg-surface px-4 py-1.5 text-left font-medium">{area.title}</th>
									{#each ROLES as r (r)}
										{@const sees = levelOf(area.view, r) !== 'none'}
										<td class="px-1 py-1 align-top">
											<button
												type="button"
												class="w-full rounded-lg px-1.5 py-1 text-left hover:bg-surface-3"
												title="{ROLE_LABELS[r]}: {area.title} öffnen"
												onclick={() => openArea(r, area)}
											>
												<span class="block text-[0.8125rem] font-medium whitespace-nowrap {sees ? '' : 'text-ink-3'}">{levelText(area.view, r)}</span>
												{#if sees}
													<span class="mt-1 flex gap-0.5">
														{#each marks(area, r) as m (m.letter)}
															<span
																class="grid size-[1.125rem] place-items-center rounded text-[0.625rem] font-bold {m.state === 'full'
																	? 'bg-ink text-surface'
																	: m.state === 'part'
																		? 'bg-brand text-brand-ink'
																		: 'text-ink-3 opacity-60 ring-1 ring-line'}"
																title={m.title}>{m.letter}</span
															>
														{/each}
													</span>
												{/if}
											</button>
										</td>
									{/each}
								</tr>
							{/each}
						{/each}
					</tbody>
				</table>
			</div>
		</section>
		<p class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem] text-ink-2">
			<span><b>E</b> Erstellen · <b>B</b> Bearbeiten · <b>S</b> Status · <b>L</b> Löschen</span>
			<span class="inline-flex items-center gap-1.5"><span class="inline-block size-3.5 rounded bg-ink"></span>ganz</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="inline-block size-3.5 rounded bg-brand"></span>teilweise – eigene Partie, in Arbeit oder nur einzelne Status
			</span>
			<span class="inline-flex items-center gap-1.5"><span class="inline-block size-3.5 rounded ring-1 ring-line"></span>nein</span>
			<span>Ein Klick öffnet die Gruppe an dieser Stelle.</span>
		</p>
	{/if}

	<!-- Die Leiste erscheint erst, wenn es etwas zu speichern gibt -->
	{#if canEdit && (changed || busy)}
		<div class="lg:sticky mt-2 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-[var(--shadow-1)] backdrop-blur lg:bottom-6">
			<button class="btn btn-primary" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Änderungen speichern'}</button>
			<button type="button" class="btn btn-ghost" disabled={busy} onclick={() => (allowed = fromMatrix(data.matrix))}>Verwerfen</button>
			<p class="text-sm text-ink-2">
				Ungespeichert{changedRoles.length ? `: ${changedRoles.map((r) => ROLE_LABELS[r]).join(', ')}` : ''}
			</p>
		</div>
	{/if}
	<p class="field-hint mt-3">
		Wer in einem Bereich etwas darf, darf ihn auch sehen – das wird gleich mit gesetzt. „Eigene Partie“ heißt: nur die der eigenen Partie
		(bei Tagesberichten auch die selbst angelegten). „Nur eigene“ bei Stundenzetteln heißt: nur den Zettel der Person selbst, ohne etwas daran zu ändern. Das
		Schloss markiert Rechte, die dem Admin nicht entzogen werden können – sonst käme niemand mehr an Benutzer, Berechtigungen und Einstellungen.
	</p>
</form>

<Dialog bind:open={confirmReset} title="Auf Standard zurücksetzen?">
	<p class="text-ink-2">Alle Gruppen bekommen wieder die ausgelieferten Standardrechte. Eigene Anpassungen gehen dabei verloren.</p>
	<form
		method="POST"
		action="?/reset"
		class="mt-5 flex justify-end gap-2"
		use:enhance={() => async ({ update }) => {
			confirmReset = false;
			toast.success('Berechtigungen zurückgesetzt');
			await update();
			await invalidateAll();
		}}
	>
		<button type="button" class="btn btn-ghost" onclick={() => (confirmReset = false)}>Abbrechen</button>
		<button class="btn btn-primary">Zurücksetzen</button>
	</form>
</Dialog>
