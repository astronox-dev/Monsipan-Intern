<script lang="ts">
	import { pageTitle } from '$lib/app';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import WorkOrderCreateForm from '$lib/modules/auftraege/components/WorkOrderCreateForm.svelte';
	import { spacedNumber } from '$lib/modules/auftraege/offer';

	let { data, form } = $props();

	// Liegen am Auftrag schon Pläne, ist das Häkchen gleich gesetzt
	// svelte-ignore state_referenced_locally
	const content = data.order.hasPlans ? { ...data.content, attachments: { ...data.content.attachments, plans: true } } : data.content;
</script>

<svelte:head><title>{pageTitle(`Arbeitsauftrag erstellen – ${spacedNumber(data.order.number)}`)}</title></svelte:head>

<a href="/auftraege/{data.order.id}" class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
	<ArrowLeft size={16} aria-hidden="true" />Auftrag {spacedNumber(data.order.number)}
</a>

<div class="mt-3 mb-5">
	<h1 class="text-[2rem] leading-tight">Arbeitsauftrag erstellen</h1>
	<p class="text-ink-2">Nr. {spacedNumber(data.order.number)} · {data.order.title || 'Ohne BV'}{data.order.partyName ? ` · ${data.order.partyName}` : ''}</p>
</div>

<p class="card mb-4 flex items-start gap-3 p-4 text-sm text-ink-2">
	<ClipboardList size={18} class="mt-0.5 shrink-0" aria-hidden="true" />
	<span>
		Vor dem Erstellen ausfüllen – danach stehen die Leistungen fest. Beilagen, Evaluierung und Rückseite sind vom letzten Arbeitsauftrag
		übernommen. Die Partie sieht dann nicht den ganzen Auftrag, sondern nur diesen Arbeitsauftrag{data.order.partyName
			? ''
			: ', sobald der Auftrag einer Partie zugeteilt ist'}.
	</span>
</p>

<WorkOrderCreateForm
	{content}
	colors={data.colors}
	me={data.me}
	submitLabel="Arbeitsauftrag erstellen"
	message={form && 'message' in form ? String(form.message ?? '') : ''}
	cancelHref="/auftraege/{data.order.id}"
/>
