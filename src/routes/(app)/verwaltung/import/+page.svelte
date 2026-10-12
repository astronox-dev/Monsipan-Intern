<script lang="ts">
	/**
	 * Import und Export. Export: je Bereich Excel oder CSV. Import in drei
	 * Schritten: Datei lesen → Spalten zuordnen und prüfen → importieren.
	 */
	import { pageTitle } from '$lib/app';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import ScanSearch from '@lucide/svelte/icons/scan-search';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Info from '@lucide/svelte/icons/info';
	import { TRANSFER, TRANSFER_KINDS, type TransferKind } from '$lib/modules/auftraege/transfer';
	import { toast } from '$lib/stores/toast.svelte';

	let { data, form } = $props();

	const LIST: Record<TransferKind, string> = { kunden: '/kunden', anfragen: '/anfragen', auftraege: '/auftraege', rechnungen: '/rechnungen' };
	const ACTION_LABELS = { neu: 'neu', aktualisieren: 'aktualisieren', ueberspringen: 'schon vorhanden – übersprungen', fehler: 'mit Fehlern – nicht übernommen' } as const;

	let kind = $state<TransferKind>('kunden');
	let busy = $state('');
	/** Nach einem Wechsel von Art oder Datei gelten die Ergebnisse nicht mehr */
	let stale = $state(true);
	let mapping = $state<Record<string, string>>({});
	let update = $state('ueberspringen');

	const result = $derived(!stale && form && 'analysis' in form ? form : null);
	const def = $derived(TRANSFER[kind]);
	const letter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
	const sampleOf = (key: string) => {
		const i = Number(mapping[key] ?? -1);
		return i >= 0 ? (result?.analysis?.columns[i]?.sample ?? '') : '';
	};
	const importable = $derived(result?.preview ? result.preview.counts.neu + result.preview.counts.aktualisieren : 0);

	/** Welche Aktion es war, sagt die Adresse des gedrückten Knopfs (?/analyze, ?/preview, ?/run) */
	const submit: SubmitFunction = ({ action }) => {
		const key = action.search.slice(2);
		busy = key;
		return async ({ result: r, update: refresh }) => {
			busy = '';
			if (r.type === 'success') {
				stale = false;
				const m = r.data?.mapping as Record<string, number> | undefined;
				if (m) mapping = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)]));
				if (key === 'run') {
					const res = r.data?.result as { created: number; updated: number } | null | undefined;
					if (res) toast.success('Importiert', `${res.created} neu, ${res.updated} aktualisiert`);
				}
			}
			await refresh({ reset: false });
		};
	};
</script>

<svelte:head><title>{pageTitle('Import und Export')}</title></svelte:head>

<div class="mt-1 mb-5">
	<h1 class="flex items-center gap-2 text-[2rem] leading-tight"><FileSpreadsheet size={26} aria-hidden="true" />Import und Export</h1>
	<p class="max-w-3xl text-ink-2">Kunden, Anfragen, Aufträge und Rechnungen als Excel (.xlsx) oder CSV – zum Weitergeben, Sichern oder aus einem anderen Programm übernehmen.</p>
</div>

