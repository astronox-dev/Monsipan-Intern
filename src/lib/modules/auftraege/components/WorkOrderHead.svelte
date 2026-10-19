<script lang="ts">
	/**
	 * Kopf des Arbeitsauftrags: Auftrag und Baustelle, Beilagen und Evaluierung –
	 * füllt der Bauleiter vor dem Erstellen aus, danach nur noch das Büro.
	 */
	import { ATTACHMENTS, type WorkOrderForm } from '../work-order';

	interface Props {
		form: Pick<WorkOrderForm, 'title' | 'site' | 'startDate' | 'endDate' | 'contacts' | 'attachments' | 'evaluation'>;
		disabled?: boolean;
		/** Unter dem Termin: ob und wann der Auftrag in der Wochenplanung steht */
		planHint?: string;
	}
	let { form = $bindable(), disabled = false, planHint = '' }: Props = $props();
</script>

<section class="card p-4 lg:p-5">
	<h2 class="text-lg">Auftrag und Baustelle</h2>
	<p class="mt-0.5 text-sm text-ink-3">Füllt der Bauleiter aus.</p>
	<fieldset {disabled} class="mt-3 grid gap-3 sm:grid-cols-2">
		<label class="block sm:col-span-2">
			<span class="field-label">Auftrag</span>
			<input class="input" maxlength="200" bind:value={form.title} />
		</label>
		<label class="block sm:col-span-2">
			<span class="field-label">Baustelle</span>
			<input class="input" maxlength="200" bind:value={form.site} />
		</label>
		<label class="block">
			<span class="field-label">Ausführungsdatum</span>
			<input class="input" type="date" bind:value={form.startDate} />
		</label>
		<label class="block">
			<span class="field-label">Endtermin</span>
			<input class="input" type="date" bind:value={form.endDate} />
		</label>
		{#if planHint}<p class="-mt-1 text-sm text-ink-2 sm:col-span-2">{planHint}</p>{/if}
		{#each form.contacts as k, i (i)}
			<label class="block">
				<span class="field-label">Kontaktperson {i + 1}</span>
				<input class="input" maxlength="100" bind:value={k.name} />
			</label>
			<label class="block">
				<span class="field-label">Telefon-Nr.</span>
				<input class="input" type="tel" maxlength="40" bind:value={k.phone} />
			</label>
		{/each}
	</fieldset>
</section>

<section class="card p-4 lg:p-5">
	<h2 class="text-lg">Beilagen und Evaluierung</h2>
	<fieldset {disabled} class="mt-3 space-y-4">
		<div>
			<p class="field-label">Beilagen / Baustelleninformationen</p>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each ATTACHMENTS as a (a.key)}
					<label class="flex items-center gap-2.5">
						<input type="checkbox" class="size-5 accent-[var(--c-ink)]" bind:checked={form.attachments[a.key]} />{a.label}
					</label>
				{/each}
				<div class="flex items-center gap-2.5">
					<input type="checkbox" class="size-5 shrink-0 accent-[var(--c-ink)]" bind:checked={form.attachments.other} aria-label="Sonstiges" />
					<input
						class="input input-sm"
						maxlength="80"
						placeholder="Sonstiges"
						bind:value={form.attachments.otherText}
						oninput={() => (form.attachments.other ||= !!form.attachments.otherText.trim())}
					/>
				</div>
			</div>
		</div>
		<div>
			<p class="field-label">Evaluierung</p>
			<div class="flex flex-wrap gap-x-5 gap-y-2">
				<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="" bind:group={form.evaluation} />Keine Angabe</label>
				<label class="flex items-center gap-2"><input type="radio" class="accent-[var(--c-ink)]" value="standard" bind:group={form.evaluation} />Standardevaluierung</label>
				<label class="flex items-center gap-2">
					<input type="radio" class="accent-[var(--c-danger)]" value="baustelle" bind:group={form.evaluation} />Baustellenspezifische Evaluierung
					<span class="text-sm text-ink-3">(siehe Rückseite)</span>
				</label>
			</div>
		</div>
	</fieldset>
</section>
