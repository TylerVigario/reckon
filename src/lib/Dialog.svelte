<script lang="ts">
	/**
	 * Primer's Dialog, for a change that reaches further than the thing it is
	 * made on, or that is taken back only by someone noticing: who can see
	 * what, how someone is paid, whether they can sign in.
	 *
	 * SAYS WHAT HAPPENS, IN THE BUTTON TOO. The title asks the question, the
	 * body says what follows, and the buttons sit at the bottom right -- Cancel,
	 * then the action named for what it does, never "Yes".
	 *
	 * The first choice in it is focused, or else the action; a dangerous one
	 * focuses Cancel, so Enter changes nothing. Escape closes it. On a phone it
	 * rises from the bottom as a sheet, as Primer's narrow dialog does -- or,
	 * holding choices or fields to fill in, it fills the screen: Primer's
	 * "Dialogs that have one or more input fields should always use the
	 * full-screen variant".
	 */
	import type { Snippet } from 'svelte';
	import Octicon from './Octicon.svelte';

	let {
		open,
		title,
		go,
		going = go,
		working = false,
		tone = 'plain',
		ongo,
		onclose,
		children
	}: {
		open: boolean;
		title: string;
		/** What the action does: "Change role", "Deactivate". */
		go: string;
		/** While it happens: "Changing…". */
		going?: string;
		working?: boolean;
		tone?: 'plain' | 'danger';
		ongo: () => void;
		/** Cancel, the close button and Escape all come here. */
		onclose: () => void;
		children: Snippet;
	} = $props();

	const id = $props.id();
	let el = $state<HTMLDialogElement>();

	$effect(() => {
		if (!el) return;
		if (open && !el.open) {
			el.showModal();
			const first =
				el.querySelector<HTMLElement>('.body input:checked, .body input') ??
				el.querySelector<HTMLElement>(tone === 'danger' ? '[data-cancel]' : '[data-go]');
			first?.focus();
		} else if (!open && el.open) el.close();
	});
</script>

<dialog bind:this={el} aria-labelledby={id} {onclose}>
	<header>
		<h2 {id}>{title}</h2>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>
			<Octicon name="x" />
		</button>
	</header>
	<div class="body primer">{@render children()}</div>
	<footer>
		<button type="button" class="btn" data-cancel onclick={onclose} disabled={working}
			>Cancel</button
		>
		<button
			type="button"
			class="btn"
			class:pri={tone === 'plain'}
			class:danger={tone === 'danger'}
			class:solid={tone === 'danger'}
			data-go
			onclick={ongo}
			disabled={working}>{working ? going : go}</button
		>
	</footer>
</dialog>

<style>
	dialog {
		width: min(440px, calc(100vw - 32px));
		padding: 0;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: 0 8px 24px rgb(20 26 43 / 0.24);
	}
	dialog::backdrop {
		background: rgb(20 26 43 / 0.45);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 8px 8px 8px 16px;
	}
	h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	.x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		color: var(--ink-3);
		background: none;
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ink);
		background: var(--surface-2);
	}
	.body {
		padding: 0 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 14px;
	}
	.body :global(p) {
		margin: 0;
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
		padding: 16px;
		border-top: 1px solid var(--line-soft);
	}
	footer .btn {
		border-radius: 6px;
	}
	footer .btn:not(.pri, .danger) {
		background: var(--surface-2);
	}
	@media (pointer: coarse) {
		.x {
			width: 44px;
			height: 44px;
		}
		footer .btn {
			min-height: 44px;
		}
	}
	@media (max-width: 543px) {
		dialog {
			width: 100%;
			max-width: 100%;
			margin: auto 0 0;
			border-bottom: 0;
			border-radius: 12px 12px 0 0;
		}
		footer .btn {
			flex: 1 1 0;
		}
		dialog[open]:has(.body :global(input)) {
			display: flex;
			flex-direction: column;
			height: 100%;
			max-height: 100%;
			margin: 0;
			border: 0;
			border-radius: 0;
		}
		dialog:has(.body :global(input)) .body {
			flex: 1 1 auto;
			overflow-y: auto;
		}
	}
</style>
