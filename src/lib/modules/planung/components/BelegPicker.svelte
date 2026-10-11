<script lang="ts">
	/**
	 * Krankmeldung wählen: Foto aufnehmen oder Foto/PDF aus Galerie bzw. Dateien.
	 * Fotos werden am Gerät auf JPEG verkleinert (wie bei den Tagesberichten),
	 * PDFs gehen unverändert. Das Formular schickt `files` als „beleg" mit.
	 *
	 * In der Android-App kommt das Dateifeld nicht an die Kamera – dort öffnet
	 * sich die Kamera direkt in der Seite.
	 */
	import { onMount } from 'svelte';
	import Camera from '@lucide/svelte/icons/camera';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import FileText from '@lucide/svelte/icons/file-text';
	import ImageIcon from '@lucide/svelte/icons/image';
	import X from '@lucide/svelte/icons/x';
	import { inNativeApp } from '$lib/native';
	import { shrinkPhoto } from '$lib/modules/tagesberichte/photos';
	import PhotoCamera from '$lib/modules/tagesberichte/components/PhotoCamera.svelte';

	interface Props {
		files: File[];
		max?: number;
		disabled?: boolean;
	}
	let { files = $bindable([]), max = 10, disabled = false }: Props = $props();

	let touch = $state(false);
	let app = $state(false);
	let cameraOpen = $state(false);
	let working = $state(0);
	let problem = $state('');
	onMount(() => {
		touch = matchMedia('(pointer: coarse)').matches;
		app = inNativeApp();
	});

	const room = $derived(max - files.length - working);
	const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

	async function take(list: File[]) {
		problem = '';
		for (const f of list.slice(0, Math.max(0, room))) {
			if (isPdf(f)) {
				files = [...files, f];
				continue;
			}
			working++;
			try {
				const { photo } = await shrinkPhoto(f);
				const name = (f.name.replace(/\.[^.]+$/, '') || 'krankmeldung') + '.jpg';
				files = [...files, new File([photo], name, { type: 'image/jpeg' })];
			} catch (err) {
				problem = err instanceof Error ? err.message : 'Das Bild lässt sich nicht öffnen.';
			} finally {
				working--;
			}
		}
	}

	function pick(e: Event & { currentTarget: HTMLInputElement }) {
		const input = e.currentTarget;
		take([...(input.files ?? [])]);
		input.value = '';
	}
</script>

<div class="flex flex-wrap gap-2">
	{#if app}
		<button type="button" class="btn btn-secondary btn-sm" disabled={disabled || room <= 0} onclick={() => (cameraOpen = true)}>
			<Camera size={16} aria-hidden="true" />Foto aufnehmen
		</button>
	{:else if touch}
		<label class="btn btn-secondary btn-sm {disabled || room <= 0 ? 'pointer-events-none opacity-50' : ''}">
			<Camera size={16} aria-hidden="true" />Foto aufnehmen
			<input type="file" accept="image/*" capture="environment" class="sr-only" disabled={disabled || room <= 0} onchange={pick} />
		</label>
	{/if}
	<label class="btn btn-secondary btn-sm {disabled || room <= 0 ? 'pointer-events-none opacity-50' : ''}">
		<Paperclip size={16} aria-hidden="true" />{touch ? 'Foto oder PDF wählen' : 'Foto oder PDF hochladen'}
		<input type="file" accept="image/*,application/pdf,.pdf" multiple class="sr-only" disabled={disabled || room <= 0} onchange={pick} />
	</label>
</div>
{#if files.length || working}
	<ul class="mt-2 space-y-1">
		{#each files as f, i (i)}
			<li class="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm">
				{#if isPdf(f)}<FileText size={16} class="shrink-0 text-ink-3" aria-hidden="true" />{:else}<ImageIcon size={16} class="shrink-0 text-ink-3" aria-hidden="true" />{/if}
				<span class="min-w-0 flex-1 truncate">{f.name}</span>
				<span class="num text-[0.75rem] text-ink-3">{Math.max(1, Math.round(f.size / 1024))} KB</span>
				<button type="button" class="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-danger" aria-label="{f.name} entfernen" onclick={() => (files = files.filter((_, n) => n !== i))}>
					<X size={14} />
				</button>
			</li>
		{/each}
		{#if working}<li class="px-2.5 py-1.5 text-sm text-ink-3">Foto wird verkleinert …</li>{/if}
	</ul>
{/if}
{#if problem}<p class="mt-1 text-sm text-danger" role="alert">{problem}</p>{/if}

{#if cameraOpen}<PhotoCamera onphoto={(f) => take([f])} onclose={() => (cameraOpen = false)} />{/if}
