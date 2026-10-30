<script lang="ts">
	import { onMount } from 'svelte';
	import { lockScroll } from '$lib/scroll-lock';
	import { fade, fly } from 'svelte/transition';
	import X from '@lucide/svelte/icons/x';
	import Flashlight from '@lucide/svelte/icons/flashlight';
	import FlashlightOff from '@lucide/svelte/icons/flashlight-off';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { getDetector, openCamera, setTorch, torchSupported, type Detector } from '$lib/modules/lager/scan/camera';
	import { feedbackError, unlockAudio } from '$lib/modules/lager/scan/feedback';
	import { scanner } from '$lib/modules/lager/scan/scanner.svelte';

	let video: HTMLVideoElement;
	let stream: MediaStream | null = null;
	let detector: Detector | null = null;
	let running = true;
	let status = $state<'starting' | 'ready' | 'error'>('starting');
	let errorMessage = $state('');
	let hasTorch = $state(false);
	let torchOn = $state(false);
	let manual = $state(false);
	let manualValue = $state('');
	let hit = $state(false);

	const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
	const ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;

	let lastValue = '';
	let lastSeen = 0;

	function stop() {
		running = false;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	/** Nur den Bereich im Sucher auswerten – schneller und weniger Fehltreffer */
	function frameSource(): CanvasImageSource {
		const vw = video.videoWidth;
		const vh = video.videoHeight;
		if (!canvas || !ctx || !vw || !vh) return video;
		const side = Math.round(Math.min(vw, vh) * 0.85);
		const sx = Math.round((vw - side) / 2);
		const sy = Math.round((vh - side) / 2);
		const out = Math.min(side, 1024);
		canvas.width = out;
		canvas.height = out;
		ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
		return canvas;
	}

	async function loop() {
		while (running) {
			if (detector && video && video.readyState >= 2 && !document.hidden) {
				try {
					const results = await detector.detect(frameSource());
					const value = results[0]?.rawValue?.trim();
					const now = performance.now();
					if (value) {
						// Derselbe Code bleibt im Bild → nicht mehrfach zählen
						if (value === lastValue && now - lastSeen < 1600) {
							lastSeen = now;
						} else {
							lastValue = value;
							lastSeen = now;
							hit = true;
							setTimeout(() => (hit = false), 450);
							scanner.detected(value);
						}
					}
				} catch {
					/* einzelne Frames dürfen scheitern */
				}
			}
			await new Promise((r) => setTimeout(r, 110));
		}
	}

	$effect(() => lockScroll());

	onMount(() => {
		unlockAudio();
		(async () => {
			try {
				const [s, d] = await Promise.all([openCamera(), getDetector()]);
				if (!running) {
					s.getTracks().forEach((t) => t.stop());
					return;
				}
				stream = s;
				detector = d;
				video.srcObject = s;
				await video.play().catch(() => {});
				hasTorch = torchSupported(s);
				status = 'ready';
				loop();
			} catch (err) {
				status = 'error';
				errorMessage = (err as Error).message || 'Kamera konnte nicht gestartet werden.';
				manual = true;
				feedbackError();
			}
		})();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') scanner.close();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			stop();
		};
	});

	async function toggleTorch() {
		if (!stream) return;
		torchOn = !torchOn;
		try {
			await setTorch(stream, torchOn);
		} catch {
			torchOn = false;
			hasTorch = false;
		}
	}

	function submitManual(e: SubmitEvent) {
		e.preventDefault();
		const v = manualValue.trim();
		if (!v) return;
		manualValue = '';
		scanner.detected(v);
	}
</script>

<div
	class="fixed inset-0 z-[70] flex flex-col bg-black text-white"
	role="dialog"
	aria-modal="true"
	aria-label={scanner.title}
	transition:fade={{ duration: 180 }}
