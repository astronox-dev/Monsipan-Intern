<script lang="ts">
	/**
	 * Suche über das ganze Portal – oben in der Kopfleiste (Strg K) und am Handy
	 * im Dialog. Seiten (Menüpunkte) findet sie hier im Browser, alles andere
	 * kommt von /api/suche – je Bereich die ersten Treffer, nur was man sehen darf.
	 * Pfeiltasten wandern durch alle Treffer, Enter öffnet, Esc schließt.
	 */
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import Search from '@lucide/svelte/icons/search';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { allNavItems } from '$lib/nav';
	import type { Role } from '$lib/permissions';

	interface Props {
		role: Role;
		/** Handscanner-Eingaben in diesem Feld gehen an den Scan-Empfänger (wer Artikel sieht) */
		scanTarget?: boolean;
		shortcut?: boolean;
		autofocus?: boolean;
		id?: string;
		size?: 'md' | 'lg';
		/** Treffer im Fluss statt als Klappliste – im Dialog am Handy */
		inline?: boolean;
		onnavigate?: () => void;
	}
	let { role, scanTarget = false, shortcut = false, autofocus = false, id = 'global-search', size = 'md', inline = false, onnavigate }: Props = $props();

	type Hit = { id: string; title: string; detail: string; href: string; badge?: { label: string; tone: string } };
	type Group = { key: string; label: string; hits: Hit[]; more?: string };

	let query = $state('');
	let groups = $state<Group[]>([]);
	let open = $state(false);
	let active = $state(0);
	let loading = $state(false);
	let input = $state<HTMLInputElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	/** Für den Vergleich: klein, ohne weiche Trennstriche */
	const norm = (s: string) => s.replace(/­/g, '').toLocaleLowerCase('de-AT');
	const pages = $derived(allNavItems(role));

	function pageGroup(q: string): Group | null {
		const n = norm(q.trim());
		if (n.length < 2) return null;
		const hits = pages
			.filter((p) => norm(p.label).includes(n))
			.slice(0, 5)
			.map((p) => ({ id: `seite-${p.href}`, title: p.label.replace(/­/g, ''), detail: 'Seite', href: p.href }));
		return hits.length ? { key: 'seiten', label: 'Seiten', hits } : null;
	}

	/** Alle Treffer am Stück – für die Pfeiltasten */
	const flat = $derived(groups.flatMap((g) => g.hits));

	function search(q: string) {
		clearTimeout(timer);
		const page = pageGroup(q);
		if (q.trim().length < 2) {
			groups = [];
			open = false;
			return;
		}
		// Seiten sofort, der Rest kurz nach dem Tippen
		groups = page ? [page, ...groups.filter((g) => g.key !== 'seiten')] : groups.filter((g) => g.key !== 'seiten');
		open = true;
		timer = setTimeout(async () => {
			const my = ++seq;
			loading = true;
			try {
				const res = await fetch(`/api/suche?q=${encodeURIComponent(q)}`);
				const data = (await res.json()) as { groups: Group[] };
				if (my !== seq) return;
				groups = [...(page ? [page] : []), ...(data.groups ?? [])];
				active = 0;
			} catch {
				/* Netz weg – die Seiten bleiben */
			} finally {
				if (my === seq) loading = false;
			}
		}, 180);
	}

	function choose(href: string) {
		open = false;
		query = '';
		groups = [];
		onnavigate?.();
		goto(href);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = flat.length > 0;
			active = Math.min(active + 1, flat.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Enter') {
			if (open && flat[active]) {
				e.preventDefault();
				choose(flat[active].href);
			}
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	$effect(() => {
		if (autofocus) input?.focus();
	});

	$effect(() => {
		if (!shortcut) return;
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				input?.focus();
				input?.select();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// Das gewählte sichtbar halten
	$effect(() => {
		const hit = flat[active];
		if (open && hit) document.getElementById(`${id}-opt-${hit.id}`)?.scrollIntoView({ block: 'nearest' });
	});
</script>

<div class="relative w-full">
	<label for={id} class="sr-only">Im Portal suchen</label>
	<Search size={18} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden="true" />
	<input
		bind:this={input}
		{id}
		type="search"
		class="input pl-10 {size === 'lg' ? 'min-h-12 text-[1.0625rem]' : ''} {shortcut ? 'pr-16' : ''}"
		placeholder="Im Portal suchen – Aufträge, Kunden, Artikel …"
		autocomplete="off"
		spellcheck="false"
		role="combobox"
		aria-expanded={open}
		aria-controls="{id}-list"
		aria-autocomplete="list"
		aria-activedescendant={open && flat[active] ? `${id}-opt-${flat[active].id}` : undefined}
		data-scan-target={scanTarget ? '' : undefined}
		bind:value={query}
		oninput={() => search(query)}
		onfocus={() => (open = groups.length > 0 || query.trim().length >= 2)}
		onblur={() => setTimeout(() => (open = false), 150)}
		{onkeydown}
	/>
	{#if shortcut}
		<kbd
			class="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-3 lg:block"
			>Strg K</kbd
		>
	{/if}

	{#if open || inline}
		<div
			id="{id}-list"
			role="listbox"
			aria-label="Treffer"
			class={inline
				? 'mt-3'
				: 'absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-2)]'}
			transition:fly={{ y: -4, duration: inline ? 0 : 160 }}
		>
			{#each groups as g (g.key)}
				<div role="group" aria-label={g.label} class="py-1">
					<div class="flex items-center justify-between gap-2 px-2.5 pt-1 pb-1">
						<span class="text-[0.75rem] font-semibold tracking-wide text-ink-3 uppercase">{g.label}</span>
						{#if g.more && g.hits.length >= 5}
							<a
								href={g.more}
								class="inline-flex items-center gap-1 text-[0.75rem] font-medium text-ink-2 hover:text-ink"
								onmousedown={(e) => {
									e.preventDefault();
									choose(g.more!);
								}}>Alle Treffer<ArrowRight size={12} aria-hidden="true" /></a
							>
						{/if}
					</div>
					{#each g.hits as h (h.id)}
						{@const i = flat.indexOf(h)}
						<div
							id="{id}-opt-{h.id}"
							role="option"
							tabindex="-1"
							aria-selected={i === active}
							class="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 {i === active ? 'bg-surface-3' : ''}"
							onmousedown={(e) => {
								e.preventDefault();
								choose(h.href);
							}}
							onmouseenter={() => (active = i)}
						>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium">{h.title}</span>
								{#if h.detail}<span class="block truncate text-sm text-ink-3">{h.detail}</span>{/if}
							</span>
							{#if h.badge}<span class="badge shrink-0 {h.badge.tone}">{h.badge.label}</span>{/if}
						</div>
					{/each}
				</div>
			{:else}
				{#if query.trim().length >= 2}
					<p class="px-3 py-4 text-center text-sm text-ink-3">{loading ? 'Suche …' : `Nichts gefunden für „${query.trim()}“`}</p>
				{:else if inline}
					<p class="px-1 text-sm text-ink-3">Aufträge, Angebote, Rechnungen, Tagesberichte, Anfragen, Kunden, Artikel und Seiten – nur, was du sehen darfst.</p>
				{/if}
			{/each}
		</div>
	{/if}
</div>
