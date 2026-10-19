<script lang="ts">
	/**
	 * Fotos zu einem Datensatz (Tagesbericht, Anfrage, Angebot). Am Handy direkt
	 * mit der Kamera aufnehmen oder aus der Galerie wählen; vor dem Hochladen
	 * werden sie am Gerät verkleinert. Antippen öffnet das Foto groß, wischen
	 * blättert. Mit `printable` lassen sich alle Fotos (oder eines) als PDF
	 * laden und drucken – dafür braucht es `<base>/druck` und `<base>/pdf`.
	 *
	 * Hochgeladen wird per POST an `base`, ein Foto liegt unter `<base>/<id>`
	 * (mit ?vorschau klein, mit ?download zum Speichern; DELETE löscht).
	 */
	import { onMount, tick } from 'svelte';
	import Camera from '@lucide/svelte/icons/camera';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import Download from '@lucide/svelte/icons/download';
	import FileText from '@lucide/svelte/icons/file-text';
	import Printer from '@lucide/svelte/icons/printer';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Trash from '@lucide/svelte/icons/trash';
	import X from '@lucide/svelte/icons/x';
	import { dateTime } from '$lib/format';
	import { toast } from '$lib/stores/toast.svelte';
	import PdfButton from '$lib/components/PdfButton.svelte';
	import { inNativeApp } from '$lib/native';
	import { deliverPdf, fetchPdf, isIOS } from '$lib/pdf-download';
	import { MAX_PHOTOS, PhotoError, shrinkPhoto } from '$lib/modules/tagesberichte/photos';
	import PhotoCamera from '$lib/modules/tagesberichte/components/PhotoCamera.svelte';

	interface Photo {
		id: number;
		width: number;
		height: number;
		createdAt: Date | string;
		createdBy: string | null;
	}
	interface Props {
		/** Adresse der Fotos, z. B. /anfragen/12/fotos */
		base: string;
		photos: Photo[];
		/** Hinzufügen und Löschen */
		editable: boolean;
		title?: string;
		/** Zeile unter der Überschrift */
		hint?: string;
		/** Text, solange es keine Fotos gibt */
		empty?: string;
		/** Drucken und PDF – `<base>/druck` und `<base>/pdf` gibt es */
		printable?: boolean;
	}
	let { base, photos: initial, editable, title = 'Fotos', hint = '', empty = 'Noch keine Fotos.', printable = false }: Props = $props();

	// Die Liste gehört ab hier der Ansicht – neue Fotos kommen ohne Neuladen dazu
	// svelte-ignore state_referenced_locally
	let photos = $state<Photo[]>(initial);
	let pending = $state(0);
	/** Kamera-Knopf nur, wo es eine Kamera zum Aufnehmen gibt (Handy, Tablet) */
	let touch = $state(false);
	/**
	 * In der Android-App öffnet das Dateifeld mit „capture" nur die
	 * Dateiauswahl – dort kommt die Kamera direkt in der Seite.
	 */
	let app = $state(false);
	let cameraOpen = $state(false);
	onMount(() => {
		touch = matchMedia('(pointer: coarse)').matches;
		app = inNativeApp();
	});

	const src = (p: Photo, preview = false) => `${base}/${p.id}${preview ? '?vorschau' : ''}`;
	const room = $derived(MAX_PHOTOS - photos.length - pending);

	function upload(e: Event & { currentTarget: HTMLInputElement }) {
		const input = e.currentTarget;
		const files = [...(input.files ?? [])];
		input.value = '';
		if (files.length > room) toast.info(`Höchstens ${MAX_PHOTOS} Fotos.`);
		files.slice(0, Math.max(0, room)).forEach(enqueue);
	}

	/** Aus der Kamera in der Seite – jedes Foto gleich in die Warteschlange */
	function fromCamera(file: File) {
		if (room <= 0) {
			toast.info(`Höchstens ${MAX_PHOTOS} Fotos.`);
			cameraOpen = false;
			return;
		}
		enqueue(file);
	}

	// Nacheinander hochladen – mehrere große Bilder gleichzeitig bringen ältere Handys ins Schwitzen
	let queue: Promise<void> = Promise.resolve();
	function enqueue(file: File) {
		pending++;
		queue = queue.then(() => send(file));
	}
	async function send(file: File) {
		try {
			const { photo, thumb } = await shrinkPhoto(file);
			const body = new FormData();
			body.set('foto', photo, 'foto.jpg');
			body.set('vorschau', thumb, 'vorschau.jpg');
			const res = await fetch(base, { method: 'POST', body });
			if (!res.ok) throw new PhotoError((await res.json().catch(() => null))?.message ?? 'Das Foto konnte nicht gespeichert werden.');
			photos = [...photos, await res.json()];
		} catch (err) {
			toast.error(err instanceof PhotoError ? err.message : 'Das Foto konnte nicht hochgeladen werden – bitte noch einmal versuchen.');
		} finally {
			pending--;
		}
	}

	/**
	 * Einzelnes Foto speichern. Am Computer und im Android-Browser lädt der Link
	 * das JPG; am iPhone kommt das Teilen-Menü („Bild sichern"), die App
	 * speichert es als PDF – das kann ihr Speicher-Plugin (nur mit `printable`).
	 */
	async function download(e: MouseEvent, p: Photo) {
		if (!app && !isIOS()) return;
		e.preventDefault();
		try {
			if (app) {
				await deliverPdf(await fetchPdf(`${base}/pdf?foto=${p.id}`));
				toast.success('Foto als PDF gespeichert', 'Liegt im Ordner „Downloads“.');
				return;
			}
			const blob = await fetch(src(p)).then((r) => (r.ok ? r.blob() : Promise.reject(new Error())));
			const file = new File([blob], `foto-${p.id}.jpg`, { type: 'image/jpeg' });
			if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
			else window.open(src(p), '_blank');
		} catch (err) {
			if ((err as { name?: string })?.name !== 'AbortError') toast.error('Das Foto ließ sich nicht speichern.');
		}
	}

	/* ---------------------------------------------------------- Großansicht */

	let dialog = $state<HTMLDialogElement>();
	let current = $state<number | null>(null);
	let confirmDelete = $state(false);
	let deleting = $state(false);
	const shown = $derived(current === null ? null : photos[current]);

	async function show(i: number) {
		current = i;
		confirmDelete = false;
		await tick();
		if (dialog && !dialog.open) dialog.showModal();
		// Fokus auf „Schließen" statt aufs Löschen
		dialog?.querySelector<HTMLElement>('[data-schliessen]')?.focus();
	}
	function step(by: number) {
		if (current === null || !photos.length) return;
		current = (current + by + photos.length) % photos.length;
		confirmDelete = false;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') step(-1);
		else if (e.key === 'ArrowRight') step(1);
	}

	/** Wischen nach links oder rechts blättert */
	let swipeX: number | null = null;
	function swipeStart(e: PointerEvent) {
		if (e.pointerType !== 'mouse') swipeX = e.clientX;
	}
	function swipeEnd(e: PointerEvent) {
		if (swipeX === null) return;
		const dx = e.clientX - swipeX;
		swipeX = null;
		if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
	}

	async function remove() {
		if (!shown || deleting) return;
		deleting = true;
		try {
			const res = await fetch(src(shown), { method: 'DELETE' });
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? '');
			photos = photos.filter((p) => p.id !== shown.id);
			confirmDelete = false;
			toast.info('Foto gelöscht');
			if (!photos.length) dialog?.close();
			else current = Math.min(current ?? 0, photos.length - 1);
		} catch (err) {
			toast.error((err instanceof Error && err.message) || 'Das Foto konnte nicht gelöscht werden.');
		} finally {
			deleting = false;
		}
	}
