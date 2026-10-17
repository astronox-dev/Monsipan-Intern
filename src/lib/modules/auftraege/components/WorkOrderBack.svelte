<script lang="ts">
	/** Rückseite des Arbeitsauftrags: Besonderheiten der Baustelle – durch den Bauleiter */
	import { FREE_CHECKS, type WorkOrderForm } from '../work-order';

	interface Props {
		form: Pick<WorkOrderForm, 'ppe' | 'hazards'>;
		disabled?: boolean;
	}
	let { form = $bindable(), disabled = false }: Props = $props();

	const groups = $derived([
		{ title: 'Persönliche Schutzausrüstung', list: form.ppe },
		{ title: 'Besondere Gefahren', list: form.hazards }
	]);
</script>

<section class="card p-4 lg:p-5">
	<h2 class="text-lg">Besonderheiten der Baustelle</h2>
	<p class="mt-0.5 text-sm text-ink-3">Rückseite – füllt der Bauleiter aus.</p>
	<fieldset {disabled} class="mt-3 grid gap-5 lg:grid-cols-2">
		{#each groups as group (group.title)}
			<div>
				<p class="field-label">{group.title}</p>
				<div class="space-y-2">
					{#each group.list as item, i (i)}
						<div class="grid grid-cols-[1.25rem_8.5rem_1fr] items-center gap-2.5 sm:grid-cols-[1.25rem_10.5rem_1fr]">
							<input type="checkbox" class="size-5 accent-[var(--c-ink)]" bind:checked={item.checked} aria-label={item.label || 'Weitere Zeile'} />
							{#if i < group.list.length - FREE_CHECKS}
								<span>{item.label}:</span>
							{:else}
								<input class="input input-sm" maxlength="60" placeholder="Weitere" bind:value={item.label} aria-label="Bezeichnung" />
							{/if}
							<input
								class="input input-sm"
								maxlength="120"
								bind:value={item.detail}
								oninput={() => (item.checked ||= !!item.detail.trim())}
								aria-label="{item.label || 'Weitere'}: was genau"
							/>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</fieldset>
</section>
