<script lang="ts" module>
	/** Höhe einer Zeile im Rad, sichtbare Zeilen */
	const ITEM = 40;
	const ROWS = 5;
	/** Minuten im Rad – krumme Minuten lassen sich weiter tippen */
	const STEP = 10;
	const HOURS = Array.from({ length: 24 }, (_, i) => i);
	const MINUTES = Array.from({ length: 60 / STEP }, (_, i) => i * STEP);
	const two = (n: number) => String(n).padStart(2, '0');

	type WheelParams = { index: number; count: number; onpick: (i: number) => void };

	/**
	 * Ein Rad: Scrollen (Finger, Mausrad, Trackpad) wählt die Zeile in der Mitte.
	 * Ändert sich der Wert von außen (Tippen im Feld), dreht das Rad hin, ohne
	 * unterwegs Zwischenwerte zu melden.
	 */
	function wheel(node: HTMLElement, params: WheelParams) {
		let p = params;
		let current = p.index;
		/** Ziel einer Drehung von außen – bis dahin zählt Scrollen nicht */
		let target: number | null = null;
		let acc = 0;

		const go = (i: number, smooth: boolean) => {
			target = i;
			node.scrollTo({ top: i * ITEM, behavior: smooth ? 'smooth' : 'instant' });
		};
		// Erst nach dem Öffnen des Popups steht das Rad im Layout
		queueMicrotask(() => go(current, false));

		const onScroll = () => {
			const i = Math.max(0, Math.min(p.count - 1, Math.round(node.scrollTop / ITEM)));
			if (target != null) {
				if (i === target) target = null;
				return;
			}
			if (i !== current) {
				current = i;
				p.onpick(i);
			}
		};
		/** Wer selbst dreht, übernimmt */
		const takeOver = () => (target = null);
		/** Mausrad: eine Raste, eine Zeile; Trackpads sammeln erst */
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const dy = e.deltaMode === 1 ? e.deltaY * ITEM : e.deltaY;
			let step = 0;
			if (Math.abs(dy) >= 50) step = Math.sign(dy);
			else {
				acc += dy;
				if (Math.abs(acc) >= ITEM) {
					step = Math.sign(acc);
					acc = 0;
				}
			}
			if (!step) return;
			const i = Math.max(0, Math.min(p.count - 1, (target ?? current) + step));
			if (i === current && target == null) return;
			current = i;
			p.onpick(i);
			go(i, true);
		};

		node.addEventListener('scroll', onScroll, { passive: true });
		node.addEventListener('wheel', onWheel, { passive: false });
		node.addEventListener('pointerdown', takeOver);
		node.addEventListener('touchstart', takeOver, { passive: true });
		return {
			update(next: WheelParams) {
				p = next;
				if (next.index !== current) {
					current = next.index;
					go(next.index, true);
				}
			},
			destroy() {
				node.removeEventListener('scroll', onScroll);
				node.removeEventListener('wheel', onWheel);
				node.removeEventListener('pointerdown', takeOver);
				node.removeEventListener('touchstart', takeOver);
			}
		};
	}
</script>

