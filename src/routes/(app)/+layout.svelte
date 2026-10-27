<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import MoreSheet from '$lib/components/MoreSheet.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import NavProgress from '$lib/components/NavProgress.svelte';
	import ScanResultDialog from '$lib/modules/lager/components/ScanResultDialog.svelte';
	import CameraScanner from '$lib/modules/lager/components/CameraScanner.svelte';
	import { can } from '$lib/permissions';
	import { installWedgeListener, onScan, SCAN_PRIORITY } from '$lib/modules/lager/scan/wedge';
	import { install } from '$lib/install.svelte';
	import { lookupScan } from '$lib/modules/lager/scan/lookup';
	import { feedbackError, feedbackSuccess } from '$lib/modules/lager/scan/feedback';
	import { scanner } from '$lib/modules/lager/scan/scanner.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { resyncPush } from '$lib/push';
	import type { LookupResult } from '$lib/modules/lager/types';

	let { data, children } = $props();

	let moreOpen = $state(false);
	let resultOpen = $state(false);
	let result = $state<LookupResult | null>(null);

	const showAlerts = $derived(can(data.user.role, 'lager.warnungen.sehen'));

	/**
	 * Neue Benachrichtigung, während die App offen ist: kurz einblenden. Die
	 * zuletzt gezeigte merken wir uns, damit ein Neuladen nichts doppelt meldet.
	 */
	let lastShown: number | null = null;
	$effect(() => {
		const latest = data.notifications.latest;
		if (lastShown !== null && latest && latest.id > lastShown) toast.info(latest.title, latest.body || undefined);
		lastShown = Math.max(lastShown ?? 0, latest?.id ?? 0);
	});

	onMount(() => {
		const uninstall = installWedgeListener();
		const stopInstallCheck = install.start();

		// Standard-Empfänger: Scan irgendwo in der App → Artikel anzeigen.
		// Seiten wie "Buchen" registrieren eigene Empfänger und haben Vorrang.
		const off = onScan(async (scan) => {
			if (scanner.open && scanner.mode === 'continuous') return;
			try {
				const r = await lookupScan(scan.variants);
				if (r.products.length) feedbackSuccess();
				else feedbackError();
				result = r;
				resultOpen = true;
			} catch {
				feedbackError();
				toast.error('Suche fehlgeschlagen', 'Bitte Verbindung prüfen und erneut scannen.');
			}
		}, SCAN_PRIORITY.global);

		// Live-Aktualisierung: andere Geräte haben gebucht
		let es: EventSource | null = null;
		let timer: ReturnType<typeof setTimeout>;
		const connect = () => {
			es = new EventSource('/api/events');
			es.addEventListener('stock', () => {
				clearTimeout(timer);
				timer = setTimeout(() => invalidate('app:stock'), 250);
			});
			// Fahrzeuge: neuer Standort – offene Karten neu laden, höchstens alle 3 Sekunden
			let fleetAt = 0;
			es.addEventListener('fahrzeuge', () => {
				if (!can(data.user.role, 'fahrzeuge.sehen') || Date.now() - fleetAt < 3000) return;
				fleetAt = Date.now();
				invalidate('app:fahrzeuge');
			});
			// Benachrichtigungen: nur die Nummern der Empfänger kommen mit – betrifft es mich, Glocke neu laden
			es.addEventListener('notifications', (e) => {
				try {
					const { userIds } = JSON.parse((e as MessageEvent).data) as { userIds: number[] };
					if (userIds.includes(data.user.id)) invalidate('app:notifications');
				} catch {
					/* unlesbar – ignorieren */
				}
			});
		};
		connect();
		// Ist Push hier an, meldet sich das Gerät für die angemeldete Person (neu) an
		resyncPush();

		return () => {
			uninstall();
			stopInstallCheck();
			off();
			es?.close();
			clearTimeout(timer);
		};
	});
</script>

<a href="#main" class="sr-only z-[90] rounded-lg bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Zum Inhalt springen</a>

<NavProgress />

<div class="print:hidden"><Sidebar user={data.user} lowStockCount={data.lowStockCount} theme={data.theme} /></div>

<div class="min-h-dvh lg:pl-64 print:pl-0">
	<div class="contents print:hidden"><TopBar unread={data.notifications.unread} role={data.user.role} onscan={() => scanner.openCamera()} /></div>
	<main
		id="main"
		tabindex="-1"
		class="mx-auto w-full px-4 pt-4 pb-28 outline-none sm:px-6 lg:px-8 lg:pt-2 lg:pb-12 print:max-w-none print:px-0 print:pt-0 print:pb-0"
		style="view-transition-name: main"
	>
		<!--
			Ein anderer Datensatz derselben Seite (über die Suche, „Duplizieren", „Zum Teil …"):
			neu aufbauen. Sonst behält SvelteKit die Seite samt Formular, Fotos und Handschrift
			des vorigen – und Speichern schriebe dessen Stand in den neuen.
		-->
		{#key page.params.id}
			{@render children()}
		{/key}
	</main>
</div>

<div class="print:hidden">
	<BottomNav role={data.user.role} onscan={() => scanner.openCamera()} onmore={() => (moreOpen = true)} moreBadge={showAlerts ? data.lowStockCount : 0} />
</div>
<MoreSheet bind:open={moreOpen} user={data.user} lowStockCount={data.lowStockCount} theme={data.theme} />

<ScanResultDialog
	bind:open={resultOpen}
	{result}
	canBook={can(data.user.role, 'lager.bestand.buchen')}
	canCreate={can(data.user.role, 'lager.artikel.erstellen')}
	canManage={can(data.user.role, 'lager.artikel.bearbeiten')}
/>

{#if scanner.open}
	<CameraScanner />
{/if}

<Toaster />
