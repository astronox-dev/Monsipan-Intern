<script lang="ts">
	/**
	 * Wetter auf der Übersicht: jetzt, heute und die nächsten 7 Tage – je Tag
	 * Symbol, höchste/tiefste Temperatur, Niederschlag und Wind. Umschaltbar
	 * zwischen Eibesbrunn und dem Standort des Geräts; den fragt der Browser bzw.
	 * die App erst, wenn man „Standort" antippt – danach (freigegeben) von selbst.
	 */
	import type { Component } from 'svelte';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import CloudSun from '@lucide/svelte/icons/cloud-sun';
	import CloudMoon from '@lucide/svelte/icons/cloud-moon';
	import Cloudy from '@lucide/svelte/icons/cloudy';
	import CloudFog from '@lucide/svelte/icons/cloud-fog';
	import CloudDrizzle from '@lucide/svelte/icons/cloud-drizzle';
	import CloudRain from '@lucide/svelte/icons/cloud-rain';
	import CloudSunRain from '@lucide/svelte/icons/cloud-sun-rain';
	import CloudMoonRain from '@lucide/svelte/icons/cloud-moon-rain';
	import CloudHail from '@lucide/svelte/icons/cloud-hail';
	import CloudSnow from '@lucide/svelte/icons/cloud-snow';
	import CloudLightning from '@lucide/svelte/icons/cloud-lightning';
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import Droplet from '@lucide/svelte/icons/droplet';
	import Wind from '@lucide/svelte/icons/wind';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { symbolInfo, type Weather, type WeatherKind } from '$lib/weather';

	let { weather, place }: { weather: Weather | null; place: string } = $props();

	const ICON: Record<WeatherKind, [Component, Component]> = {
		clear: [Sun, Moon],
		fair: [CloudSun, CloudMoon],
		partly: [CloudSun, CloudMoon],
		cloudy: [Cloudy, Cloudy],
		fog: [CloudFog, CloudFog],
		drizzle: [CloudDrizzle, CloudDrizzle],
		rain: [CloudRain, CloudRain],
		showers: [CloudSunRain, CloudMoonRain],
		sleet: [CloudHail, CloudHail],
		snow: [CloudSnow, CloudSnow],
		thunder: [CloudLightning, CloudLightning]
	};
	const TONE: Partial<Record<WeatherKind, string>> = { clear: 'text-warn', fair: 'text-warn', partly: 'text-warn', cloudy: 'text-ink-3', fog: 'text-ink-3' };

	function look(code: string) {
		const info = symbolInfo(code);
		return { ...info, Icon: ICON[info.kind][info.night ? 1 : 0], tone: info.night && info.kind !== 'cloudy' && info.kind !== 'fog' ? 'text-ink-2' : (TONE[info.kind] ?? 'text-info') };
	}

	const deg = (t: number) => `${Math.round(t)}°`;
	const mm = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 });
	const weekday = new Intl.DateTimeFormat('de-AT', { weekday: 'short', timeZone: 'UTC' });
	const dayMonth = new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
	const clock = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
	const noon = (date: string) => new Date(`${date}T12:00:00Z`);
	const dayName = (date: string, i: number) => (i === 0 ? 'Heute' : i === 1 ? 'Morgen' : weekday.format(noon(date)));

	function rainText(w: Weather) {
		const today = w.days[0];
		if (!today) return '';
		if (w.rainFrom == null) return today.rain < 0.1 ? 'Bleibt trocken' : `${mm.format(today.rain)} mm`;
		return w.rainFrom === w.now?.hour ? `Regen, ${mm.format(today.rain)} mm` : `Regen ab ${w.rainFrom} Uhr`;
	}

	/* ------------------------------------------------------------ Standort */

	type Here = { state: 'aus' } | { state: 'sucht' } | { state: 'da'; weather: Weather } | { state: 'fehler'; message: string };
	let here = $state<Here>({ state: 'aus' });
	let tab = $state<'home' | 'here'>('home');
	const KEY = 'wetter-ort';

	function remember(t: 'home' | 'here') {
		try {
			localStorage.setItem(KEY, t === 'here' ? 'standort' : 'eibesbrunn');
		} catch {
			/* kein Speicher – dann eben ohne Merken */
		}
	}

	/** Standort holen und das Wetter dazu – die Lage geht auf etwa 1 km gerundet an den Server */
	async function locate() {
		if (here.state === 'sucht' || here.state === 'da') return;
		if (!('geolocation' in navigator)) {
			here = { state: 'fehler', message: 'Dieses Gerät kann den Standort nicht bestimmen.' };
			return;
		}
		here = { state: 'sucht' };
		try {
			const pos = await new Promise<GeolocationPosition>((ok, fail) =>
				navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, maximumAge: 15 * 60_000, timeout: 20_000 })
			);
			const round = (v: number) => Math.round(v * 100) / 100;
			const res = await fetch('/wetter', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Die Vorhersage ist gerade nicht abrufbar.');
			here = { state: 'da', weather: await res.json() };
		} catch (e) {
			const code = typeof e === 'object' && e && 'code' in e ? (e as GeolocationPositionError).code : 0;
			here = {
				state: 'fehler',
				message:
					code === 1
						? 'Der Standort ist nicht freigegeben – im Browser bzw. in den Einstellungen der App erlauben.'
						: code
							? 'Der Standort ließ sich gerade nicht bestimmen.'
							: e instanceof Error
								? e.message
								: 'Die Vorhersage ist gerade nicht abrufbar.'
			};
		}
	}

	function choose(t: 'home' | 'here') {
		tab = t;
		remember(t);
		if (t === 'here') {
			if (here.state === 'fehler') here = { state: 'aus' };
			locate();
		}
	}

	// Beim Öffnen: zuletzt gewählt war der Standort, oder er ist schon freigegeben – dann gleich holen
	$effect(() => {
		let wanted = false;
		try {
			wanted = localStorage.getItem(KEY) === 'standort';
		} catch {
			/* kein Speicher */
		}
		if (wanted) tab = 'here';
		if (!('geolocation' in navigator)) return;
		if (!navigator.permissions) {
			if (wanted) locate();
			return;
		}
		navigator.permissions
			.query({ name: 'geolocation' })
			.then((p) => {
				if (p.state === 'granted' || (wanted && p.state === 'prompt')) locate();
				else if (wanted && p.state === 'denied') here = { state: 'fehler', message: 'Der Standort ist nicht freigegeben – im Browser bzw. in den Einstellungen der App erlauben.' };
			})
			.catch(() => {
				if (wanted) locate();
			});
	});

	const shown = $derived(tab === 'here' ? (here.state === 'da' ? here.weather : null) : weather);
	const homeNow = $derived(weather?.now ? look(weather.now.symbol) : null);
	const hereNow = $derived(here.state === 'da' && here.weather.now ? look(here.weather.now.symbol) : null);
