<script lang="ts">
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { flip } from 'svelte/animate';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import Tag from '@lucide/svelte/icons/tag';
	import Palette from '@lucide/svelte/icons/palette';
	import Ruler from '@lucide/svelte/icons/ruler';
	import Dialog from '$lib/components/Dialog.svelte';
	import RalPicker from '$lib/modules/lager/components/RalPicker.svelte';
	import { findRal } from '$lib/ral';
	import { toast } from '$lib/stores/toast.svelte';
	import { withParams } from '$lib/url';
	import { can } from '$lib/permissions';

	let { data } = $props();

	/** Ansehen darf, wer Stammdaten sieht – Anlegen, Ändern und Löschen sind eigene Rechte */
	const canCreate = $derived(can(data.user.role, 'stammdaten.erstellen'));
	const canEdit = $derived(can(data.user.role, 'stammdaten.bearbeiten'));
	const canDelete = $derived(can(data.user.role, 'stammdaten.loeschen'));

	const TABS = [
		{ value: 'orte', label: 'Lagerorte', icon: Warehouse },
		{ value: 'partien', label: 'Partien', icon: UsersRound },
		{ value: 'materialarten', label: 'Materialarten', icon: Tag },
		{ value: 'farben', label: 'Farben', icon: Palette },
		{ value: 'einheiten', label: 'Einheiten', icon: Ruler }
	] as const;

	type Editing = {
		id: number | null;
		name: string;
		description?: string;
		note?: string;
		ral?: string | null;
		hex?: string;
	};
	let editing = $state<Editing | null>(null);
	let editOpen = $state(false);
	let confirm = $state<{ id: number; name: string; detail: string } | null>(null);
	let confirmOpen = $state(false);
	let formError = $state('');

	const tab = $derived(data.tab);
	const noun = $derived(
		tab === 'orte'
			? 'Lagerort'
			: tab === 'partien'
				? 'Partie'
				: tab === 'materialarten'
					? 'Materialart'
					: tab === 'farben'
						? 'Farbe'
						: 'Einheit'
	);

	function edit(e: Editing) {
		editing = { ...e };
		formError = '';
		editOpen = true;
	}

	/** Standard-Verhalten für alle Formulare: Fehler als Toast, Erfolg ohne Reload der ganzen Seite */
	const handle =
		(ok?: string, after?: () => void) =>
		() =>
		async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
			if (result.type === 'failure') {
				const msg = String(result.data?.message ?? 'Aktion fehlgeschlagen');
				if (editOpen) formError = msg;
				else toast.error(msg);
				return;
			}
			after?.();
			if (ok) toast.success(ok);
			await update({ reset: false });
		};
</script>

<svelte:head><title>{pageTitle('Stammdaten')}</title></svelte:head>

<div class="pt-2 pb-5">
	<h1 class="text-[2rem] leading-tight">Stammdaten</h1>
	<p class="text-ink-2">Listen, aus denen beim Buchen und Anlegen gewählt wird.</p>
</div>

