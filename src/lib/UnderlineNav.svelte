<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	/**
	 * Primer's UnderlineNav: the views of one section -- Team's people and its
	 * roles -- as links in a row, the current one underlined, each with how
	 * many there are. Drawn inside .primer (#lib/primer.css).
	 *
	 * Links, not tabs: each view is a screen of its own, with its own address,
	 * so it can be bookmarked and gone back to.
	 */
	let {
		label,
		items
	}: {
		/** What these are the views of: "Team". */
		label: string;
		items: { href: ResolvedPathname; label: string; count?: number; current: boolean }[];
	} = $props();
</script>

<nav class="unav" aria-label={label}>
	{#each items as it (it.href)}
		<a href={it.href} aria-current={it.current ? 'page' : undefined}
			>{it.label}
			{#if it.count !== undefined}<span class="count">{it.count}</span>{/if}</a
		>
	{/each}
</nav>