<section class="card p-4 lg:p-6" aria-labelledby="h-export">
	<h2 id="h-export" class="flex items-center gap-2 text-xl"><Download size={20} aria-hidden="true" />Exportieren</h2>
	<p class="mt-1 text-sm text-ink-2">Alle Einträge, Aufträge und Rechnungen mit einer Zeile je Position. Die Spaltenüberschriften passen genau zum Import.</p>
	{#if data.exports.length}
		<ul class="mt-3 divide-y divide-line rounded-xl border border-line">
			{#each data.exports as e (e.kind)}
				<li class="flex flex-wrap items-center gap-3 px-3 py-2.5">
					<span class="min-w-[10rem] flex-1 font-medium">{e.label} <span class="num text-sm font-normal text-ink-3">{e.count}</span></span>
					<a class="btn btn-secondary btn-sm" href="/verwaltung/import/export/{e.kind}" download><Download size={16} aria-hidden="true" />Excel</a>
					<a class="btn btn-ghost btn-sm" href="/verwaltung/import/export/{e.kind}?format=csv" download>CSV</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-3 text-sm text-ink-3">Für keinen Bereich hast du die Berechtigung, alles zu sehen.</p>
	{/if}
</section>

{#if data.canImport}
	<section class="card mt-4 p-4 lg:p-6" aria-labelledby="h-import">
		<h2 id="h-import" class="flex items-center gap-2 text-xl"><Upload size={20} aria-hidden="true" />Importieren</h2>
		<p class="mt-1 max-w-3xl text-sm text-ink-2">
			Aus Excel oder CSV, auch aus anderen Programmen: Die erste Zeile enthält die Spaltenüberschriften, danach je Zeile ein Eintrag – bei Aufträgen und
			Rechnungen je Zeile eine Position (gleiche Nummer = derselbe Beleg). Reihenfolge: <strong>zuerst Kunden</strong>, dann Anfragen und Aufträge,
			<strong>zuletzt Rechnungen</strong> – so finden Rechnungen ihren Auftrag.
		</p>

		<form method="POST" enctype="multipart/form-data" class="mt-4 space-y-5" use:enhance={submit}>
			<fieldset>
				<legend class="field-label">Was wird importiert?</legend>
				<div class="mt-1 inline-flex flex-wrap rounded-xl border border-line bg-surface p-1">
					{#each TRANSFER_KINDS as k (k)}
						<label class="cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium has-[:checked]:bg-ink has-[:checked]:text-surface">
							<input type="radio" name="art" value={k} class="sr-only" bind:group={kind} onchange={() => (stale = true)} />{TRANSFER[k].label}
						</label>
					{/each}
				</div>
				{#if kind === 'rechnungen'}
					<p class="mt-2 flex max-w-3xl items-start gap-2 text-sm text-ink-2">
						<Info size={16} class="mt-0.5 shrink-0" aria-hidden="true" />
						<span>
							Rechnungen kommen als <strong>Altbestand</strong>: gesperrt wie ausgestellte, aber ohne Archiv, Signatur und Prüfcode – maßgeblich bleibt das
							ursprünglich ausgestellte Dokument. Offen/bezahlt lässt sich ändern. Schon überfällige melden sich nicht als „überfällig".
						</span>
					</p>
				{/if}
			</fieldset>

			<div class="flex flex-wrap items-end gap-3">
				<label class="block min-w-[16rem] flex-1">
					<span class="field-label">Datei (.xlsx oder .csv)</span>
					<input
						type="file"
						name="datei"
						required
						accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
						class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:font-medium"
						onchange={() => (stale = true)}
					/>
				</label>
				<button class="btn btn-secondary" formaction="?/analyze" disabled={busy !== ''}>
					<ScanSearch size={18} aria-hidden="true" />{busy === 'analyze' ? 'Wird gelesen …' : 'Datei lesen'}
				</button>
				<a class="btn btn-ghost btn-sm" href="/verwaltung/import/export/{kind}?vorlage" download><Download size={16} aria-hidden="true" />Vorlage {def.label}</a>
			</div>

			{#if form && 'message' in form && form.message}<p class="text-sm text-danger" role="alert">{form.message}</p>{/if}

			{#if result && result.kind === kind}
				{@const a = result.analysis}
				<div class="space-y-4 border-t border-line pt-4">
					<p class="text-sm text-ink-2">
						{a.rows} Zeile{a.rows === 1 ? '' : 'n'}, {a.columns.length} Spalten{a.sheets.length > 1 ? ` · Blatt „${a.sheet}"` : ''}.
					</p>
					{#if a.sheets.length > 1}
						<label class="block max-w-xs">
							<span class="field-label">Blatt</span>
							<select class="select" name="blatt" value={a.sheet}>
								{#each a.sheets as s (s)}<option value={s}>{s}</option>{/each}
							</select>
							<span class="field-hint">Nach dem Wechsel „Datei lesen" drücken.</span>
						</label>
					{/if}

					<div>
						<h3 class="font-display text-lg font-semibold">Spalten zuordnen</h3>
						<p class="text-sm text-ink-2">Vorgeschlagen nach den Spaltenüberschriften – bitte prüfen. Pflichtfelder haben einen Stern.</p>
						<div class="mt-2 overflow-x-auto rounded-xl border border-line">
							<table class="w-full text-sm">
								<thead class="bg-surface-2 text-left">
									<tr>
										<th class="px-3 py-2 font-semibold">Feld im Portal</th>
										<th class="px-3 py-2 font-semibold">Spalte in der Datei</th>
										<th class="px-3 py-2 font-semibold">Beispiel</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-line">
									{#each def.fields as field, i (field.key)}
										{#if def.positions && field.part === 'position' && def.fields[i - 1]?.part !== 'position'}
											<tr class="bg-surface-2"><td colspan="3" class="px-3 py-1.5 text-[0.8125rem] font-semibold text-ink-2">Je Zeile eine Position</td></tr>
										{/if}
										<tr>
											<td class="px-3 py-1.5 align-top">
												<span class="font-medium">{field.label}{field.required ? ' *' : ''}</span>
												{#if field.hint}<span class="block text-[0.75rem] text-ink-3">{field.hint}</span>{/if}
											</td>
											<td class="px-3 py-1.5 align-top">
												<select class="select select-sm min-w-[12rem]" name="m.{field.key}" bind:value={mapping[field.key]}>
													<option value="-1">– nicht übernehmen –</option>
													{#each a.columns as c (c.index)}<option value={String(c.index)}>{letter(c.index)} · {c.title}</option>{/each}
												</select>
											</td>
											<td class="max-w-[16rem] truncate px-3 py-1.5 align-top text-ink-2" title={sampleOf(field.key)}>{sampleOf(field.key)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>

					{#if def.update}
						<fieldset>
							<legend class="field-label">Schon vorhandene</legend>
							<p class="text-sm text-ink-3">{def.matchHint}</p>
							<div class="mt-1 flex flex-wrap gap-4 text-sm">
								<label class="flex items-center gap-2"><input type="radio" name="vorhandene" value="ueberspringen" bind:group={update} />überspringen</label>
								<label class="flex items-center gap-2"
									><input type="radio" name="vorhandene" value="aktualisieren" bind:group={update} />aktualisieren (leere Felder ändern nichts{def.positions
										? ', Positionen werden ersetzt'
										: ''})</label
								>
							</div>
						</fieldset>
					{:else}
						<p class="text-sm text-ink-3">{def.matchHint}</p>
					{/if}

					<button class="btn btn-secondary" formaction="?/preview" disabled={busy !== ''}>
						<ScanSearch size={18} aria-hidden="true" />{busy === 'preview' ? 'Wird geprüft …' : 'Prüfen'}
					</button>
				</div>

				{#if result.preview}
					{@const pv = result.preview}
					<div class="space-y-3 border-t border-line pt-4">
						<h3 class="font-display text-lg font-semibold">{result.result ? 'Ergebnis' : 'Prüfung'}</h3>
						{#if result.result}
							<p class="flex items-center gap-2 rounded-xl bg-ok-soft p-3 font-medium text-ok" role="status">
								<CircleCheck size={20} aria-hidden="true" />
								{result.result.created} neu angelegt, {result.result.updated} aktualisiert, {result.result.skipped} übersprungen{result.result.failed
									? `, ${result.result.failed} mit Fehlern nicht übernommen`
									: ''}.
								<a href={LIST[kind]} class="ml-auto underline">Zu den {def.label}</a>
							</p>
						{/if}
						<div class="flex flex-wrap gap-2 text-sm">
							{#each Object.entries(ACTION_LABELS) as [action, label] (action)}
								{@const n = pv.counts[action as keyof typeof pv.counts]}
								{#if n}
									<span class="badge {action === 'neu' ? 'badge-ok' : action === 'aktualisieren' ? 'badge-info' : action === 'fehler' ? 'badge-danger' : ''}">{n} {label}</span>
								{/if}
							{/each}
						</div>
						{#if pv.items.length && !result.result}
							<div>
								<p class="text-sm font-medium">Zum Beispiel</p>
								<ul class="mt-1 space-y-0.5 text-sm text-ink-2">
									{#each pv.items as item, n (n)}
										<li>
											<span class="badge {item.action === 'neu' ? 'badge-ok' : item.action === 'aktualisieren' ? 'badge-info' : ''} mr-1"
												>{item.action === 'ueberspringen' ? 'vorhanden' : item.action}</span
											>{item.label}{item.positions ? ` · ${item.positions} Position${item.positions === 1 ? '' : 'en'}` : ''}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
						{#if pv.issues.length}
							<div>
								<p class="text-sm font-medium">Hinweise und Fehler</p>
								<ul class="mt-1 max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-line p-2 text-sm">
									{#each pv.issues as issue, n (n)}
										<li class="flex items-start gap-2 {issue.level === 'fehler' ? 'text-danger' : 'text-ink-2'}">
											{#if issue.level === 'fehler'}<CircleX size={15} class="mt-0.5 shrink-0" aria-hidden="true" />{:else}<Info size={15} class="mt-0.5 shrink-0" aria-hidden="true" />{/if}
											<span><span class="num text-ink-3">Zeile {issue.row}:</span> {issue.message}</span>
										</li>
									{/each}
									{#if pv.moreIssues}<li class="text-ink-3">… und {pv.moreIssues} weitere</li>{/if}
								</ul>
							</div>
						{/if}
						{#if !result.result}
							<button class="btn btn-primary" formaction="?/run" disabled={busy !== '' || !importable}>
								<Upload size={18} aria-hidden="true" />{busy === 'run' ? 'Wird importiert …' : importable ? `${importable} ${importable === 1 ? def.one : def.label} importieren` : 'Nichts zu importieren'}
							</button>
							<p class="text-[0.8125rem] text-ink-3">Alles oder nichts: Geht beim Schreiben etwas schief, bleibt alles, wie es war.</p>
						{/if}
					</div>
				{/if}
			{/if}
		</form>
	</section>
{/if}
