/**
 * Ziehen und Ablegen mit Maus, Finger und Stift (Pointer Events) – ohne
 * HTML5-Drag-and-Drop, das am Handy nicht zuverlässig geht. Mit der Maus
 * beginnt das Ziehen nach ein paar Pixeln (ein Klick bleibt ein Klick), am
 * Handy nach kurzem Halten – Wischen scrollt also weiter.
 *
 *   use:draggable={{ kind: 'entry', data: entry }}             was sich ziehen lässt
 *   use:dropzone={{ accepts: ['entry'], onDrop: (item, at) => … }}  wohin
 *
 * Gezogen wird eine Kopie des Elements; die Ablagestelle unter dem Finger
 * bekommt die Klasse `dnd-over`, das Original `dnd-source`, der Body
 * `dnd-active`. Am Rand der Seite (und eines Elements mit `data-dnd-scroll`)
 * wird mitgescrollt.
 */
import type { Action } from 'svelte/action';

export interface DragItem<T = unknown> {
	kind: string;
	data: T;
}

export interface DraggableOptions {
	kind: string;
	data: unknown;
	disabled?: boolean;
}

export interface DropzoneOptions {
	accepts: string[];
	/** `target`: das Element unter dem Finger – etwa um „vor diesem Eintrag" zu erkennen */
	onDrop: (item: DragItem, at: { target: Element; x: number; y: number; zone: Element }) => void;
	disabled?: boolean;
}

/** Wie lange der Finger liegen bleiben muss, bis das Ziehen beginnt */
const HOLD_MS = 350;
const EDGE = 56;

const zones = new Map<Element, DropzoneOptions>();

let active: {
	item: DragItem;
	ghost: HTMLElement;
	source: HTMLElement;
	over: Element | null;
	x: number;
	y: number;
	offX: number;
	offY: number;
	raf: number;
} | null = null;

let touchGuard = false;
/** Solange gezogen wird, scrollt der Finger nicht die Seite */
function guardTouch() {
	if (touchGuard || typeof document === 'undefined') return;
	touchGuard = true;
	document.addEventListener(
		'touchmove',
		(e) => {
			if (active) e.preventDefault();
		},
		{ passive: false }
	);
}

function zoneAt(x: number, y: number, kind: string): Element | null {
	let el = document.elementFromPoint(x, y);
	while (el) {
		const z = zones.get(el);
		if (z && !z.disabled && z.accepts.includes(kind)) return el;
		el = el.parentElement;
	}
	return null;
}

function scrollableAt(x: number, y: number): HTMLElement | null {
	const el = document.elementFromPoint(x, y);
	return (el?.closest('[data-dnd-scroll]') as HTMLElement | null) ?? null;
}

/** Am Rand mitscrollen – die Seite senkrecht, ein [data-dnd-scroll] waagrecht */
function autoscroll() {
	if (!active) return;
	const { x, y } = active;
	const speed = (dist: number) => Math.ceil(((EDGE - dist) / EDGE) * 14);
	if (y < EDGE) window.scrollBy(0, -speed(y));
	else if (y > window.innerHeight - EDGE) window.scrollBy(0, speed(window.innerHeight - y));
	const box = scrollableAt(x, y);
	if (box) {
		const r = box.getBoundingClientRect();
		if (x < r.left + EDGE) box.scrollLeft -= speed(x - r.left);
		else if (x > r.right - EDGE) box.scrollLeft += speed(r.right - x);
	}
	active.raf = requestAnimationFrame(autoscroll);
}

function setOver(el: Element | null) {
	if (!active || active.over === el) return;
	active.over?.classList.remove('dnd-over');
	el?.classList.add('dnd-over');
	active.over = el;
}

