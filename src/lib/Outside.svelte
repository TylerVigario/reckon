<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A LINK TO SOMEBODY ELSE'S PAGE -- a state's table of rates, its address
	 * lookup -- opened in a new tab, so the page it was followed from is still
	 * there to type into. Never one of ours, which go through resolve(): its
	 * address is https and somewhere else. It sends no referrer and gives the
	 * page it opens no hold on this one (noopener, noreferrer).
	 */
	let {
		href,
		class: cls,
		children
	}: { href: `https://${string}`; class?: string; children: Snippet } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- somebody else's page, which no route of ours resolves -->
<a {href} class={cls} target="_blank" rel="noopener noreferrer">{@render children()}</a>
