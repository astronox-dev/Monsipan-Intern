/** Fahrzeugarten: Beschriftung, Symbol für Listen und das Gleiche als SVG für die Karte */
import Car from '@lucide/svelte/icons/car';
import Truck from '@lucide/svelte/icons/truck';
import Van from '@lucide/svelte/icons/van';
import type { Component } from 'svelte';

export type VehicleKind = 'pkw' | 'transporter' | 'lkw';

export const KIND_OPTIONS: { value: VehicleKind; label: string; icon: Component }[] = [
	{ value: 'pkw', label: 'PKW', icon: Car },
	{ value: 'transporter', label: 'Transporter', icon: Van },
	{ value: 'lkw', label: 'LKW', icon: Truck }
];

export const kindOf = (kind: string) => KIND_OPTIONS.find((k) => k.value === kind) ?? KIND_OPTIONS[1];

const svg = (inner: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/** Leaflet zeichnet die Marker als Text – darum dieselben Lucide-Pfade noch einmal als Zeichenkette */
export const KIND_SVG: Record<VehicleKind, string> = {
	pkw: svg(
		'<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>'
	),
	transporter: svg(
		'<path d="M13 6v5a1 1 0 0 0 1 1h6.102a1 1 0 0 1 .712.298l.898.91a1 1 0 0 1 .288.702V17a1 1 0 0 1-1 1h-3"/><path d="M5 18H3a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h12c1.1 0 2.1.8 2.4 1.8l1.176 4.2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'
	),
	lkw: svg(
		'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'
	)
};

export const PLACE_SVG = svg(
	'<path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z"/><path d="M6 13h12"/><path d="M6 17h12"/>'
);
