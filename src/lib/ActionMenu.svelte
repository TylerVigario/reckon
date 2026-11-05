<script lang="ts">
	/**
	 * Primer's ActionMenu: a button that opens a list of what can be done to
	 * one thing -- a person, a row.
	 *
	 * A POPOVER, so the list sits above everything, whatever clips the button,
	 * and a tap outside it or Escape closes it. The arrow keys move through it,
	 * as a menu's do.
	 *
	 * WHAT CAN'T BE TAKEN STILL SHOWS, with why under it, rather than vanishing:
	 * an action missing from its menu reads as one that does not exist. A
	 * dangerous one is red and set apart by a divider.
	 */
	import Octicon from './Octicon.svelte';

	type Action = {
		label: string;
		danger?: boolean;
		/** Why it can't be taken here, shown under it. */
		inactive?: string;
		onselect?: () => void;
	};
	let { label, items }: { label: string; items: (Action | 'divider')[] } = $props();

	const id = $props.id();
	let button = $state<HTMLButtonElement>();
	let list = $state<HTMLUListElement>();
	let at = $state({ top: 0, right: 0 });

	function place(e: ToggleEvent) {
		if (e.newState !== 'open' || !button) return;
		const r = button.getBoundingClientRect();
		at = { top: r.bottom + 4, right: Math.max(8, innerWidth - r.right) };
	}
	function arrive(e: ToggleEvent) {
		if (e.newState === 'open') entries()[0]?.focus();
	}
	const entries = () => [...(list?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
	function move(e: KeyboardEvent) {
		const all = entries();
		const i = all.indexOf(document.activeElement as HTMLButtonElement);
		const to =
			e.key === 'ArrowDown'
				? (i + 1) % all.length
				: e.key === 'ArrowUp'
					? (i - 1 + all.length) % all.length
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? all.length - 1
							: -1;
		if (to < 0) return;
		e.preventDefault();
		all[to].focus();
	}
	function choose(a: Action) {
		if (a.inactive) return;
		list?.hidePopover();
		button?.focus();
		a.onselect?.();
	}
</script>

<button
	bind:this={button}
	type="button"
	class="trigger"
	popovertarget={id}
	aria-haspopup="menu"
	aria-label={label}
>
	<Octicon name="kebab" />
</button>
<ul
	bind:this={list}
	{id}
	popover="auto"
	role="menu"
	aria-label={label}
	style:top="{at.top}px"
	style:right="{at.right}px"
	onbeforetoggle={place}
	ontoggle={arrive}
	onkeydown={move}
>
	{#each items as a, i (i)}
		{#if a === 'divider'}
			<li role="separator"></li>
		{:else}
			<li role="none">
				<button
					type="button"
					role="menuitem"
					class:danger={a.danger}
					aria-disabled={a.inactive ? 'true' : undefined}
					onclick={() => choose(a)}
				>
					<span>{a.label}</span>
					{#if a.inactive}<span class="why">{a.inactive}</span>{/if}
				</button>
			</li>
		{/if}
	{/each}
</ul>

<style>
	.trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		padding: 0;
		color: var(--ink-2);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 6px;
		cursor: pointer;
	}
	.trigger:hover {
		color: var(--ink);
		background: var(--surface-2);
	}
	.trigger:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	ul {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 8px 0;
		min-width: 200px;
		max-width: min(320px, calc(100vw - 16px));
		list-style: none;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: 0 8px 24px rgb(20 26 43 / 0.18);
	}
	li[role='separator'] {
		height: 1px;
		margin: 8px 0;
		background: var(--line-soft);
	}
	button[role='menuitem'] {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 2px;
		width: calc(100% - 16px);
		min-height: 36px;
		margin: 0 8px;
		padding: 6px 8px;
		font: inherit;
		font-size: 14px;
		text-align: left;
		color: inherit;
		background: none;
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}
	button[role='menuitem']:hover,
	button[role='menuitem']:focus-visible {
		background: var(--surface-2);
		outline: none;
	}
	button.danger {
		color: var(--crit);
	}
	button.danger:hover,
	button.danger:focus-visible {
		background: var(--crit-wash);
	}
	button[aria-disabled='true'] {
		color: var(--ink-3);
		cursor: not-allowed;
	}
	.why {
		font-size: 12px;
		color: var(--ink-3);
	}
	@media (pointer: coarse) {
		.trigger {
			width: 44px;
			height: 44px;
		}
		button[role='menuitem'] {
			min-height: 44px;
		}
	}
</style>
