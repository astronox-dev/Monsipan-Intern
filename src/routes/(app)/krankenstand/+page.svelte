<script lang="ts">
	/**
	 * Krankenstand: oben melden – mit Foto oder PDF der Krankmeldung, die sich
	 * auch später nachreichen lässt. Darunter die Meldungen des Jahres; laufende
	 * (ohne Ende) zuerst. Wer meldet, die Person selbst und das Büro tragen das
	 * Ende ein und ergänzen Belege.
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Thermometer from '@lucide/svelte/icons/thermometer';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileText from '@lucide/svelte/icons/file-text';
	import ImageIcon from '@lucide/svelte/icons/image';
	import X from '@lucide/svelte/icons/x';
	import Upload from '@lucide/svelte/icons/upload';
	import BelegPicker from '$lib/modules/planung/components/BelegPicker.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { dateTime } from '$lib/format';
	import { rangeLabel, workdays } from '$lib/modules/planung/days';

	let { data, form } = $props();

	type Row = (typeof data.rows)[number];

	/* ------------------------------------------------ Melden */
	let person = $state('');
	// svelte-ignore state_referenced_locally
	let from = $state(data.today);
	let to = $state('');
	let note = $state('');
	let belege = $state<File[]>([]);
	let busy = $state(false);

	/** Die gewählten (verkleinerten) Belege statt der Dateifelder mitschicken */
	const withFiles =
		(files: () => File[], done: () => void, msg: string): SubmitFunction =>
		({ formData }) => {
			busy = true;
			formData.delete('beleg');
			for (const f of files()) formData.append('beleg', f);
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'success') {
					toast.success(msg);
					done();
				}
				await update({ reset: false });
			};
		};

	/* ------------------------------------------------ Bearbeiten */
	let editing = $state<number | null>(null);
	let editTo = $state('');
	let editNote = $state('');
	let addFor = $state<number | null>(null);
	let more = $state<File[]>([]);
	let asking = $state<number | null>(null);

	function startEdit(r: Row) {
		editing = r.id;
		editTo = r.to ?? '';
		editNote = r.note;
	}

	const running = (r: Row) => !r.to || r.to >= data.today;
	const others = $derived(data.scope !== 'self');
</script>

<svelte:head><title>{pageTitle(`Krankenstand ${data.year}`)}</title></svelte:head>

