<script lang="ts">
	import type { ResolvedPathname } from '$app/types';

	/**
	 * Primer's SegmentedControl: one thing seen two or three ways -- everyone's
	 * entries or your own, pay by person or by job -- the one shown pressed in.
	 * Not tabs: it is the same thing whichever way, only how it is cut changes.
	 * Each way is an address, so it is a link, and the one shown is the current
	 * page. Drawn by #lib/primer.css.
	 */
	let {
		label,
		items
	}: {
		/** What is being scoped: "Whose entries". */
		label: string;
		items: { href: ResolvedPathname; label: string; current: boolean }[];
	} = $props();
</script>

<nav class="seg" aria-label={label}>
	{#each items as it (it.href)}
		<a href={it.href} aria-current={it.current ? 'page' : undefined}>{it.label}</a>
	{/each}
</nav>
