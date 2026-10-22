<script lang="ts">
	import { onMount, tick } from 'svelte';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import MoveHorizontal from '@lucide/svelte/icons/move-horizontal';
	import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

	/**
	 * Zeigt ein PDF direkt auf der Seite an (pdf.js). Nötig, weil Chrome auf
	 * Android und die Android-App PDFs sonst nur herunterladen statt anzeigen.
	 * Seiten werden erst gezeichnet, wenn sie in die Nähe des Bildschirms kommen.
	 *
	 * Am Handy und Tablet zoomen zwei Finger nur das PDF, nicht die ganze Seite;
	 * doppelt tippen springt zwischen Breite und 200 %. Mit einem Finger lässt
	 * sich das vergrößerte PDF verschieben.
	 */
	interface Props {
		url: string;
		/** Für Bildschirmleser */
		title: string;
		onerror?: () => void;
	}
	let { url, title, onerror }: Props = $props();

	type Point = { x: number; y: number };

	const ZOOMS = [1, 1.25, 1.5, 2, 3, 4];
	const MAX_ZOOM = ZOOMS[ZOOMS.length - 1];
	/** Obergrenze je Seite – größere Zeichenflächen bringen Handys an den Speicherrand */
	const MAX_PIXELS = 2 ** 23;

	let container: HTMLDivElement;
	let pagesBox = $state<HTMLDivElement>();
	let width = $state(0);
	let zoom = $state(1);
	let pages = $state<{ n: number; w: number; h: number }[]>([]);
	let status = $state<'laden' | 'fertig' | 'fehler'>('laden');
	let doc: PDFDocumentProxy | null = null;
	let loading: PDFDocumentLoadingTask | null = null;

	/** Maßstab je Seite: Breite anpassen, dann Zoom */
	const scaleFor = (w: number) => (width > 0 ? ((width - 2) / w) * zoom : 1);
	const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(1, z));

	onMount(() => {
		let cancelled = false;
		const resize = new ResizeObserver(([entry]) => {
			// Breite nur bei spürbarer Änderung übernehmen, sonst zeichnet alles neu
			const w = Math.floor(entry.contentRect.width);
			if (Math.abs(w - width) > 8) width = w;
		});
		resize.observe(container);
		const stopGestures = gestures(container);

		(async () => {
			try {
				const pdfjs = await import('pdfjs-dist');
				const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
				pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
				loading = pdfjs.getDocument({ url, withCredentials: true });
				const loaded = await loading.promise;
				if (cancelled) return;
				doc = loaded;
				const list: { n: number; w: number; h: number }[] = [];
				for (let n = 1; n <= loaded.numPages; n++) {
					const vp = (await loaded.getPage(n)).getViewport({ scale: 1 });
					list.push({ n, w: vp.width, h: vp.height });
				}
				pages = list;
				status = 'fertig';
			} catch (err) {
				console.error('[pdf]', err);
				if (!cancelled) {
					status = 'fehler';
					onerror?.();
				}
			}
		})();

		return () => {
			cancelled = true;
			resize.disconnect();
			stopGestures();
			loading?.destroy();
			loading = null;
			doc = null;
		};
	});

	/** Das Element, das senkrecht scrollt – die Seite selbst oder z. B. ein Dialog */
	function scrollParent(el: HTMLElement): HTMLElement | null {
		for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
			const y = getComputedStyle(p).overflowY;
			if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p;
		}
		return null;
	}

	/** Übernimmt den neuen Zoom und schiebt so, dass der Inhaltspunkt (x, y) danach bei `to` liegt */
	async function settle(next: number, x: number, y: number, to: Point) {
		next = clampZoom(next);
		const s = next / zoom;
		zoom = next;
		await tick();
		if (!pagesBox) return;
		const r = pagesBox.getBoundingClientRect();
		container.scrollBy({ left: r.left + x * s - to.x, behavior: 'instant' });
		(scrollParent(container) ?? window).scrollBy({ top: r.top + y * s - to.y, behavior: 'instant' });
	}

	/** Zoomt so, dass die Stelle unter `at` dort stehen bleibt */
	function zoomAround(next: number, at: Point) {
		if (!pagesBox) return;
		const r = pagesBox.getBoundingClientRect();
		settle(next, at.x - r.left, at.y - r.top, at);
	}

	/** Mitte des sichtbaren Teils – Fixpunkt für die Knöpfe */
	function visibleCenter(): Point {
		const r = container.getBoundingClientRect();
		const view = scrollParent(container)?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
		return { x: r.left + r.width / 2, y: (Math.max(r.top, view.top) + Math.min(r.bottom, view.bottom)) / 2 };
	}

	function step(dir: 1 | -1) {
		const next = dir > 0 ? ZOOMS.find((z) => z > zoom + 0.01) : [...ZOOMS].reverse().find((z) => z < zoom - 0.01);
		if (next) zoomAround(next, visibleCenter());
	}

	/**
	 * Zwei Finger zoomen das PDF statt der Seite: während der Geste nur per CSS
	 * vergrößert, beim Loslassen in echter Größe neu gezeichnet. Ein Finger
	 * scrollt wie gewohnt. Svelte meldet Touch-Ereignisse passiv an – hier muss
	 * aber `preventDefault` greifen, deshalb von Hand.
	 */
	function gestures(el: HTMLElement) {
		let pinch: { d0: number; z0: number; from: Point; at: Point; x: number; y: number; s: number } | null = null;
		/** Ein Finger, der (noch) nicht gewischt hat – Kandidat fürs doppelte Tippen */
		let press: Point | null = null;
		let lastTap: (Point & { t: number }) | null = null;

		const two = (e: TouchEvent) => {
			const [a, b] = [e.touches[0], e.touches[1]];
			return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
		};

		function start(e: TouchEvent) {
			if (e.touches.length === 1) {
				press = { x: e.touches[0].clientX, y: e.touches[0].clientY };
				return;
			}
			press = null;
			if (e.touches.length !== 2 || pinch || !pagesBox) return;
			const m = two(e);
			const r = pagesBox.getBoundingClientRect();
			pinch = { d0: Math.max(m.d, 1), z0: zoom, from: m, at: m, x: m.x - r.left, y: m.y - r.top, s: 1 };
			pagesBox.style.transformOrigin = `${pinch.x}px ${pinch.y}px`;
			pagesBox.style.willChange = 'transform';
		}

		function move(e: TouchEvent) {
			if (press && Math.hypot(e.touches[0].clientX - press.x, e.touches[0].clientY - press.y) > 10) press = null;
			if (!pinch || e.touches.length !== 2 || !pagesBox) return;
			if (e.cancelable) e.preventDefault();
			const m = two(e);
			pinch.s = clampZoom((pinch.z0 * m.d) / pinch.d0) / pinch.z0;
			pinch.at = m;
			pagesBox.style.transform = `translate(${m.x - pinch.from.x}px, ${m.y - pinch.from.y}px) scale(${pinch.s})`;
		}

		function end(e: TouchEvent) {
			if (pinch && e.touches.length < 2) {
				const g = pinch;
				pinch = null;
				if (!pagesBox) return;
				pagesBox.style.transform = '';
				pagesBox.style.transformOrigin = '';
				pagesBox.style.willChange = '';
				// Erst jetzt messen – falls der Browser während der Geste doch gescrollt hat
				const r = pagesBox.getBoundingClientRect();
				settle(g.z0 * g.s, g.x, g.y, { x: r.left + g.x + g.at.x - g.from.x, y: r.top + g.y + g.at.y - g.from.y });
				return;
			}
			if (e.touches.length > 0 || !press) return;
			press = null;
			const t = e.changedTouches[0];
			const here = { x: t.clientX, y: t.clientY };
			if (lastTap && e.timeStamp - lastTap.t < 300 && Math.hypot(here.x - lastTap.x, here.y - lastTap.y) < 30) {
				e.preventDefault();
				lastTap = null;
				zoomAround(zoom > 1.01 ? 1 : 2, here);
			} else {
				lastTap = { ...here, t: e.timeStamp };
			}
		}

		// Safari am iPhone/iPad zoomt sonst trotzdem die ganze Seite
		const noPageZoom = (e: Event) => e.preventDefault();
		el.addEventListener('touchstart', start, { passive: true });
		el.addEventListener('touchmove', move, { passive: false });
		el.addEventListener('touchend', end, { passive: false });
		el.addEventListener('touchcancel', end);
		el.addEventListener('gesturestart', noPageZoom);
		return () => {
			el.removeEventListener('touchstart', start);
			el.removeEventListener('touchmove', move);
			el.removeEventListener('touchend', end);
			el.removeEventListener('touchcancel', end);
			el.removeEventListener('gesturestart', noPageZoom);
		};
	}

	/** Zeichnet eine Seite, sobald sie sichtbar wird, und bei Größenänderung neu */
	function pageCanvas(canvas: HTMLCanvasElement, params: { n: number; scale: number }) {
		let current = params;
		let drawn = 0;
		let visible = false;
		let task: RenderTask | null = null;
		/** Zählt Zeichenaufträge – nur der neueste darf die Zeichenfläche benutzen */
		let generation = 0;

		async function draw() {
			if (!doc || !visible || drawn === current.scale) return;
			const mine = ++generation;
			const wanted = current.scale;
			task?.cancel();
			const page = await doc.getPage(current.n);
			if (mine !== generation) return;
			// Schärfer auf hochauflösenden Bildschirmen, aber nicht grenzenlos (Speicher)
			const base = page.getViewport({ scale: wanted });
			const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
			const viewport = page.getViewport({ scale: wanted * ratio });
			// Erst daneben zeichnen, dann umkopieren – so bleibt beim Zoomen das alte Bild stehen statt weiß zu blitzen
			const off = document.createElement('canvas');
			off.width = Math.floor(viewport.width);
			off.height = Math.floor(viewport.height);
			const mineTask = page.render({ canvas: off, viewport });
			task = mineTask;
			try {
				await mineTask.promise;
				if (mine !== generation) return;
				canvas.width = off.width;
				canvas.height = off.height;
				canvas.getContext('2d')?.drawImage(off, 0, 0);
				drawn = wanted;
			} catch {
				/* abgebrochen, weil neu gezeichnet wird */
			} finally {
				off.width = off.height = 0;
				if (task === mineTask) task = null;
			}
		}

		/** Weit weg vom Bildschirm Speicher freigeben – kommt die Seite zurück, wird neu gezeichnet */
		function release() {
			generation++;
			task?.cancel();
			if (drawn) {
				canvas.width = canvas.height = 0;
				drawn = 0;
			}
		}

		const observer = new IntersectionObserver(
			([entry]) => {
				visible = entry.isIntersecting;
				if (visible) draw();
				else release();
			},
			// Im Dialog scrollt dessen Inhalt, nicht die Seite – sonst greift der Vorlauf nicht
			{ root: scrollParent(container), rootMargin: '800px 0px' }
		);
		observer.observe(canvas);

		return {
			update(next: { n: number; scale: number }) {
				current = next;
				draw();
			},
			destroy() {
				observer.disconnect();
				task?.cancel();
			}
		};
	}
