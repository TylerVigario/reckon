<script lang="ts">
	/** One Octicon (#lib/octicons), drawn in the colour of the text around it. */
	import { OCTICON, type OcticonName } from './octicons';

	let { name }: { name: OcticonName } = $props();
</script>

<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
	<path d={OCTICON[name]} />
</svg>

<style>
	svg {
		flex: 0 0 auto;
		fill: currentColor;
	}
</style>
