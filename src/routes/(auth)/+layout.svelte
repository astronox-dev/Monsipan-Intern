<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';

	let { children } = $props();
</script>

<div class="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
	<!-- Asphaltfläche mit Mittellinie, die sich beim Laden aufmalt -->
	<aside class="road relative hidden overflow-hidden lg:block" aria-hidden="true">
		<div class="absolute inset-0 bg-[#1b1f24]"></div>
		<div class="grain absolute inset-0 opacity-40"></div>
		<div class="absolute inset-y-0 left-[18%] w-[6px] bg-white/80"></div>
		<div class="absolute inset-y-0 right-[18%] w-[6px] bg-white/80"></div>
		<div class="absolute inset-y-0 left-1/2 flex w-[10px] -translate-x-1/2 flex-col gap-[42px] overflow-hidden py-6">
			{#each Array(14) as _, i}
				<span class="dash block h-[74px] w-full shrink-0 rounded-[2px] bg-[#f8f000]" style="animation-delay: {120 + i * 70}ms"></span>
			{/each}
		</div>
		<div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#15181c] via-[#15181c]/90 to-transparent px-10 pt-32 pb-10 text-white">
			<p class="font-display text-4xl leading-tight font-semibold">Alles auf einer Spur.</p>
			<p class="mt-2 max-w-md text-white/75">
				Von der Anfrage bis zur Rechnung: Angebote, Aufträge, Wochenplan, Tagesberichte, Stunden und Lager – für Büro und Baustelle.
			</p>
		</div>
	</aside>

	<main
		class="flex items-center justify-center px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-10"
	>
		<div class="w-full max-w-sm">
			<div class="mb-10">
				<Logo large />
				<!-- Am Handy fehlt die Fahrbahn links – der Spruch steht dann hier -->
				<p class="mt-4 text-ink-2 lg:hidden">Alles auf einer Spur – von der Anfrage bis zur Rechnung.</p>
			</div>
			{@render children()}
		</div>
	</main>
</div>

<style>
	.dash {
		transform-origin: top;
		animation: paint 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	@keyframes paint {
		from {
			transform: scaleY(0);
		}
		to {
			transform: scaleY(1);
		}
	}
	.grain {
		background-image: radial-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px),
			radial-gradient(rgb(0 0 0 / 0.25) 1px, transparent 1px);
		background-size:
			3px 3px,
			5px 5px;
		background-position:
			0 0,
			1px 2px;
	}
</style>