</script>

<div class="flex items-center justify-end gap-1 pb-2">
	<button class="btn btn-ghost btn-sm btn-icon" aria-label="Verkleinern" disabled={zoom <= 1.01 || status !== 'fertig'} onclick={() => step(-1)}>
		<ZoomOut size={18} />
	</button>
	<span class="num w-12 text-center text-sm text-ink-3" aria-live="polite">{Math.round(zoom * 100)} %</span>
	<button class="btn btn-ghost btn-sm btn-icon" aria-label="Vergrößern" disabled={zoom >= MAX_ZOOM - 0.01 || status !== 'fertig'} onclick={() => step(1)}>
		<ZoomIn size={18} />
	</button>
	<button class="btn btn-ghost btn-sm" disabled={zoom <= 1.01} onclick={() => zoomAround(1, visibleCenter())}>
		<MoveHorizontal size={16} aria-hidden="true" />Breite
	</button>
</div>

<div
	bind:this={container}
	class="touch-pan-x touch-pan-y overflow-x-auto rounded-xl bg-surface-3 p-px"
	role="document"
	aria-label={title}
	aria-busy={status === 'laden'}
>
	{#if status === 'laden'}
		<div class="grid h-64 place-items-center text-ink-3">
			<span class="flex items-center gap-2"><span class="size-4 animate-spin rounded-full border-2 border-line-strong border-t-ink"></span>PDF wird geladen …</span>
		</div>
	{:else if status === 'fehler'}
		<div class="grid h-40 place-items-center px-4 text-center text-ink-2">Das PDF konnte nicht angezeigt werden.</div>
	{:else}
		<div bind:this={pagesBox} class="mx-auto flex w-max min-w-full flex-col items-center gap-2">
			{#each pages as p (p.n)}
				{@const scale = scaleFor(p.w)}
				<canvas
					use:pageCanvas={{ n: p.n, scale }}
					class="block bg-white shadow-sm"
					style:width="{Math.floor(p.w * scale)}px"
					style:height="{Math.floor(p.h * scale)}px"
					aria-label="Seite {p.n} von {pages.length}"
				></canvas>
			{/each}
		</div>
	{/if}
</div>