<div class="mt-1 mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><Thermometer size={26} aria-hidden="true" />Krankenstand</h1>
		<p class="text-ink-2">{data.year}{others ? '' : ' · deine Meldungen'}</p>
	</div>
	<div class="flex items-center gap-2">
		<a href="?jahr={data.year - 1}" class="btn btn-secondary btn-sm"><ChevronLeft size={16} aria-hidden="true" />{data.year - 1}</a>
		{#if data.year !== data.thisYear}<a href="?" class="btn btn-ghost btn-sm">{data.thisYear}</a>{/if}
		<a href="?jahr={data.year + 1}" class="btn btn-secondary btn-sm">{data.year + 1}<ChevronRight size={16} aria-hidden="true" /></a>
	</div>
</div>

{#if form && 'message' in form && form.message}<p class="card mb-4 border-danger/40 p-3 text-sm text-danger" role="alert">{form.message}</p>{/if}

{#if data.canReport}
	<section class="card mb-4 p-4 lg:p-5">
		<h2 class="text-lg">Krankenstand melden</h2>
		<p class="mt-1 text-sm text-ink-2">Die Krankmeldung als Foto oder PDF gleich dazu – oder später nachreichen. Sie sehen nur du{others ? ', wer meldet' : ''} und das Büro.</p>
		<form
			method="POST"
			action="?/create"
			enctype="multipart/form-data"
			class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
			use:enhance={withFiles(
				() => belege,
				() => {
					belege = [];
					to = note = person = '';
					from = data.today;
				},
				'Gemeldet – gute Besserung!'
			)}
		>
			{#if data.people.length}
				<label class="block sm:col-span-2 lg:col-span-4">
					<span class="field-label">Für</span>
					<select class="select" name="person" bind:value={person}>
						<option value="">Mich selbst</option>
						{#each data.people.filter((p) => p.id !== data.me) as p (p.id)}<option value={String(p.id)}>{p.name}{p.partyName ? ` · ${p.partyName}` : ''}</option>{/each}
					</select>
				</label>
			{/if}
			<label class="block">
				<span class="field-label">Krank seit *</span>
				<input class="input num" type="date" name="von" required bind:value={from} />
			</label>
			<label class="block">
				<span class="field-label">Bis <span class="text-ink-3">– leer, wenn noch offen</span></span>
				<input class="input num" type="date" name="bis" min={from || undefined} bind:value={to} />
			</label>
			<label class="block sm:col-span-2">
				<span class="field-label">Notiz</span>
				<input class="input" name="notiz" maxlength="500" bind:value={note} placeholder="freiwillig – keine Diagnose nötig" />
			</label>
			<div class="sm:col-span-2 lg:col-span-4">
				<span class="field-label">Krankmeldung</span>
				<BelegPicker bind:files={belege} max={data.maxBelege} disabled={busy} />
			</div>
			<div class="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
				<button class="btn btn-primary" disabled={busy || !from}>{busy ? 'Wird gemeldet …' : 'Melden'}</button>
				{#if from && to}<span class="num text-sm text-ink-2">{workdays(from, to)} Arbeitstage</span>{/if}
			</div>
		</form>
	</section>
{/if}

<section class="card overflow-hidden">
	<h2 class="px-4 pt-4 text-lg lg:px-5">{others ? 'Krankenstände' : 'Meine Krankenstände'} {data.year}</h2>
	{#if data.rows.length}
		<ul class="mt-2 divide-y divide-line">
			{#each data.rows as r (r.id)}
				<li class="px-4 py-3 lg:px-5">
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span class="min-w-0 flex-1">
							<span class="block font-medium">
								{#if others}{`${r.name} · `}{/if}<span class="num">{r.to ? rangeLabel(r.from, r.to) : `seit ${rangeLabel(r.from, null)}`}</span>
							</span>
							<span class="block text-[0.8125rem] text-ink-3">
								{[
									r.to ? `${workdays(r.from, r.to)} Arbeitstage` : 'noch offen',
									r.partyName && others ? r.partyName : '',
									r.reportedBy && `gemeldet von ${r.reportedBy}`,
									`am ${dateTime(r.createdAt)}`,
									r.note && `„${r.note}"`
								]
									.filter(Boolean)
									.join(' · ')}
							</span>
						</span>
						{#if running(r)}<span class="badge badge-warn">{r.to ? 'Krank' : 'Offen'}</span>{/if}
						{#if r.docCount}
							<span class="badge badge-ok">Krankmeldung{r.docCount > 1 ? ` (${r.docCount})` : ''}</span>
						{:else}
							<span class="badge">Krankmeldung fehlt</span>
						{/if}
					</div>

					{#if r.docs.length}
						<ul class="mt-2 flex flex-wrap gap-1.5">
							{#each r.docs as d (d.id)}
								<li class="flex items-center gap-1 rounded-lg border border-line text-sm">
									<a href="/krankenstand/beleg/{d.id}" target="_blank" rel="noopener" class="flex items-center gap-1.5 px-2 py-1 hover:underline">
										{#if d.kind === 'pdf'}<FileText size={15} aria-hidden="true" />{:else}<ImageIcon size={15} aria-hidden="true" />{/if}
										<span class="max-w-48 truncate">{d.fileName || (d.kind === 'pdf' ? 'Krankmeldung.pdf' : 'Foto')}</span>
									</a>
									{#if r.canEdit}
										<form method="POST" action="?/removeDocument" use:enhance>
											<input type="hidden" name="id" value={d.id} />
											<button class="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-danger" aria-label="Beleg entfernen"><X size={14} /></button>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if r.canEdit}
						{#if editing === r.id}
							<form
								method="POST"
								action="?/update"
								class="mt-2 flex flex-wrap items-end gap-2"
								use:enhance={() => async ({ result, update }) => {
									if (result.type === 'success') {
										editing = null;
										toast.success('Gespeichert');
									}
									await update({ reset: false });
								}}
							>
								<input type="hidden" name="id" value={r.id} />
								<label class="block">
									<span class="field-label">Bis</span>
									<input class="input input-sm num" type="date" name="bis" min={r.from} bind:value={editTo} />
								</label>
								<label class="block min-w-0 flex-1 basis-48">
									<span class="field-label">Notiz</span>
									<input class="input input-sm" name="notiz" maxlength="500" bind:value={editNote} />
								</label>
								<button class="btn btn-primary btn-sm">Speichern</button>
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => (editing = null)}>Abbrechen</button>
							</form>
						{:else if addFor === r.id}
							<form
								method="POST"
								action="?/documents"
								enctype="multipart/form-data"
								class="mt-2 rounded-xl bg-surface-2 p-3"
								use:enhance={withFiles(
									() => more,
									() => {
										more = [];
										addFor = null;
									},
									'Krankmeldung hochgeladen'
								)}
							>
								<input type="hidden" name="id" value={r.id} />
								<BelegPicker bind:files={more} max={data.maxBelege - r.docCount} disabled={busy} />
								<div class="mt-2 flex gap-2">
									<button class="btn btn-primary btn-sm" disabled={busy || !more.length}><Upload size={15} aria-hidden="true" />Hochladen</button>
									<button type="button" class="btn btn-ghost btn-sm" onclick={() => ((addFor = null), (more = []))}>Abbrechen</button>
								</div>
							</form>
						{:else}
							<div class="mt-2 flex flex-wrap gap-1">
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => startEdit(r)}>{r.to ? 'Ende ändern' : 'Gesund – Ende eintragen'}</button>
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => ((addFor = r.id), (more = []))}><Upload size={15} aria-hidden="true" />Krankmeldung {r.docCount ? 'ergänzen' : 'nachreichen'}</button>
								{#if r.createdBy === data.me || data.canManage}
									{#if asking === r.id}
										<form method="POST" action="?/remove" class="flex items-center gap-1" use:enhance={() => async ({ update }) => ((asking = null), await update())}>
											<input type="hidden" name="id" value={r.id} />
											<button class="btn btn-sm bg-danger text-white hover:opacity-90">Ja, löschen</button>
											<button type="button" class="btn btn-ghost btn-sm" onclick={() => (asking = null)}>Nein</button>
										</form>
									{:else}
										<button type="button" class="btn btn-ghost btn-sm text-danger hover:bg-danger-soft" onclick={() => (asking = r.id)}>Löschen</button>
									{/if}
								{/if}
							</div>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="px-4 pt-1 pb-4 text-sm text-ink-3 lg:px-5">Kein Krankenstand in {data.year}.</p>
	{/if}
</section>
