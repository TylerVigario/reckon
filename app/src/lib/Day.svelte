<script lang="ts">
	import { dated, day } from './format';

	/**
	 * A date that gives up its year when there is no room for it.
	 *
	 * WHICH SHAPE A DATE TAKES IS THE CALL SITE'S -- a day inside a month the
	 * screen has already named does not repeat the year, one in a list spanning
	 * years does. That is why format.ts offers `day`, `dated` and `fullDay`
	 * rather than one function: the page knows what it means, the module does
	 * not.
	 *
	 * What the page CANNOT know is how wide the window is. In a row with a
	 * figure on the right, "17 Sept 2026" is what pushes the line to wrap on a
	 * phone while reading fine on a desktop. So both are rendered and CSS picks
	 * -- not a media-query store, because that resolves to nothing on the
	 * server and then changes on hydration, which is a flash and a mismatch.
	 * The cost is one extra span in the markup and no JavaScript at all.
	 */
	let { iso, class: klass = '' }: { iso: string | null | undefined; class?: string } = $props();
</script>

<span class={klass}
	><span class="wide">{dated(iso)}</span><span class="tight">{day(iso)}</span></span
>

<style>
	.tight {
		display: none;
	}
	@media (max-width: 620px) {
		.wide {
			display: none;
		}
		.tight {
			display: inline;
		}
	}
</style>
