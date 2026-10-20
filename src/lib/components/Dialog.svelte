<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		description?: string;
		/** Auf dem Handy als Bottom-Sheet von unten */
		bottom?: boolean;
		wide?: boolean;
		/** Noch breiter – etwa für die PDF-Vorschau */
		huge?: boolean;
		onclose?: () => void;
		children: Snippet;
		footer?: Snippet;
	}
	let { open = $bindable(), title, description, bottom = true, wide = false, huge = false, onclose, children, footer }: Props = $props();

	let dialog: HTMLDialogElement;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			// Erstes Eingabefeld statt des Schließen-Knopfs fokussieren
			requestAnimationFrame(() => {
				const field = dialog.querySelector<HTMLElement>(
					'[autofocus], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea'
				);
				field?.focus();
			});
		}
		if (!open && dialog.open) dialog.close();
	});

	function handleClose() {
		open = false;
		onclose?.();
	}

	function onBackdrop(e: MouseEvent) {
		if (e.target === dialog) dialog.close();
	}
</script>

<dialog
	bind:this={dialog}
	class="sheet {bottom ? 'sheet-bottom' : ''}"
	style:max-width={huge ? 'min(1100px, calc(100vw - 2rem))' : wide ? 'min(760px, calc(100vw - 2rem))' : null}
	aria-labelledby="dlg-title"
	onclose={handleClose}
	onclick={onBackdrop}
>
	{#if open}
		<div class="flex max-h-[inherit] flex-col">
			<header class="flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6">
				<div class="min-w-0 flex-1">
					<h2 id="dlg-title" class="text-xl leading-tight">{title}</h2>
					{#if description}<p class="mt-1 text-sm text-ink-2">{description}</p>{/if}
				</div>
				<button type="button" class="btn btn-ghost btn-sm btn-icon -mt-1 -mr-2" aria-label="Schließen" onclick={() => dialog.close()}>
					<X size={18} />
				</button>
			</header>
			<div class="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
				{@render children()}
			</div>
			{#if footer}
				<footer class="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3 sm:px-6">
					{@render footer()}
				</footer>
			{/if}
		</div>
	{/if}
</dialog>