</script>

<section class="card mt-4 p-4 lg:p-5">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="flex items-center gap-2 text-lg">
			<Camera size={18} aria-hidden="true" />{title}{#if photos.length}<span class="num text-sm font-normal text-ink-3">{photos.length}</span>{/if}
		</h2>
		<div class="flex flex-wrap gap-2">
			{#if photos.length && printable}
				<a href="{base}/druck" class="btn btn-secondary btn-sm"><Printer size={16} aria-hidden="true" />Drucken</a>
				<PdfButton href="{base}/pdf" class="btn btn-secondary btn-sm"><FileText size={16} aria-hidden="true" />PDF</PdfButton>
			{/if}
			{#if editable}
				{#if app}
					<button type="button" class="btn btn-secondary btn-sm" disabled={room <= 0} onclick={() => (cameraOpen = true)}>
						<Camera size={16} aria-hidden="true" />Foto aufnehmen
					</button>
				{:else if touch}
					<label class="upload btn btn-secondary btn-sm {room <= 0 ? 'pointer-events-none opacity-50' : ''}">
						<Camera size={16} aria-hidden="true" />Foto aufnehmen
						<input type="file" accept="image/*" capture="environment" class="sr-only" disabled={room <= 0} onchange={upload} />
					</label>
				{/if}
				<label class="upload btn btn-secondary btn-sm {room <= 0 ? 'pointer-events-none opacity-50' : ''}">
					<ImagePlus size={16} aria-hidden="true" />{touch ? 'Aus der Galerie' : 'Bilder hochladen'}
					<input type="file" accept="image/*" multiple class="sr-only" disabled={room <= 0} onchange={upload} />
				</label>
			{/if}
		</div>
	</div>
	{#if hint}<p class="field-hint">{hint}</p>{/if}

	{#if photos.length || pending}
		<ul class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
			{#each photos as p, i (p.id)}
				<li>
					<button type="button" class="block aspect-square w-full overflow-hidden rounded-xl bg-surface-2" onclick={() => show(i)} aria-label="Foto {i + 1} groß ansehen">
						<img src={src(p, true)} alt="" loading="lazy" decoding="async" class="size-full object-cover" />
					</button>
				</li>
			{/each}
			{#each { length: pending } as _, i (i)}
				<li class="grid aspect-square place-items-center rounded-xl bg-surface-2" aria-label="Foto wird hochgeladen">
					<span class="size-6 animate-spin rounded-full border-2 border-line-strong border-t-ink"></span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-3 text-sm text-ink-3">{editable ? empty : 'Keine Fotos.'}</p>
	{/if}
</section>

{#if cameraOpen}<PhotoCamera onphoto={fromCamera} onclose={() => (cameraOpen = false)} />{/if}

<dialog bind:this={dialog} class="foto" aria-label="Foto" onclose={() => (current = null)} onkeydown={onKey}>
	{#if shown && current !== null}
		<div class="flex h-full flex-col">
			<header class="flex items-center gap-2 p-2 text-white">
				<p class="min-w-0 flex-1 truncate px-2 text-sm">
					<span class="num font-medium">Foto {current + 1} von {photos.length}</span>
					<span class="text-white/70"> · {[shown.createdBy, dateTime(shown.createdAt)].filter(Boolean).join(', ')}</span>
				</p>
				{#if printable || !app}
					<a href="{src(shown)}?download" download class="knopf" onclick={(e) => download(e, shown)} aria-label="Foto herunterladen" title="Herunterladen"><Download size={20} /></a>
				{/if}
				{#if printable}
					<a href="{base}/druck?foto={shown.id}" class="knopf" aria-label="Foto drucken" title="Drucken"><Printer size={20} /></a>
				{/if}
				{#if editable}
					<button type="button" class="knopf" onclick={() => (confirmDelete = true)} aria-label="Foto löschen" title="Löschen"><Trash size={20} /></button>
				{/if}
				<button type="button" class="knopf" data-schliessen onclick={() => dialog?.close()} aria-label="Schließen"><X size={22} /></button>
			</header>

			<div class="relative min-h-0 flex-1" onpointerdown={swipeStart} onpointerup={swipeEnd} role="presentation">
				<img src={src(shown)} alt="Foto {current + 1}" class="absolute inset-0 size-full object-contain" />
				{#if photos.length > 1}
					<button type="button" class="knopf blaettern left-2" onclick={() => step(-1)} aria-label="Voriges Foto"><ChevronLeft size={26} /></button>
					<button type="button" class="knopf blaettern right-2" onclick={() => step(1)} aria-label="Nächstes Foto"><ChevronRight size={26} /></button>
				{/if}
			</div>

			{#if confirmDelete}
				<div class="flex flex-wrap items-center justify-end gap-2 bg-black/60 p-3 text-white">
					<p class="mr-auto text-sm">Dieses Foto löschen?</p>
					<button type="button" class="btn btn-ghost btn-sm text-white" onclick={() => (confirmDelete = false)}>Abbrechen</button>
					<button type="button" class="btn btn-primary btn-sm" disabled={deleting} onclick={remove}><Trash size={16} aria-hidden="true" />Löschen</button>
				</div>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	/* Der Knopf ist ein Label um das Dateifeld – den Fokus zeigt er selbst */
	.upload:has(input:focus-visible) {
		outline: 2px solid var(--c-focus);
		outline-offset: 2px;
	}
	.foto {
		width: 100vw;
		max-width: none;
		height: 100dvh;
		max-height: none;
		margin: 0;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
		border: 0;
		background: rgb(0 0 0 / 0.94);
	}
	.foto::backdrop {
		background: rgb(0 0 0 / 0.6);
	}
	.knopf {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border-radius: 999px;
		color: #fff;
	}
	.knopf:hover {
		background: rgb(255 255 255 / 0.12);
	}
	.blaettern {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		background: rgb(0 0 0 / 0.35);
	}
</style>
