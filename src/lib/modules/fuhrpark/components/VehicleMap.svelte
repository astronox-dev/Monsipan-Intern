<script lang="ts">
	/**
	 * Karte für den Fuhrpark: Grundkarte von basemap.at (amtlich, Österreich),
	 * darauf die Autos mit Namen – oder die Strecke eines Tages mit den
	 * Standzeiten. Leaflet wird erst im Browser geladen.
	 */
	import 'leaflet/dist/leaflet.css';
	import { onMount } from 'svelte';
	import type * as L from 'leaflet';
	import type { MapVehicle } from '../track';

	interface Props {
		vehicles?: MapVehicle[];
		track?: { lat: number; lon: number }[];
		stops?: { lat: number; lon: number; label: string }[];
		/** Hervorgehobenes Fahrzeug – die Karte schwenkt hin */
		focus?: number | null;
		class?: string;
	}
	let { vehicles = [], track = [], stops = [], focus = null, class: cls = '' }: Props = $props();

	let box: HTMLDivElement;
	let leaflet: typeof L | null = $state(null);
	let map: L.Map | null = null;
	let layer: L.LayerGroup | null = null;
	let fitted = false;

	/** Mitte Österreichs, falls noch nichts da ist */
	const AUSTRIA: [number, number] = [47.7, 13.9];

	onMount(() => {
		let gone = false;
		import('leaflet').then((mod) => {
			if (gone) return;
			const Lf = (mod.default ?? mod) as typeof L;
			map = Lf.map(box, { zoomControl: true, attributionControl: true }).setView(AUSTRIA, 7);
			Lf.tileLayer('https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png', {
				maxZoom: 19,
				attribution: 'Grundkarte: <a href="https://basemap.at" target="_blank" rel="noopener noreferrer">basemap.at</a>'
			}).addTo(map);
			layer = Lf.layerGroup().addTo(map);
			leaflet = Lf;
		});
		return () => {
			gone = true;
			map?.remove();
			map = null;
		};
	});

	const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

	// Neu zeichnen, sobald sich Autos, Strecke oder Standzeiten ändern
	$effect(() => {
		const Lf = leaflet;
		if (!Lf || !map || !layer) return;
		layer.clearLayers();
		const bounds: [number, number][] = [];

		if (track.length > 1) {
			const line = track.map((p) => [p.lat, p.lon] as [number, number]);
			Lf.polyline(line, { color: '#1b1f24', weight: 5, opacity: 0.85 }).addTo(layer);
			Lf.polyline(line, { color: '#f3eb1c', weight: 2, opacity: 1, dashArray: '8 8' }).addTo(layer);
			bounds.push(...line);
			const first = line[0];
			const last = line[line.length - 1];
			Lf.circleMarker(first, { radius: 6, color: '#1b1f24', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }).bindTooltip('Start').addTo(layer);
			Lf.circleMarker(last, { radius: 7, color: '#1b1f24', weight: 2, fillColor: '#f3eb1c', fillOpacity: 1 }).bindTooltip('Zuletzt').addTo(layer);
		}
		for (const s of stops) {
			Lf.circleMarker([s.lat, s.lon], { radius: 8, color: '#1b1f24', weight: 2, fillColor: '#82b4ef', fillOpacity: 0.9 }).bindTooltip(esc(s.label)).addTo(layer);
		}
		for (const v of vehicles) {
			const arrow = v.state === 'faehrt' && v.heading != null ? `<span class="pfeil" style="transform: rotate(${Math.round(v.heading)}deg)">▲</span>` : '';
			const icon = Lf.divIcon({
				className: `fz fz-${v.state}`,
				html: `<a href="${esc(v.href)}"><span class="punkt">${arrow}</span><span class="name">${esc(v.name)}</span></a>`,
				iconSize: [0, 0]
			});
			Lf.marker([v.lat, v.lon], { icon, keyboard: false }).addTo(layer);
			bounds.push([v.lat, v.lon]);
		}

		const target = focus != null ? vehicles.find((v) => v.id === focus) : null;
		if (target) map.setView([target.lat, target.lon], Math.max(map.getZoom(), 14));
		else if (!fitted && bounds.length) {
			map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
			fitted = true;
		}
	});
</script>

<div bind:this={box} class="karte {cls}" role="region" aria-label="Karte"></div>

<style>
	.karte {
		position: relative;
		z-index: 0;
		min-height: 18rem;
		border-radius: 12px;
		overflow: hidden;
		background: var(--c-surface-3);
	}
	/* Autos: Punkt in der Farbe des Zustands, daneben der Name */
	.karte :global(.fz a) {
		position: absolute;
		left: -9px;
		top: -9px;
		display: flex;
		align-items: center;
		gap: 4px;
		text-decoration: none;
		white-space: nowrap;
	}
	.karte :global(.fz .punkt) {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: 999px;
		border: 2px solid #1b1f24;
		background: #ffffff;
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
	}
	.karte :global(.fz-faehrt .punkt) {
		background: #f3eb1c;
	}
	.karte :global(.fz-offline .punkt) {
		background: #c9ced4;
		border-color: #6b7380;
	}
	.karte :global(.fz .pfeil) {
		font-size: 9px;
		line-height: 1;
		color: #1b1f24;
	}
	.karte :global(.fz .name) {
		padding: 1px 6px;
		border-radius: 4px;
		background: #1b1f24;
		color: #ffffff;
		font: 600 12px/1.4 var(--font-display);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
	}
	.karte :global(.fz-offline .name) {
		background: #6b7380;
	}
</style>