>
	<header class="relative z-10 flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
		<div class="min-w-0 flex-1">
			<h2 class="font-display text-lg font-semibold">{scanner.title}</h2>
			<p class="text-sm text-white/70">
				{#if scanner.mode === 'continuous'}
					{scanner.count === 0 ? 'Codes nacheinander ins Bild halten' : `${scanner.count} erfasst – weiter scannen oder fertig`}
				{:else}
					Barcode oder DataMatrix ins Feld halten
				{/if}
			</p>
		</div>
		{#if hasTorch}
			<button
				class="grid size-11 place-items-center rounded-full bg-white/12 backdrop-blur hover:bg-white/20"
				aria-label={torchOn ? 'Licht aus' : 'Licht an'}
				aria-pressed={torchOn}
				onclick={toggleTorch}
			>
				{#if torchOn}<FlashlightOff size={20} />{:else}<Flashlight size={20} />{/if}
			</button>
		{/if}
		<button
			class="grid size-11 place-items-center rounded-full bg-white/12 backdrop-blur hover:bg-white/20"
			aria-label="Scanner schließen"
			onclick={() => scanner.close()}
		>
			<X size={22} />
		</button>
	</header>

	<div class="relative flex-1 overflow-hidden">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={video} class="absolute inset-0 size-full object-cover" playsinline muted autoplay></video>

		{#if status === 'ready'}
			<!-- Sucher: abgedunkelter Rand, Ecken in Markierungsgelb -->
			<div class="pointer-events-none absolute inset-0 grid place-items-center">
				<div
					class="viewfinder relative aspect-square w-[min(72vw,56vh,380px)] rounded-[28px]"
					class:hit
					style="box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.5)"
				>
					<span class="corner left-0 top-0 border-l-4 border-t-4 rounded-tl-[28px]"></span>
					<span class="corner right-0 top-0 border-r-4 border-t-4 rounded-tr-[28px]"></span>
					<span class="corner left-0 bottom-0 border-l-4 border-b-4 rounded-bl-[28px]"></span>
					<span class="corner right-0 bottom-0 border-r-4 border-b-4 rounded-br-[28px]"></span>
					<span class="sweep absolute inset-x-6 h-1 rounded-full lane"></span>
				</div>
			</div>
		{:else if status === 'starting'}
			<div class="absolute inset-0 grid place-items-center text-white/70">Kamera wird gestartet …</div>
		{:else}
			<div class="absolute inset-0 grid place-items-center px-8 text-center">
				<div>
					<CameraOff size={40} class="mx-auto mb-3 text-white/60" />
					<p class="font-medium">{errorMessage}</p>
					<p class="mt-1 text-sm text-white/60">Du kannst den Code unten auch eintippen.</p>
				</div>
			</div>
		{/if}

		{#if scanner.flash}
			{#key scanner.flash.id}
				<div
					class="absolute inset-x-4 bottom-4 mx-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-ink shadow-lg {scanner.flash.ok
						? 'bg-surface'
						: 'bg-danger-soft'}"
					in:fly={{ y: 20, duration: 240 }}
					style="background-color: {scanner.flash.ok ? 'var(--c-surface)' : 'var(--c-danger-soft)'}"
				>
					{#if scanner.flash.ok}
						<CircleCheck size={22} class="shrink-0 text-ok" />
					{:else}
						<CircleAlert size={22} class="shrink-0 text-danger" />
					{/if}
					<span class="line-clamp-2 font-medium">{scanner.flash.label}</span>
				</div>
			{/key}
		{/if}
	</div>

	<footer class="relative z-10 space-y-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
		{#if manual}
			<form class="flex gap-2" onsubmit={submitManual}>
				<label class="sr-only" for="manual-code">Code eingeben</label>
				<input
					id="manual-code"
					class="input flex-1 border-white/20 bg-white/10 text-white placeholder:text-white/50"
					placeholder="EAN, Artikelnummer …"
					autocomplete="off"
					inputmode="text"
					bind:value={manualValue}
				/>
				<button class="btn btn-primary" type="submit">Suchen</button>
			</form>
		{/if}
		<div class="flex gap-2">
			{#if !manual}
				<button class="btn flex-1 bg-white/12 text-white hover:bg-white/20" onclick={() => (manual = true)}>
					<Keyboard size={18} /> Code eintippen
				</button>
			{/if}
			{#if scanner.mode === 'continuous'}
				<button class="btn btn-primary flex-1" onclick={() => scanner.close()}>Fertig</button>
			{/if}
		</div>
	</footer>
</div>

<style>
	.corner {
		position: absolute;
		width: 44px;
		height: 44px;
		border-color: var(--c-brand);
		transition: border-color 160ms var(--ease-out);
	}
	.viewfinder.hit .corner {
		border-color: #4cc58f;
	}
	.viewfinder {
		transition: transform 300ms var(--ease-spring);
	}
	.viewfinder.hit {
		transform: scale(1.03);
	}
	.sweep {
		top: 50%;
		opacity: 0.9;
		animation:
			var(--animate-lane),
			sweep 2.4s var(--ease-out) infinite alternate;
	}
	@keyframes sweep {
		from {
			transform: translateY(-120px);
		}
		to {
			transform: translateY(120px);
		}
	}
</style>
