<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The second tap. The first, on a button that does something reaching past
	 * the thing itself, or that cannot be taken back, only asks: this says what
	 * will happen, and nothing is sent until its own button is pressed.
	 *
	 * ONLY WHERE IT MATTERS. Routine actions, undone as easily as done and
	 * touching nothing else, are not asked about: a question asked every time
	 * stops being read, and then it guards nothing.
	 *
	 * SAYS WHAT HAPPENS, IN THE BUTTONS TOO. The words above them name what
	 * changes and what else it reaches; the buttons are named for their outcome,
	 * "Keep it" and "Retire it", never yes and no.
	 *
	 * BROUGHT TO WHERE THE PERSON IS. The button that asks is often in the
	 * screen's header, which stays on screen however far down the page is
	 * scrolled, and this appears at the top of the page. So it scrolls itself into
	 * the middle of the screen, clear of the header, and the way out is focused:
	 * pressing Enter keeps things as they are.
	 */
	let {
		tone = 'plain',
		keep,
		go,
		going = go,
		working = false,
		ready = true,
		onkeep,
		ongo,
		children
	}: {
		/**
		 * 'danger' for what destroys something for good, as a delete does; 'plain' for
		 * what reaches further, or commits to something, as recording a payment does.
		 */
		tone?: 'danger' | 'plain';
		/** The way out, as what stays: "Keep it", "Keep offering it". */
		keep: string;
		/** What happens: "Retire it", "Delete it for good". */
		go: string;
		/** While it happens: "Deleting…". */
		going?: string;
		working?: boolean;
		/** False until whatever it asks for is given, such as a date. */
		ready?: boolean;
		onkeep: () => void;
		ongo: () => void;
		/** What will happen, and any field it needs. */
		children: Snippet;
	} = $props();

	const id = $props.id();

	function arrive(node: HTMLElement) {
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		node.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
		node.querySelector<HTMLButtonElement>('[data-keep]')?.focus({ preventScroll: true });
	}
</script>

<div class="ask" class:danger={tone === 'danger'} role="group" aria-labelledby={id} use:arrive>
	<div class="what" {id}>{@render children()}</div>
	<div class="btnrow">
		<button type="button" class="btn" data-keep onclick={onkeep} disabled={working}>{keep}</button>
		<button
			type="button"
			class="btn"
			class:pri={tone === 'plain'}
			class:danger={tone === 'danger'}
			class:solid={tone === 'danger'}
			onclick={ongo}
			disabled={working || !ready}>{working ? going : go}</button
		>
	</div>
</div>

<style>
	.ask {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: 14px;
		margin-bottom: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.ask.danger {
		border-color: var(--crit);
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.what :global(p) {
		margin: 0;
		font-size: 14px;
	}
	.btnrow {
		flex-wrap: wrap;
	}
</style>
