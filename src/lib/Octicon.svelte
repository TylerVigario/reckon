<script lang="ts">
	/**
	 * One Octicon (#lib/octicons, Primer's own), drawn in the colour of the text
	 * around it: at 16px, or at 24px where Octicons draws one that size.
	 */
	import { OCTICON, OCTICON_24, type Octicon24Name, type OcticonName } from './octicons';

	let props: { name: OcticonName; size?: 16 } | { name: Octicon24Name; size: 24 } = $props();
	const drawn = $derived(props.size === 24 ? OCTICON_24[props.name] : OCTICON[props.name]);
</script>

<svg
	viewBox="0 0 {props.size ?? 16} {props.size ?? 16}"
	width={props.size ?? 16}
	height={props.size ?? 16}
	aria-hidden="true"
	focusable="false"
>
	{#each drawn as d (d)}<path {d} />{/each}
</svg>

<style>
	svg {
		flex: 0 0 auto;
		fill: currentColor;
	}
</style>
