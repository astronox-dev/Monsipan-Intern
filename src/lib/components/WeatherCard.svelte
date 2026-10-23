<script lang="ts">
	/**
	 * Wetter auf der Übersicht: jetzt, heute und die nächsten 7 Tage – je Tag
	 * Symbol, höchste/tiefste Temperatur, Niederschlag und Wind.
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

	const now = $derived(weather?.now ? look(weather.now.symbol) : null);
	const today = $derived(weather?.days[0]);
	const rainText = $derived(
		!weather || !today
			? ''
			: weather.rainFrom == null
				? today.rain < 0.1
					? 'Bleibt trocken'
					: `${mm.format(today.rain)} mm`
				: weather.rainFrom === weather.now?.hour
					? `Regen, ${mm.format(today.rain)} mm`
					: `Regen ab ${weather.rainFrom} Uhr`
	);
</script>

<section class="card mb-4 p-4 lg:p-5" aria-labelledby="h-wetter">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h2 id="h-wetter" class="text-xl">Wetter in {place}</h2>
		{#if weather}
			<p class="text-[0.75rem] text-ink-3">
				Vorhersage von {clock.format(new Date(weather.updated))} Uhr · Daten:
				<a href="https://www.met.no/en/free-meteorological-data" class="underline hover:text-ink" target="_blank" rel="noopener noreferrer">MET Norway</a>
			</p>
		{/if}
	</div>

	{#if !weather || !weather.days.length}
		<p class="mt-2 flex items-center gap-2 text-ink-2"><CloudOff size={18} class="text-ink-3" aria-hidden="true" />Die Vorhersage ist gerade nicht abrufbar.</p>
	{:else}
		{#if weather.now && now}
			<div class="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
				<div class="flex items-center gap-3">
					<now.Icon size={44} strokeWidth={1.75} class="shrink-0 {now.tone}" aria-hidden="true" />
					<div>
						<p class="num font-display text-[2.25rem] leading-none font-semibold">{deg(weather.now.temp)}</p>
						<p class="mt-1 text-sm text-ink-2">{now.label}</p>
					</div>
				</div>
				<dl class="grid grid-cols-3 gap-x-6 gap-y-1 text-sm sm:flex sm:flex-wrap sm:gap-x-8">
					{#if weather.now.feels != null}
						<div>
							<dt class="text-ink-3">Gefühlt</dt>
							<dd class="num font-medium">{deg(weather.now.feels)}</dd>
						</div>
					{/if}
					<div>
						<dt class="text-ink-3">Wind</dt>
						<dd class="num font-medium">{weather.now.wind} km/h</dd>
					</div>
					{#if today}
						<div>
							<dt class="text-ink-3">Heute</dt>
							<dd class="num font-medium {weather.rainFrom != null ? 'text-info' : ''}">{rainText}</dd>
						</div>
					{/if}
				</dl>
			</div>
		{/if}

		<ol class="mt-4 grid grid-cols-4 gap-2 md:grid-cols-8">
			{#each weather.days as d, i (d.date)}
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
	{/if}
</section>