</script>

{#snippet tabButton(key: 'home' | 'here', label: string, now: ReturnType<typeof look> | null, temp: number | undefined)}
	<button
		type="button"
		role="tab"
		aria-selected={tab === key}
		onclick={() => choose(key)}
		class="flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {tab === key
			? 'bg-ink text-surface'
			: 'text-ink-2 hover:bg-surface-3 hover:text-ink'}"
	>
		{#if key === 'here' && here.state === 'sucht'}
			<LoaderCircle size={16} class="shrink-0 animate-spin" aria-hidden="true" />
		{:else if now}
			<now.Icon size={16} class="shrink-0" aria-hidden="true" />
		{:else if key === 'here'}
			<MapPin size={16} class="shrink-0" aria-hidden="true" />
		{/if}
		<span class="truncate">{label}</span>
		{#if temp != null}<span class="num shrink-0">{deg(temp)}</span>{/if}
	</button>
{/snippet}

<section class="card mb-4 p-4 lg:p-5" aria-labelledby="h-wetter">
	<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
		<h2 id="h-wetter" class="text-xl">Wetter</h2>
		<div class="grid w-full grid-cols-2 rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:w-auto" role="tablist" aria-label="Ort">
			{@render tabButton('home', place, homeNow, weather?.now?.temp)}
			{@render tabButton('here', here.state === 'da' ? here.weather.place : 'Standort', hereNow, here.state === 'da' ? here.weather.now?.temp : undefined)}
		</div>
	</div>

	{#if tab === 'here' && here.state !== 'da'}
		<p class="mt-3 flex items-center gap-2 text-ink-2" role="status">
			{#if here.state === 'fehler'}
				<MapPin size={18} class="shrink-0 text-ink-3" aria-hidden="true" />{here.message}
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => choose('here')}>Nochmal</button>
			{:else}
				<LoaderCircle size={18} class="shrink-0 animate-spin text-ink-3" aria-hidden="true" />Standort wird bestimmt …
			{/if}
		</p>
	{:else if !shown || !shown.days.length}
		<p class="mt-3 flex items-center gap-2 text-ink-2"><CloudOff size={18} class="text-ink-3" aria-hidden="true" />Die Vorhersage ist gerade nicht abrufbar.</p>
	{:else}
		{@const w = shown}
		{#if w.now}
			{@const now = look(w.now.symbol)}
			<div class="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
				<div class="flex min-w-0 items-center gap-3">
					<now.Icon size={44} strokeWidth={1.75} class="shrink-0 {now.tone}" aria-hidden="true" />
					<div class="min-w-0">
						<p class="num font-display text-[2.25rem] leading-none font-semibold">{deg(w.now.temp)}</p>
						<p class="mt-1 truncate text-sm text-ink-2">{now.label} · {w.place}</p>
					</div>
				</div>
				<dl class="grid grid-cols-3 gap-x-6 gap-y-1 text-sm sm:flex sm:flex-wrap sm:gap-x-8">
					{#if w.now.feels != null}
						<div>
							<dt class="text-ink-3">Gefühlt</dt>
							<dd class="num font-medium">{deg(w.now.feels)}</dd>
						</div>
					{/if}
					<div>
						<dt class="text-ink-3">Wind</dt>
						<dd class="num font-medium">{w.now.wind} km/h</dd>
					</div>
					{#if w.days[0]}
						<div>
							<dt class="text-ink-3">Heute</dt>
							<dd class="num font-medium {w.rainFrom != null ? 'text-info' : ''}">{rainText(w)}</dd>
						</div>
					{/if}
				</dl>
			</div>
		{/if}

		<ol class="mt-4 grid grid-cols-4 gap-2 md:grid-cols-8">
			{#each w.days as d, i (d.date)}
				{@const day = look(d.symbol)}
				<li class="min-w-0 rounded-xl border px-1.5 py-2.5 text-center {i === 0 ? 'border-brand bg-brand-soft/40' : 'border-line bg-surface-2'}" title={day.label}>
					<p class="text-sm font-semibold">{dayName(d.date, i)}</p>
					<p class="num text-[0.75rem] text-ink-3">{dayMonth.format(noon(d.date))}</p>
					<day.Icon size={30} strokeWidth={1.75} class="mx-auto my-2 {day.tone}" aria-hidden="true" />
					<span class="sr-only">{day.label}, </span>
					<p class="num text-[0.9375rem] whitespace-nowrap">
						<span class="font-semibold">{deg(d.max)}</span>
						<span class="text-ink-3">{deg(d.min)}</span>
					</p>
					<p class="num mt-1 flex items-center justify-center gap-0.5 text-[0.75rem] whitespace-nowrap {d.rain >= 1 ? 'font-medium text-info' : 'text-ink-3'}">
						<Droplet size={12} class="shrink-0" aria-hidden="true" /><span class="sr-only">Niederschlag</span>{mm.format(d.rain)} mm
					</p>
					<p class="num flex items-center justify-center gap-0.5 text-[0.75rem] whitespace-nowrap text-ink-3">
						<Wind size={12} class="shrink-0" aria-hidden="true" /><span class="sr-only">Wind bis</span>{d.wind} km/h
					</p>
				</li>
			{/each}
		</ol>

		<p class="mt-3 text-[0.75rem] text-ink-3">
			Vorhersage von {clock.format(new Date(w.updated))} Uhr · Daten:
			<a href="https://www.met.no/en/free-meteorological-data" class="underline hover:text-ink" target="_blank" rel="noopener noreferrer">MET Norway</a
			>{#if tab === 'here'}, Ortsname: <a href="https://www.openstreetmap.org/copyright" class="underline hover:text-ink" target="_blank" rel="noopener noreferrer"
					>© OpenStreetMap</a
				>{/if}
		</p>
	{/if}
</section>
