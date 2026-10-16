<script lang="ts">
	/**
	 * Suchfeld, das schon beim Tippen sucht: kurz nach der letzten Eingabe geht
	 * das umgebende GET-Formular ab (siehe liveSubmit), Enter sofort. Was
	 * zurückkommt, überschreibt den Text nicht, solange man noch tippt – nur von
	 * außen (Zurücksetzen, Zurück im Browser) wird das Feld neu gefüllt.
	 */
	import SearchIcon from '@lucide/svelte/icons/search';
	import { liveSubmit } from '$lib/live-search';

	interface Props {
		value: string;
		name?: string;
		placeholder?: string;
		/** Für Screenreader, wenn kein sichtbares Label davor steht */
		label?: string;
		id?: string;
	}
	let { value, name = 'q', placeholder = '', label, id }: Props = $props();

	/** Wartezeit nach dem letzten Tastendruck */
	const DELAY = 300;

	let el = $state<HTMLInputElement>();
	let text = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const v = value;
		// Wer gerade im Feld tippt, behält seinen Text
		if (el && document.activeElement === el) return;
		text = v;
	});

	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(() => liveSubmit(el?.form), DELAY);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		clearTimeout(timer);
		liveSubmit(el?.form);
	}
</script>

<div class="relative">
	<SearchIcon size={17} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden="true" />
	<input bind:this={el} {id} class="input pl-9" type="search" {name} bind:value={text} {placeholder} aria-label={label} autocomplete="off" {oninput} {onkeydown} />
</div>
