<script lang="ts">
	import Bell from '@lucide/svelte/icons/bell';
	import Search from '@lucide/svelte/icons/search';
	import ScanBarcode from '@lucide/svelte/icons/scan-barcode';
	import Logo from './Logo.svelte';
	import GlobalSearch from './GlobalSearch.svelte';
	import Dialog from './Dialog.svelte';
	import { can, type Role } from '$lib/permissions';

	interface Props {
		/** Ungelesene Benachrichtigungen */
		unread: number;
		onscan: () => void;
		role: Role;
	}
	let { unread, onscan, role }: Props = $props();
	let searchOpen = $state(false);
	/** Wer Artikel sieht, kann im Suchfeld auch mit dem Handscanner suchen */
	const scanTarget = $derived(can(role, 'lager.artikel.sehen'));
</script>

<!-- Abstand oben um safe-area-inset-top: in der App liegt die Seite unter der Statusleiste -->
<header class="no-print sticky top-0 z-20 border-b border-line bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-lg lg:border-b-0">
	<div class="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
		<a href="/" class="rounded-lg lg:hidden" aria-label="Zur Übersicht"><Logo /></a>

		<div class="hidden w-full max-w-md lg:block">
			<GlobalSearch {role} {scanTarget} shortcut id="global-search" />
		</div>

		<div class="ml-auto flex items-center gap-1.5">
			<button class="btn btn-ghost btn-icon lg:hidden" aria-label="Im Portal suchen" onclick={() => (searchOpen = true)}>
				<Search size={21} />
			</button>
			<button class="btn btn-secondary hidden lg:inline-flex" onclick={onscan}>
				<ScanBarcode size={18} aria-hidden="true" /> Mit Kamera scannen
			</button>
			<a
				href="/benachrichtigungen"
				class="btn btn-ghost btn-icon relative"
				aria-label={unread > 0 ? `${unread} ungelesene Benachrichtigungen` : 'Benachrichtigungen'}
			>
				<Bell size={21} aria-hidden="true" />
				{#if unread > 0}
					{#key unread}
						<span
							class="num absolute top-1.5 right-1.5 grid h-[1.125rem] min-w-[1.125rem] animate-pop place-items-center rounded-full bg-warn px-1 text-[0.6875rem] font-semibold text-white ring-2 ring-bg"
						>
							{unread > 99 ? '99+' : unread}
						</span>
					{/key}
				{/if}
			</a>
		</div>
	</div>
</header>

<Dialog bind:open={searchOpen} title="Suchen">
	<div class="min-h-[50vh] pb-6">
		<GlobalSearch {role} {scanTarget} autofocus inline id="mobile-search" size="lg" onnavigate={() => (searchOpen = false)} />
	</div>
</Dialog>
