<script lang="ts">
	/**
	 * Karte für den Fuhrpark: Grundkarte von basemap.at (amtlich, Österreich) –
	 * außerhalb ist sie durchsichtig, darunter liegt OpenStreetMap für die
	 * Nachbarländer. Darauf die festen Orte und die Autos mit Namen – oder die Strecke eines
	 * Tages mit den nummerierten Standzeiten. Leaflet wird erst im Browser geladen.
	 */
	import 'leaflet/dist/leaflet.css';
	import { onMount } from 'svelte';
	import type * as L from 'leaflet';
	import { KIND_SVG, PLACE_SVG } from '../kinds';
	import type { LatLon, MapVehicle } from '../track';

	interface Props {
		vehicles?: MapVehicle[];
		track?: { lat: number; lon: number }[];
		/** Standzeiten: Nummer auf der Karte, wie in der Liste daneben */
		stops?: { lat: number; lon: number; label: string; number: string }[];
		/** Feste Orte: Name und Umkreis */
		places?: { lat: number; lon: number; name: string; radius: number }[];
		/** Ort wählen: ein Klick in die Karte setzt die Lage */
		onpick?: (lat: number, lon: number) => void;
		/** Die gewählte Lage samt Umkreis */
		picked?: (LatLon & { radius: number }) | null;
		/** Hervorgehobenes Fahrzeug – die Karte schwenkt hin und fährt mit */
		focus?: number | null;
		/** Wer die Karte selbst verschiebt, will nicht mehr mitfahren */
		onrelease?: () => void;
		class?: string;
	}
	let { vehicles = [], track = [], stops = [], places = [], onpick, picked = null, focus = null, onrelease, class: cls = '' }: Props = $props();

	let box: HTMLDivElement;
	let leaflet: typeof L | null = $state(null);
	let map: L.Map | null = null;
	let layer: L.LayerGroup | null = null;
	let fitted = false;
	/** Die Autos bleiben dieselben Marker – so gleiten sie zum neuen Standort, statt zu springen */
	const markers = new Map<number, { marker: L.Marker; html: string; frame: number }>();
	const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	/** In einer Sekunde von der alten zur neuen Lage */
	function glide(entry: { marker: L.Marker; frame: number }, to: [number, number]) {
		cancelAnimationFrame(entry.frame);
		const from = entry.marker.getLatLng();
		if (still || (from.lat === to[0] && from.lng === to[1])) {
			entry.marker.setLatLng(to);
			return;
		}
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / 1000);
			const e = 1 - (1 - t) ** 3;
			entry.marker.setLatLng([from.lat + (to[0] - from.lat) * e, from.lng + (to[1] - from.lng) * e]);
			if (t < 1) entry.frame = requestAnimationFrame(step);
		};
		entry.frame = requestAnimationFrame(step);
	}

	/** Mitte Österreichs, falls noch nichts da ist */
	const AUSTRIA: [number, number] = [47.7, 13.9];

	onMount(() => {
		let gone = false;
		import('leaflet').then((mod) => {
			if (gone) return;
			const Lf = (mod.default ?? mod) as typeof L;
			map = Lf.map(box, { zoomControl: true, attributionControl: true }).setView(AUSTRIA, 7);
			Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
			}).addTo(map);
			Lf.tileLayer('https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png', {
				maxZoom: 19,
				attribution: 'Grundkarte: <a href="https://basemap.at" target="_blank" rel="noopener noreferrer">basemap.at</a>'
			}).addTo(map);
			layer = Lf.layerGroup().addTo(map);
			map.on('dragstart', () => onrelease?.());
			map.on('click', (e) => onpick?.(e.latlng.lat, e.latlng.lng));
			leaflet = Lf;
		});
		return () => {
			gone = true;
			for (const m of markers.values()) cancelAnimationFrame(m.frame);
			markers.clear();
			map?.remove();
			map = null;
		};
	});

	const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

	// Neu zeichnen, sobald sich Strecke, Standzeiten oder Autos ändern
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
		const areas: [number, number][] = [];
		for (const p of places) {
			Lf.circle([p.lat, p.lon], { radius: p.radius, color: '#1f6fc4', weight: 1.5, fillColor: '#1f6fc4', fillOpacity: 0.12, interactive: false }).addTo(layer);
			const icon = Lf.divIcon({ className: 'ort', html: `<span>${PLACE_SVG}${esc(p.name)}</span>`, iconSize: [0, 0] });
			Lf.marker([p.lat, p.lon], { icon, keyboard: false, interactive: false }).addTo(layer);
			areas.push([p.lat, p.lon]);
		}
		for (const s of stops) {
			const icon = Lf.divIcon({ className: 'stopp', html: `<span>${s.number}</span>`, iconSize: [0, 0] });
			Lf.marker([s.lat, s.lon], { icon, keyboard: false, zIndexOffset: 500 }).bindTooltip(esc(s.label)).addTo(layer);
			bounds.push([s.lat, s.lon]);
		}
		if (picked) {
			Lf.circle([picked.lat, picked.lon], { radius: picked.radius, color: '#1b1f24', weight: 2, fillColor: '#f3eb1c', fillOpacity: 0.3, interactive: false }).addTo(layer);
			Lf.circleMarker([picked.lat, picked.lon], { radius: 5, color: '#1b1f24', weight: 2, fillColor: '#f3eb1c', fillOpacity: 1, interactive: false }).addTo(layer);
		}
		const seen = new Set<number>();
		for (const v of vehicles) {
			seen.add(v.id);
			const arrow = v.state === 'faehrt' && v.heading != null ? `<span class="pfeil" style="transform: rotate(${Math.round(v.heading)}deg)">▲</span>` : '';
			const html = `<a href="${esc(v.href)}"><span class="punkt">${arrow}</span><span class="name">${KIND_SVG[v.kind]}${esc(v.name)}</span></a>`;
			const icon = () => Lf.divIcon({ className: `fz fz-${v.state}`, html, iconSize: [0, 0] });
			const known = markers.get(v.id);
			if (known) {
				if (known.html !== html + v.state) known.marker.setIcon(icon());
				known.html = html + v.state;
				glide(known, [v.lat, v.lon]);
			} else {
				const marker = Lf.marker([v.lat, v.lon], { icon: icon(), keyboard: false }).addTo(map);
				markers.set(v.id, { marker, html: html + v.state, frame: 0 });
			}
			bounds.push([v.lat, v.lon]);
		}
		for (const [id, m] of markers) {
			if (seen.has(id)) continue;
			cancelAnimationFrame(m.frame);
			m.marker.remove();
			markers.delete(id);
		}

		const target = focus != null ? vehicles.find((v) => v.id === focus) : null;
		// Ausgewähltes Auto: die Karte fährt mit
		if (target) map.setView([target.lat, target.lon], Math.max(map.getZoom(), 14), { animate: !still });
		else if (!fitted && (bounds.length || areas.length)) {
			map.fitBounds(bounds.length ? bounds : areas, { padding: [40, 40], maxZoom: 15 });
			fitted = true;
		}
		// Gewählte Lage: dorthin schwenken, ohne den Maßstab zu ändern
		if (picked && !map.getBounds().contains([picked.lat, picked.lon])) map.panTo([picked.lat, picked.lon]);
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
		display: inline-flex;
		align-items: center;
		gap: 4px;
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
	/* Feste Orte: Name auf einem blauen Schild, knapp unter der Mitte – ein Auto dort bleibt lesbar */
	.karte :global(.ort span) {
		position: absolute;
		left: 0;
		top: 0;
		transform: translate(-50%, 12px);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 6px;
		border-radius: 4px;
		background: #1f6fc4;
		color: #ffffff;
		font: 600 11px/1.4 var(--font-display);
		white-space: nowrap;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
	}
	/* Standzeiten: Nummer wie in der Liste */
	.karte :global(.stopp span) {
		position: absolute;
		left: 0;
		top: 0;
		transform: translate(-50%, -50%);
		display: grid;
		place-items: center;
		min-width: 24px;
		height: 24px;
		padding: 0 5px;
		border-radius: 999px;
		white-space: nowrap;
		border: 2px solid #1b1f24;
		background: #f3eb1c;
		color: #1b1f24;
		font: 700 12px/1 var(--font-display);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
	}
</style>
