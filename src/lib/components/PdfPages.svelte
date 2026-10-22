<script lang="ts">
	/**
	 * Alle Seiten eines PDFs als Bilder – für die Druckansicht von Formularen mit
	 * Handschrift. Anders als PdfViewer zeichnet sie sofort alle Seiten, damit
	 * beim Drucken nichts fehlt, und meldet sich, wenn sie fertig ist.
	 */
	import { onMount, tick } from 'svelte';
	import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

	interface Props {
		url: string;
		title: string;
		onready?: () => void;
	}
	let { url, title, onready }: Props = $props();

	let images = $state<string[]>([]);
	let status = $state<'laden' | 'fertig' | 'fehler'>('laden');
	let box: HTMLDivElement;

	onMount(() => {
		let cancelled = false;
		let loading: PDFDocumentLoadingTask | null = null;
		(async () => {
			try {
				const pdfjs = await import('pdfjs-dist');
				const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
				pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
				loading = pdfjs.getDocument({ url, withCredentials: true });
				const doc = await loading.promise;
				const out: string[] = [];
				for (let n = 1; n <= doc.numPages; n++) {
					const page = await doc.getPage(n);
					// Rund 200 dpi – scharf auf Papier, ohne riesige Bilder
					const vp = page.getViewport({ scale: 2.8 });
					const canvas = document.createElement('canvas');
					canvas.width = Math.round(vp.width);
					canvas.height = Math.round(vp.height);
					await page.render({ canvas, viewport: vp }).promise;
					out.push(canvas.toDataURL('image/png'));
					if (cancelled) return;
				}
				images = out;
				status = 'fertig';
				// Erst melden, wenn die Bilder fertig dekodiert sind – sonst zeigt das erste Druckfenster leere Seiten
				await tick();
				await Promise.all([...box.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
				await new Promise((r) => requestAnimationFrame(r));
				if (cancelled) return;
				onready?.();
			} catch (err) {
				console.error('[pdf]', err);
				if (!cancelled) {
					status = 'fehler';
					onready?.();
				}
			}
		})();
		return () => {
			cancelled = true;
			loading?.destroy();
		};
	});
</script>

{#if status === 'laden'}
	<p class="py-16 text-center text-ink-3 print:hidden">Formular wird vorbereitet …</p>
{:else if status === 'fehler'}
	<p class="py-10 text-center text-danger">Das Formular konnte nicht geladen werden.</p>
{/if}
<div class="seiten" bind:this={box}>
	{#each images as src, i (i)}
		<img {src} alt="{title} – Seite {i + 1}" class="seite" />
	{/each}
</div>

<style>
	.seite {
		display: block;
		width: 100%;
		max-width: 200mm;
		margin: 0 auto 1.5rem;
		background: #fff;
		box-shadow: var(--shadow-1);
	}
	@media print {
		.seite {
			max-width: none;
			margin: 0;
			box-shadow: none;
			break-after: page;
		}
		.seite:last-child {
			break-after: auto;
		}
	}
</style>
