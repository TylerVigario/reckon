<script lang="ts">
	import type { Snippet } from 'svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import type { Tab } from '#lib/section-tabs.ts';

	/**
	 * A record's head, under its title (#lib/Top): where it stands, in a line,
	 * then its tabs, each its own address (#lib/UnderlineNav) -- as Primer draws
	 * a record, and as every record with tabs here reads: a person on Team, a
	 * client, someone's pay, your own profile.
	 *
	 * Laid out by the screen around it: its parts sit in the screen's own column,
	 * spaced as the rest of the screen is.
	 */
	let {
		label,
		tabs,
		state
	}: {
		/** What these are the tabs of: "Sam Ortega’s record". */
		label: string;
		tabs: Tab[];
		/** Where the record stands, as a line: a status, a figure, what is waiting. */
		state?: Snippet;
	} = $props();
</script>

<div class="rh primer">
	{#if state}<div class="state">{@render state()}</div>{/if}
	<UnderlineNav {label} items={tabs} />
</div>

<style>
	.rh {
		display: contents;
	}
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
</style>
