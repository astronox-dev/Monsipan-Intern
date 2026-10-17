<script lang="ts">
	/** Ein Unterschriftsfeld: gesetzt mit Name und Zeit, sonst „Unterschreiben" */
	import Signature from '@lucide/svelte/icons/signature';
	import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '$lib/modules/stunden/signature';
	import { dateTime } from '$lib/format';
	import type { WorkSignature } from '../work-order';

	interface Props {
		label: string;
		signature: WorkSignature | undefined;
		canSign: boolean;
		canRemove: boolean;
		busy?: boolean;
		onsign: () => void;
		onremove: () => void;
	}
	let { label, signature, canSign, canRemove, busy = false, onsign, onremove }: Props = $props();
</script>

<div class="rounded-xl border border-line p-3">
	<p class="text-sm font-medium">{label}</p>
	{#if signature}
		<svg viewBox="0 0 {SIGNATURE_WIDTH} {SIGNATURE_HEIGHT}" class="mt-2 h-14 w-full max-w-[13rem] rounded-lg bg-white" role="img" aria-label="Unterschrift {signature.name}">
			<path d={signature.path} fill="none" stroke="#1d2127" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
		<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
			<p class="min-w-0 flex-1 text-sm text-ink-2"><span class="font-medium text-ink">{signature.name}</span> · {dateTime(signature.at)}</p>
			{#if canRemove}
				<button type="button" class="btn btn-ghost btn-sm -mr-2" onclick={onremove}>Entfernen</button>
			{/if}
		</div>
	{:else if canSign}
		<button type="button" class="btn btn-secondary btn-sm mt-2" disabled={busy} onclick={onsign}>
			<Signature size={16} aria-hidden="true" />Unterschreiben
		</button>
	{:else}
		<p class="mt-1 text-sm text-ink-3">Noch nicht unterschrieben.</p>
	{/if}
</div>
