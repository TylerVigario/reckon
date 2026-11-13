<script lang="ts">
	/**
	 * Primer's UnderlinePanels: tabs that switch the parts of one screen without
	 * changing its address -- where UnderlineNav's tabs are addresses of their
	 * own -- as the parts of one form are, which all go when it is sent.
	 *
	 * The row only: each part is the screen's own element, with role="tabpanel",
	 * the id panelId gives it, and `hidden` when its tab is not the one chosen,
	 * so a hidden part's fields are still in the form. Keyboard as WAI-ARIA's
	 * tabs pattern has it: the arrow keys move along the row and choose as they
	 * go, Home and End go to either end, and only the chosen tab is a tab stop.
	 */
	let {
		label,
		tabs,
		selected = $bindable(),
		id
	}: {
		/** What these are the parts of: "Receiving stock". */
		label: string;
		tabs: { id: string; label: string; count?: number; flagged?: boolean }[];
		/** The tab chosen, by its id. */
		selected: string;
		/** What the row's and its panels' ids start with. */
		id: string;
	} = $props();

	let row = $state<HTMLDivElement>();
	function move(e: KeyboardEvent) {
		const i = tabs.findIndex((t) => t.id === selected);
		const to =
			e.key === 'ArrowRight'
				? (i + 1) % tabs.length
				: e.key === 'ArrowLeft'
					? (i - 1 + tabs.length) % tabs.length
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? tabs.length - 1
							: -1;
		if (to === -1) return;
		e.preventDefault();
		selected = tabs[to].id;
		row?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
	}
</script>

<div
	class="unav panels"
	role="tablist"
	aria-label={label}
	bind:this={row}
	tabindex="-1"
	onkeydown={move}
>
	{#each tabs as t (t.id)}
		<button
			type="button"
			role="tab"
			id="{id}-tab-{t.id}"
			aria-selected={t.id === selected}
			aria-controls="{id}-panel-{t.id}"
			tabindex={t.id === selected ? 0 : -1}
			onclick={() => (selected = t.id)}
		>
			{t.label}
			{#if t.count !== undefined}<span class="count">{t.count}</span>{/if}
			{#if t.flagged}<span class="flag" aria-label="needs a look">!</span>{/if}
		</button>
	{/each}
</div>

<style>
	button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		padding: 0 8px;
		white-space: nowrap;
		font: inherit;
		color: var(--ink-2);
		background: none;
		border: 0;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}
	button:hover {
		color: var(--ink);
	}
	button[aria-selected='true'] {
		color: var(--ink);
		font-weight: 600;
		border-bottom-color: var(--accent);
	}
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.flag {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		font-size: 12px;
		font-weight: 700;
		color: var(--surface);
		background: var(--crit);
		border-radius: 999px;
	}
</style>