<script lang="ts">
	import { parseTime } from '$lib/modules/stunden/week';

	interface Props {
		value: string;
		name: string;
		/** Überschrift im Popup, zugleich die Beschriftung des Felds */
		label: string;
		placeholder?: string;
		/** Was das Rad bei leerem Feld zeigt, z. B. das Ende des Zeitraums davor */
		suggestion?: string;
		class?: string;
		onchange: (value: string) => void;
	}
	let { value, name, label, placeholder = '', suggestion = '', class: cls = '', onchange }: Props = $props();

	let input: HTMLInputElement;
	let pop: HTMLDivElement | undefined = $state();
	let open = $state(false);
	let hour = $state(7);
	let minuteIdx = $state(0);
	/** Am Handy: Leiste von unten, ohne Tastatur */
	let sheet = $state(false);
	let coarse = $state(false);
	let skipFocus = false;

	$effect(() => {
		coarse = matchMedia('(pointer: coarse)').matches;
	});

	function fromText(text: string): boolean {
		const t = parseTime(text);
		if (!t) return false;
		const [h, m] = t.split(':').map(Number);
		hour = h;
		minuteIdx = Math.min(MINUTES.length - 1, Math.round(m / STEP));
		return true;
	}

	const wheelValue = () => `${two(hour)}:${two(MINUTES[minuteIdx])}`;

	function show() {
		if (open || skipFocus || input.disabled || input.readOnly) return;
		if (!fromText(value) && !fromText(suggestion) && !fromText(placeholder)) fromText('07:00');
		sheet = matchMedia('(max-width: 639px)').matches;
		open = true;
	}

	function close(refocus = false) {
		open = false;
		if (refocus) {
			skipFocus = true;
			input.focus({ preventScroll: true });
			skipFocus = false;
		}
	}

	const pickHour = (i: number) => {
		hour = HOURS[i];
		onchange(wheelValue());
	};
	const pickMinute = (i: number) => {
		minuteIdx = i;
		onchange(wheelValue());
	};

	/** Fertig: ein leeres Feld bekommt, was das Rad zeigt; Getipptes bleibt */
	function done() {
		if (!parseTime(value)) onchange(wheelValue());
		close(true);
	}

	function clear() {
		onchange('');
		close(true);
	}

	function place() {
		if (!pop) return;
		if (sheet) {
			// Das Feld bleibt über der Leiste sichtbar
			const hidden = input.getBoundingClientRect().bottom + 12 - (innerHeight - pop.offsetHeight);
			if (hidden > 0) scrollBy({ top: hidden, behavior: 'smooth' });
			return;
		}
		const r = input.getBoundingClientRect();
		const w = pop.offsetWidth;
		const h = pop.offsetHeight;
		const below = r.bottom + 6 + h <= innerHeight - 8;
		pop.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - 6 - h)}px`;
		pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
	}

	/** Im Top-Layer, damit keine Tabelle mit overflow es abschneidet */
	function popover(node: HTMLDivElement) {
		node.showPopover();
		place();
	}

	$effect(() => {
		if (!open) return;
		const outside = (e: PointerEvent) => {
			const t = e.target as Node;
			if (t !== input && !pop?.contains(t)) close();
		};
		const reflow = (e: Event) => {
			if (!sheet && !pop?.contains(e.target as Node)) place();
		};
		document.addEventListener('pointerdown', outside, true);
		window.addEventListener('scroll', reflow, true);
		window.addEventListener('resize', reflow);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			window.removeEventListener('scroll', reflow, true);
			window.removeEventListener('resize', reflow);
		};
	});

	// Am Handy liegt die Leiste über der Seite: Die Seite bleibt stehen, nur die Räder drehen
	$effect(() => {
		if (!open || !sheet) return;
		const hold = (e: Event) => {
			if (e.cancelable && !(e.target as Element).closest?.('.timewheel-wheel')) e.preventDefault();
		};
		document.addEventListener('touchmove', hold, { passive: false });
		document.addEventListener('wheel', hold, { passive: false });
		return () => {
			document.removeEventListener('touchmove', hold);
			document.removeEventListener('wheel', hold);
		};
	});

	function onkeydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === 'ArrowDown' && e.altKey) show();
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		} else if (e.key === 'Tab' || e.key === 'Enter') {
			close();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			// Pfeiltasten: zehn Minuten weiter, mit Umschalt eine Stunde
			e.preventDefault();
			const dir = e.key === 'ArrowUp' ? 1 : -1;
			const total = (hour * 60 + MINUTES[minuteIdx] + dir * (e.shiftKey ? 60 : STEP) + 1440) % 1440;
			hour = Math.floor(total / 60);
			minuteIdx = Math.round((total % 60) / STEP);
			onchange(wheelValue());
		}
	}

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		onchange(e.currentTarget.value);
		if (open) fromText(e.currentTarget.value);
	}
</script>

<input
	bind:this={input}
	class={cls}
	{name}
	inputmode={coarse ? 'none' : 'numeric'}
	autocomplete="off"
	{placeholder}
	{value}
	aria-label={label}
	aria-haspopup="dialog"
	aria-expanded={open}
	onfocus={show}
	onclick={show}
	{oninput}
	{onkeydown}
/>

{#if open}
	<div bind:this={pop} use:popover popover="manual" class="timewheel" class:timewheel-sheet={sheet} role="dialog" aria-label="{label} wählen">
		<p class="mb-2 text-center text-sm font-medium text-ink-2">{label}</p>
		<div class="relative flex items-center justify-center gap-1" style:height="{ROWS * ITEM}px">
			<div class="timewheel-band" style:top="{((ROWS - 1) / 2) * ITEM}px" style:height="{ITEM}px" aria-hidden="true"></div>
			<div
				class="timewheel-wheel"
				use:wheel={{ index: hour, count: HOURS.length, onpick: pickHour }}
				role="listbox"
				aria-label="Stunde"
			>
				<div style:height="{((ROWS - 1) / 2) * ITEM}px"></div>
				{#each HOURS as h, i (h)}
					<button
						type="button"
						tabindex="-1"
						class="timewheel-item num"
						class:selected={i === hour}
						style:height="{ITEM}px"
						role="option"
						aria-selected={i === hour}
						onclick={() => pickHour(i)}>{two(h)}</button
					>
				{/each}
				<div style:height="{((ROWS - 1) / 2) * ITEM}px"></div>
			</div>
			<span class="relative text-xl font-semibold text-ink" aria-hidden="true">:</span>
			<div
				class="timewheel-wheel"
				use:wheel={{ index: minuteIdx, count: MINUTES.length, onpick: pickMinute }}
				role="listbox"
				aria-label="Minute"
			>
				<div style:height="{((ROWS - 1) / 2) * ITEM}px"></div>
				{#each MINUTES as m, i (m)}
					<button
						type="button"
						tabindex="-1"
						class="timewheel-item num"
						class:selected={i === minuteIdx}
						style:height="{ITEM}px"
						role="option"
						aria-selected={i === minuteIdx}
						onclick={() => pickMinute(i)}>{two(m)}</button
					>
				{/each}
				<div style:height="{((ROWS - 1) / 2) * ITEM}px"></div>
			</div>
		</div>
		<div class="mt-3 flex items-center justify-between gap-2">
			<button type="button" class="btn btn-ghost btn-sm" onclick={clear}>Leeren</button>
			<button type="button" class="btn btn-primary btn-sm" onclick={done}>Fertig</button>
		</div>
	</div>
{/if}

<style>
	.timewheel {
		position: fixed;
		inset: auto;
		margin: 0;
		width: 13.5rem;
		padding: 0.75rem;
		border: 1px solid var(--c-line);
		border-radius: 18px;
		background: var(--c-surface);
		color: var(--c-ink);
		box-shadow: var(--shadow-3);
	}
	.timewheel-sheet {
		top: auto !important;
		left: 0 !important;
		right: 0;
		bottom: 0;
		width: 100%;
		max-width: none;
		padding: 1rem 1.25rem calc(1rem + env(safe-area-inset-bottom));
		border-width: 1px 0 0;
		border-radius: 20px 20px 0 0;
	}
	.timewheel-sheet::backdrop {
		background: var(--c-scrim);
	}
	.timewheel-band {
		position: absolute;
		left: 0;
		right: 0;
		border-radius: 12px;
		background: var(--c-surface-2);
		border: 1px solid var(--c-line);
	}
	.timewheel-wheel {
		position: relative;
		height: 100%;
		width: 4.25rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		scroll-snap-type: y mandatory;
		scrollbar-width: none;
		-webkit-mask-image: linear-gradient(transparent, #000 32%, #000 68%, transparent);
		mask-image: linear-gradient(transparent, #000 32%, #000 68%, transparent);
	}
	.timewheel-wheel::-webkit-scrollbar {
		display: none;
	}
	.timewheel-item {
		display: grid;
		width: 100%;
		place-items: center;
		scroll-snap-align: center;
		font-size: 1.125rem;
		color: var(--c-ink-3);
		transition:
			color 120ms,
			font-size 120ms;
	}
	.timewheel-item.selected {
		font-size: 1.375rem;
		font-weight: 600;
		color: var(--c-ink);
	}
</style>