/** Den Klick, den der Browser nach dem Loslassen noch schickt, schlucken */
function swallowClick() {
	const stop = (e: Event) => {
		e.stopPropagation();
		e.preventDefault();
	};
	window.addEventListener('click', stop, { capture: true, once: true });
	setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

export const draggable: Action<HTMLElement, DraggableOptions> = (node, initial) => {
	let opts = initial;
	let start: { x: number; y: number; id: number; touch: boolean } | null = null;
	let last: PointerEvent | null = null;
	let hold: ReturnType<typeof setTimeout> | undefined;
	guardTouch();

	function begin(e: PointerEvent) {
		const rect = node.getBoundingClientRect();
		const ghost = node.cloneNode(true) as HTMLElement;
		ghost.classList.add('dnd-ghost');
		ghost.removeAttribute('id');
		Object.assign(ghost.style, {
			position: 'fixed',
			left: '0',
			top: '0',
			width: `${rect.width}px`,
			margin: '0',
			pointerEvents: 'none',
			zIndex: '1000'
		});
		document.body.appendChild(ghost);
		node.classList.add('dnd-source');
		document.body.classList.add('dnd-active');
		active = { item: { kind: opts.kind, data: opts.data }, ghost, source: node, over: null, x: e.clientX, y: e.clientY, offX: e.clientX - rect.left, offY: e.clientY - rect.top, raf: 0 };
		place(e);
		active.raf = requestAnimationFrame(autoscroll);
		if (start?.touch) navigator.vibrate?.(10);
	}

	function place(e: PointerEvent) {
		if (!active) return;
		active.x = e.clientX;
		active.y = e.clientY;
		active.ghost.style.transform = `translate(${e.clientX - active.offX}px, ${e.clientY - active.offY}px) rotate(1.5deg)`;
		setOver(zoneAt(e.clientX, e.clientY, active.item.kind));
	}

	function stop() {
		clearTimeout(hold);
		start = null;
		window.removeEventListener('pointermove', onmove);
		window.removeEventListener('pointerup', onup);
		window.removeEventListener('pointercancel', stop);
		if (active?.source === node) {
			cancelAnimationFrame(active.raf);
			active.over?.classList.remove('dnd-over');
			active.ghost.remove();
			node.classList.remove('dnd-source');
			document.body.classList.remove('dnd-active');
			active = null;
		}
	}

	function onmove(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		last = e;
		if (active?.source === node) {
			place(e);
			return;
		}
		const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
		// Am Handy: bewegt sich der Finger vor dem Halten, ist es Scrollen
		if (start.touch) {
			if (dist > 8) stop();
			return;
		}
		if (dist >= 5) begin(e);
	}

	function onup(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		if (active?.source === node) {
			const zone = zoneAt(e.clientX, e.clientY, active.item.kind);
			const item = active.item;
			const target = document.elementFromPoint(e.clientX, e.clientY);
			swallowClick();
			stop();
			if (zone && target) zones.get(zone)?.onDrop(item, { target, x: e.clientX, y: e.clientY, zone });
			return;
		}
		stop();
	}

	function onpointerdown(e: PointerEvent) {
		if (opts.disabled || e.button !== 0 || active) return;
		start = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch' };
		last = e;
		if (start.touch) hold = setTimeout(() => last && start && begin(last), HOLD_MS);
		window.addEventListener('pointermove', onmove);
		window.addEventListener('pointerup', onup);
		window.addEventListener('pointercancel', stop);
	}

	/** Langes Drücken öffnet am Handy sonst das Kontextmenü */
	function oncontextmenu(e: Event) {
		if (start?.touch || active) e.preventDefault();
	}

	node.addEventListener('pointerdown', onpointerdown);
	node.addEventListener('contextmenu', oncontextmenu);
	node.classList.add('dnd-draggable');
	return {
		update(o) {
			opts = o;
		},
		destroy() {
			stop();
			node.removeEventListener('pointerdown', onpointerdown);
			node.removeEventListener('contextmenu', oncontextmenu);
		}
	};
};

export const dropzone: Action<HTMLElement, DropzoneOptions> = (node, opts) => {
	zones.set(node, opts);
	return {
		update(o) {
			zones.set(node, o);
		},
		destroy() {
			zones.delete(node);
		}
	};
};
