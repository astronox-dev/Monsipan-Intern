<script lang="ts">
	/** Eine Unterlage (PDF) ansehen – am Auftrag wie am Angebot */
	import { pageTitle } from '$lib/app';
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Download from '@lucide/svelte/icons/download';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import PdfViewer from '$lib/components/PdfViewer.svelte';
	import { fileSizeLabel } from '$lib/documents';
	import { inNativeApp } from '$lib/native';

	interface Props {
		back: { href: string; label: string };
		document: { title: string; fileName: string; size: number };
		fileUrl: string;
		/** Zusatz unter dem Titel, etwa „vom Angebot" */
		note?: string;
	}
	let { back, document: d, fileUrl, note }: Props = $props();

	// In der Android-App gibt es keinen Download-Ordner – dort nur anzeigen
	let native = $state(false);
	let failed = $state(false);
	onMount(() => {
		native = inNativeApp();
	});
</script>

<svelte:head><title>{pageTitle(d.title)}</title></svelte:head>

<a href={back.href} class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />{back.label}
</a>

<header class="mt-3 flex flex-wrap items-start justify-between gap-3 pb-4">
	<div class="min-w-0">
		<h1 class="text-[1.625rem] leading-tight sm:text-[2rem]">{d.title}</h1>
		<p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3">
			<span class="truncate">{d.fileName}</span>
			<span>{fileSizeLabel(d.size)}</span>
			{#if note}<span>· {note}</span>{/if}
		</p>
	</div>
	{#if !native}
		<div class="flex gap-2">
			<a href={fileUrl} class="btn btn-secondary" target="_blank" rel="noopener"><ExternalLink size={18} aria-hidden="true" />Im Browser öffnen</a>
			<a href="{fileUrl}?download" class="btn btn-secondary" download={d.fileName}><Download size={18} aria-hidden="true" />Herunterladen</a>
		</div>
	{/if}
</header>

<section class="card p-2 sm:p-3">
	<PdfViewer url={fileUrl} title={d.title} onerror={() => (failed = true)} />
	{#if failed && !native}
		<p class="px-2 pt-3 text-sm text-ink-2">
			Falls die Anzeige hier nicht klappt: <a href={fileUrl} target="_blank" rel="noopener" class="underline">im Browser öffnen</a>.
		</p>
	{/if}
</section>