<div class="no-scrollbar -mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
	<div class="inline-flex gap-1 rounded-2xl border border-line bg-surface p-1" role="tablist" aria-label="Bereich">
		{#each TABS as t (t.value)}
			<a
				role="tab"
				aria-selected={tab === t.value}
				href={withParams(page.url, { tab: t.value === 'orte' ? null : t.value })}
				data-sveltekit-noscroll
				class="flex h-10 items-center gap-2 rounded-xl px-3.5 text-[0.9375rem] font-medium whitespace-nowrap transition-colors {tab === t.value
					? 'bg-ink text-surface'
					: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
			>
				<t.icon size={17} aria-hidden="true" />{t.label}
			</a>
		{/each}
	</div>
</div>

<section class="card overflow-hidden">
	<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 lg:px-6">
		<p class="text-sm text-ink-2">
			{#if tab === 'orte'}Lagerorte mit Ware lassen sich erst deaktivieren, wenn sie leer sind.
			{:else if tab === 'partien'}Beim Ausbuchen wird ausgewählt, an welche Partie das Material geht. Ohne Partie wird auf die buchende Person gebucht.
			{:else if tab === 'materialarten'}Gruppiert Artikel für Filter und Berichte.
			{:else if tab === 'farben'}Farbmuster erscheinen als Streifen am Artikel.
			{:else}Auswahl für die Einheit in Angeboten, Rechnungen und Tagesberichten. Umbenennen und Löschen ändert bestehende Dokumente nicht.{/if}
		</p>
		{#if canCreate}
			<button
				class="btn btn-primary btn-sm"
				onclick={() => edit({ id: null, name: '', description: '', note: '', hex: '#9AA0A6' })}
			>
				<Plus size={16} aria-hidden="true" />{noun} anlegen
			</button>
		{/if}
	</div>

	{#snippet order(id: number, first: boolean, last: boolean)}
		<form method="POST" action="?/move" class="flex flex-col" use:enhance={handle()}>
			<input type="hidden" name="entity" value={tab} />
			<input type="hidden" name="id" value={id} />
			<button name="dir" value="up" class="grid h-5 w-7 place-items-center rounded text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-30" disabled={first} aria-label="Nach oben">
				<ChevronUp size={16} />
			</button>
			<button name="dir" value="down" class="grid h-5 w-7 place-items-center rounded text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-30" disabled={last} aria-label="Nach unten">
				<ChevronDown size={16} />
			</button>
		</form>
	{/snippet}

	{#snippet toggle(id: number, active: boolean)}
		<form method="POST" action="?/toggle" use:enhance={handle(active ? 'Deaktiviert' : 'Aktiviert')}>
			<input type="hidden" name="entity" value={tab} />
			<input type="hidden" name="id" value={id} />
			<input type="hidden" name="active" value={String(!active)} />
			<button class="switch" role="switch" aria-checked={active} aria-label={active ? 'Aktiv – zum Deaktivieren klicken' : 'Inaktiv – zum Aktivieren klicken'}>
				<span></span>
			</button>
		</form>
	{/snippet}

	<ul class="divide-y divide-line">
		{#if tab === 'orte'}
			{#each data.locations as l, i (l.id)}
				<li class="flex items-center gap-3 px-4 py-3 lg:px-6" animate:flip={{ duration: 220 }} class:opacity-60={!l.active}>
					{#if canEdit}{@render order(l.id, i === 0, i === data.locations.length - 1)}{/if}
					<div class="min-w-0 flex-1">
						<p class="font-medium">{l.name}{#if !l.active}<span class="badge ml-2">Inaktiv</span>{/if}</p>
						<p class="text-sm text-ink-3">
							{l.units > 0 ? `${l.units} Stück in ${l.articles} Artikeln` : 'Leer'}{l.description ? `, ${l.description}` : ''}
						</p>
					</div>
					{#if canEdit}{@render toggle(l.id, l.active)}{/if}
					{#if canEdit}<button class="btn btn-ghost btn-sm btn-icon" aria-label="{l.name} bearbeiten" onclick={() => edit({ id: l.id, name: l.name, description: l.description })}><Pencil size={16} /></button>{/if}
					{#if canDelete}
					<button
						class="btn btn-ghost btn-sm btn-icon hover:text-danger"
						aria-label="{l.name} löschen"
						onclick={() => {
							confirm = { id: l.id, name: l.name, detail: l.moves > 0 ? 'Hat Buchungen – kann nur deaktiviert werden.' : 'Wird endgültig entfernt.' };
							confirmOpen = true;
						}}><Trash size={16} /></button
					>
					{/if}
				</li>
			{/each}
		{:else if tab === 'partien'}
			{#each data.parties as p (p.id)}
				<li class="flex items-center gap-3 px-4 py-3 lg:px-6" class:opacity-60={!p.active}>
					<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-ink-2">
						<UsersRound size={18} aria-hidden="true" />
					</span>
					<div class="min-w-0 flex-1">
						<p class="font-medium">{p.name}{#if !p.active}<span class="badge ml-2">Inaktiv</span>{/if}</p>
						<p class="text-sm text-ink-3">
							{[p.members ? `${p.members} Benutzer` : 'Keine Benutzer', p.moves ? `${p.moves} Buchungen` : null, p.note || null]
								.filter(Boolean)
								.join(', ')}
						</p>
					</div>
					{#if canEdit}{@render toggle(p.id, p.active)}{/if}
					{#if canEdit}<button class="btn btn-ghost btn-sm btn-icon" aria-label="{p.name} bearbeiten" onclick={() => edit({ id: p.id, name: p.name, note: p.note })}><Pencil size={16} /></button>{/if}
					{#if canDelete}
					<button
						class="btn btn-ghost btn-sm btn-icon hover:text-danger"
						aria-label="{p.name} löschen"
						onclick={() => {
							confirm = {
								id: p.id,
								name: p.name,
								detail: p.members
									? 'Ist noch Benutzern zugeordnet – zuerst unter Benutzer umhängen.'
									: p.moves > 0
										? 'Hat Buchungen – kann nur deaktiviert werden.'
										: 'Wird endgültig entfernt.'
							};
							confirmOpen = true;
						}}><Trash size={16} /></button
					>
					{/if}
				</li>
			{:else}
				<li class="px-6 py-12 text-center text-ink-3">Noch keine Partien. Lege die Partien an, an die Material ausgegeben wird.</li>
			{/each}
		{:else if tab === 'materialarten'}
			{#each data.categories as c, i (c.id)}
				<li class="flex items-center gap-3 px-4 py-3 lg:px-6" animate:flip={{ duration: 220 }}>
					{#if canEdit}{@render order(c.id, i === 0, i === data.categories.length - 1)}{/if}
					<div class="min-w-0 flex-1">
						<p class="font-medium">{c.name}</p>
						<p class="text-sm text-ink-3">{c.products} Artikel</p>
					</div>
					{#if canEdit}<button class="btn btn-ghost btn-sm btn-icon" aria-label="{c.name} bearbeiten" onclick={() => edit({ id: c.id, name: c.name })}><Pencil size={16} /></button>{/if}
					{#if canDelete}
					<button
						class="btn btn-ghost btn-sm btn-icon hover:text-danger"
						aria-label="{c.name} löschen"
						onclick={() => {
							confirm = { id: c.id, name: c.name, detail: c.products ? `${c.products} Artikel verlieren ihre Materialart.` : 'Wird endgültig entfernt.' };
							confirmOpen = true;
						}}><Trash size={16} /></button
					>
					{/if}
				</li>
			{/each}
		{:else if tab === 'farben'}
			{#each data.colors as c, i (c.id)}
				<li class="flex items-center gap-3 px-4 py-3 lg:px-6" animate:flip={{ duration: 220 }}>
					{#if canEdit}{@render order(c.id, i === 0, i === data.colors.length - 1)}{/if}
					<span class="size-8 shrink-0 rounded-lg border border-black/10" style:background={c.hex}></span>
					<div class="min-w-0 flex-1">
						<p class="font-medium">{c.name}{#if c.ral}<span class="badge num ml-2">RAL {c.ral}</span>{/if}</p>
						<p class="num text-sm text-ink-3">
							{[findRal(c.ral)?.name, c.hex.toUpperCase(), `${c.products} Artikel`].filter(Boolean).join(', ')}
						</p>
					</div>
					{#if canEdit}<button class="btn btn-ghost btn-sm btn-icon" aria-label="{c.name} bearbeiten" onclick={() => edit({ id: c.id, name: c.name, ral: c.ral, hex: c.hex })}><Pencil size={16} /></button>{/if}
					{#if canDelete}
					<button
						class="btn btn-ghost btn-sm btn-icon hover:text-danger"
						aria-label="{c.name} löschen"
						onclick={() => {
							confirm = { id: c.id, name: c.name, detail: c.products ? `${c.products} Artikel verlieren ihre Farbe.` : 'Wird endgültig entfernt.' };
							confirmOpen = true;
						}}><Trash size={16} /></button
					>
					{/if}
				</li>
			{/each}
		{:else}
			{#each data.units as u, i (u.id)}
				{@const used = [u.offers && `${u.offers} Angebotspositionen`, u.reports && `${u.reports} Spalten in Tagesberichten`].filter(Boolean).join(', ')}
				<li class="flex items-center gap-3 px-4 py-3 lg:px-6" animate:flip={{ duration: 220 }}>
					{#if canEdit}{@render order(u.id, i === 0, i === data.units.length - 1)}{/if}
					<div class="min-w-0 flex-1">
						<p class="font-medium">{u.name}</p>
						<p class="text-sm text-ink-3">{used || 'Noch nicht verwendet'}</p>
					</div>
					{#if canEdit}<button class="btn btn-ghost btn-sm btn-icon" aria-label="{u.name} bearbeiten" onclick={() => edit({ id: u.id, name: u.name })}><Pencil size={16} /></button>{/if}
					{#if canDelete}
					<button
						class="btn btn-ghost btn-sm btn-icon hover:text-danger"
						aria-label="{u.name} löschen"
						onclick={() => {
							confirm = {
								id: u.id,
								name: u.name,
								detail: used
									? `Steht danach nicht mehr zur Auswahl. Wo sie schon verwendet wird (${used}), bleibt sie stehen.`
									: 'Wird endgültig entfernt.'
							};
							confirmOpen = true;
						}}><Trash size={16} /></button
					>
					{/if}
				</li>
			{:else}
				<li class="px-6 py-12 text-center text-ink-3">Noch keine Einheiten. Lege die Einheiten an, aus denen in Angeboten und Tagesberichten gewählt wird.</li>
			{/each}
		{/if}
	</ul>
</section>

<Dialog bind:open={editOpen} title={editing?.id ? `${noun} bearbeiten` : `${noun} anlegen`}>
	{#if editing}
		<form id="md-form" method="POST" action="?/save" class="space-y-4" use:enhance={handle(editing.id ? 'Gespeichert' : 'Angelegt', () => (editOpen = false))}>
			<input type="hidden" name="entity" value={tab} />
			{#if editing.id}<input type="hidden" name="id" value={editing.id} />{/if}
			<div>
				<label for="md-name" class="field-label">Name *</label>
				<input
					id="md-name"
					name="name"
					class="input"
					required
					maxlength={tab === 'einheiten' ? 20 : 80}
					placeholder={tab === 'einheiten' ? 'z. B. lfm' : null}
					bind:value={editing.name}
				/>
			</div>
			{#if tab === 'orte'}
				<div>
					<label for="md-desc" class="field-label">Beschreibung</label>
					<input id="md-desc" name="description" class="input" maxlength="200" bind:value={editing.description} placeholder="z. B. Gefahrgut, nur ADR" />
				</div>
			{:else if tab === 'partien'}
				<div>
					<label for="md-note" class="field-label">Notiz</label>
					<input id="md-note" name="note" class="input" maxlength="200" bind:value={editing.note} placeholder="z. B. Vorarbeiter, Telefonnummer" />
				</div>
			{:else if tab === 'farben'}
				{@const ralColor = findRal(editing.ral)}
				<div>
					<label for="md-ral" class="field-label">RAL-Farbe</label>
					<RalPicker
						id="md-ral"
						value={editing.ral ?? null}
						onpick={(c) => {
							if (!editing) return;
							editing.ral = c?.code ?? null;
							if (c) {
								editing.hex = c.hex;
								if (!editing.name.trim()) editing.name = c.name;
							}
						}}
					/>
					<input type="hidden" name="ral" value={editing.ral ?? ''} />
					<p class="field-hint">Nummer oder Name eintippen. Farben ohne RAL-Nummer (z. B. Transparent) bekommen nur ein Farbmuster.</p>
				</div>
				<div>
					<label for="md-hex-text" class="field-label">Farbmuster (Hex)</label>
					<div class="flex items-center gap-2">
						<input
							type="color"
							class="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
							aria-label="Farbmuster wählen"
							bind:value={editing.hex}
						/>
						<input
							id="md-hex-text"
							name="hex"
							class="input num w-36 uppercase"
							maxlength="7"
							pattern={'#[0-9A-Fa-f]{6}'}
							placeholder="#008754"
							bind:value={editing.hex}
						/>
						{#if ralColor && editing.hex?.toUpperCase() !== ralColor.hex}
							<button type="button" class="btn btn-ghost btn-sm" onclick={() => editing && (editing.hex = ralColor.hex)}>RAL-Farbton übernehmen</button>
						{/if}
					</div>
					<p class="field-hint">
						{#if ralColor}
							{editing.hex?.toUpperCase() === ralColor.hex ? `Farbton von RAL ${ralColor.code} ${ralColor.name}.` : `Eigener Farbton, weicht von RAL ${ralColor.code} ab.`}
						{:else}
							Ohne RAL-Nummer: Farbton frei wählen.
						{/if}
						Bildschirmfarben sind Näherungen.
					</p>
				</div>
			{/if}
			{#if formError}<p class="field-error" role="alert">{formError}</p>{/if}
		</form>
	{/if}
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (editOpen = false)}>Abbrechen</button>
		<button class="btn btn-primary" form="md-form">Speichern</button>
	{/snippet}
</Dialog>

<Dialog bind:open={confirmOpen} title="„{confirm?.name}“ löschen?">
	<p class="text-ink-2">{confirm?.detail}</p>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={() => (confirmOpen = false)}>Abbrechen</button>
		<form method="POST" action="?/delete" use:enhance={handle('Gelöscht', () => (confirmOpen = false))}>
			<input type="hidden" name="entity" value={tab} />
			<input type="hidden" name="id" value={confirm?.id} />
			<button class="btn btn-danger">Löschen</button>
		</form>
	{/snippet}
</Dialog>

<style>
	.switch {
		position: relative;
		width: 2.75rem;
		height: 1.625rem;
		border-radius: 999px;
		background: var(--c-line-strong);
		transition: background-color 180ms var(--ease-out);
	}
	.switch span {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 999px;
		background: var(--c-surface);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
		transition: transform 220ms var(--ease-spring);
	}
	.switch[aria-checked='true'] {
		background: var(--c-ok);
	}
	.switch[aria-checked='true'] span {
		transform: translateX(1.125rem);
	}
</style>
