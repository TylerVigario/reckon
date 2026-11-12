<script lang="ts">
	import type { ResolvedPathname } from '$app/types';

	/**
	 * Primer's SegmentedControl: one list in two or three scopes -- everyone's
	 * entries or your own -- the one shown pressed in. Not tabs: the list is
	 * the same thing either way, only how much of it is shown changes. Each
	 * scope is an address, so it is a link, and the one shown is the current
	 * page. Drawn inside .primer (#lib/primer.css).
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
