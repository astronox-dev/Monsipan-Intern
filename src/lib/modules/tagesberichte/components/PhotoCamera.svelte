<script lang="ts">
	/**
	 * Kamera direkt in der Seite – für die Android-App: Dort öffnet ein
	 * Dateifeld mit „capture" nicht die Kamera, sondern nur die Dateiauswahl.
	 * Sie bleibt offen, damit man mehrere Fotos hintereinander machen kann;
	 * jedes Foto geht gleich weiter zum Hochladen.
	 */
	import { onMount } from 'svelte';
	import { lockScroll } from '$lib/scroll-lock';
	import X from '@lucide/svelte/icons/x';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import Flashlight from '@lucide/svelte/icons/flashlight';
	import FlashlightOff from '@lucide/svelte/icons/flashlight-off';
	import { openCamera, setTorch, torchSupported } from '$lib/modules/lager/scan/camera';

	interface Props {
		onphoto: (file: File) => void;
		onclose: () => void;
	}
	let { onphoto, onclose }: Props = $props();

	let dialog: HTMLDialogElement;
	let video: HTMLVideoElement;
	let stream: MediaStream | null = null;
	let alive = true;
	let status = $state<'starting' | 'ready' | 'error'>('starting');
	let errorMessage = $state('');
	let hasTorch = $state(false);
	let torchOn = $state(false);
	let taken = $state(0);
	let flash = $state(false);
	let busy = $state(false);

	$effect(() => lockScroll());

	onMount(() => {
		// Als Dialog in der obersten Ebene – sonst lägen Kopf- und Fußleiste der App darüber
		dialog.showModal();
		(async () => {
			try {
				const s = await openCamera({ width: 3840, height: 2160 });
				if (!alive) {
					s.getTracks().forEach((t) => t.stop());
					return;
				}
				stream = s;
				video.srcObject = s;
				await video.play().catch(() => {});
				hasTorch = torchSupported(s);
				status = 'ready';
			} catch (err) {
				status = 'error';
				errorMessage = (err as Error).message || 'Die Kamera konnte nicht gestartet werden.';
			}
		})();
		return () => {
			alive = false;
			stream?.getTracks().forEach((t) => t.stop());
			stream = null;
		};
	});

	/** Volle Auflösung über ImageCapture, wo es das gibt (Chrome, Android-WebView) */
	async function fullPhoto(s: MediaStream): Promise<Blob | null> {
		const Capture = (window as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
		const track = s.getVideoTracks()[0];
		if (!Capture || !track) return null;
		try {
			return await new Capture(track).takePhoto();
		} catch {
			return null;
		}
	}

	/** Sonst das aktuelle Bild aus dem Video */
	function frame(): Promise<Blob | null> {
		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		canvas.getContext('2d')?.drawImage(video, 0, 0);
		return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
	}

	async function shoot() {
		if (!stream || busy) return;
		busy = true;
		flash = true;
		setTimeout(() => (flash = false), 160);
		try {
			const blob = (await fullPhoto(stream)) ?? (await frame());
			if (!blob?.size) throw new Error();
			taken++;
			onphoto(new File([blob], `foto-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' }));
		} catch {
			errorMessage = 'Das Foto ging nicht – bitte noch einmal auslösen.';
			setTimeout(() => (errorMessage = ''), 3000);
		} finally {
			busy = false;
		}
	}

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
</script>

<dialog
	bind:this={dialog}
	class="kamera"
	aria-label="Foto aufnehmen"
	oncancel={(e) => {
		e.preventDefault();
		onclose();
	}}
>
	<div class="flex h-full flex-col">
		<header class="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
			<p class="min-w-0 flex-1 truncate px-1 text-sm font-medium">
				{taken === 0 ? 'Foto aufnehmen' : taken === 1 ? '1 Foto aufgenommen – wird hochgeladen' : `${taken} Fotos aufgenommen – werden hochgeladen`}
			</p>
			{#if hasTorch}
				<button type="button" class="knopf" onclick={toggleTorch} aria-pressed={torchOn} aria-label={torchOn ? 'Licht aus' : 'Licht an'}>
					{#if torchOn}<FlashlightOff size={22} />{:else}<Flashlight size={22} />{/if}
				</button>
			{/if}
			<button type="button" class="knopf" onclick={onclose} aria-label="Kamera schließen"><X size={24} /></button>
		</header>

		<div class="relative min-h-0 flex-1">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={video} playsinline muted class="absolute inset-0 size-full object-contain"></video>
			{#if flash}<div class="absolute inset-0 bg-white/60"></div>{/if}
			{#if status === 'starting'}
				<p class="absolute inset-0 grid place-items-center text-sm text-white/80">Kamera wird gestartet …</p>
			{:else if status === 'error'}
				<div class="absolute inset-0 grid place-items-center p-6 text-center">
					<div>
						<CameraOff size={36} class="mx-auto mb-3 text-white/70" aria-hidden="true" />
						<p class="font-medium">{errorMessage}</p>
						<p class="mt-1 text-sm text-white/70">Fotos lassen sich auch über „Aus der Galerie“ hinzufügen.</p>
					</div>
				</div>
			{:else if errorMessage}
				<p class="absolute inset-x-4 top-4 rounded-xl bg-black/70 px-3 py-2 text-center text-sm" role="alert">{errorMessage}</p>
			{/if}
		</div>

		<footer class="relative flex items-center justify-center px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
			<button type="button" class="ausloeser" onclick={shoot} disabled={status !== 'ready' || busy} aria-label="Auslösen"></button>
			{#if taken}
				<button type="button" class="btn btn-primary absolute right-5" onclick={onclose}>Fertig</button>
			{/if}
		</footer>
	</div>
</dialog>

<style>
	.kamera {
		width: 100vw;
		max-width: none;
		height: 100dvh;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		background: #000;
		color: #fff;
	}
	.kamera::backdrop {
		background: #000;
	}
	.knopf {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border-radius: 999px;
	}
	.knopf:hover,
	.knopf[aria-pressed='true'] {
		background: rgb(255 255 255 / 0.15);
	}
	.ausloeser {
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 999px;
		background: #fff;
		box-shadow:
			0 0 0 4px #000,
			0 0 0 7px #fff;
		transition: transform 100ms;
	}
	.ausloeser:active:not(:disabled) {
		transform: scale(0.92);
	}
	.ausloeser:disabled {
		opacity: 0.4;
	}
</style>
