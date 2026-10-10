<script lang="ts">
	/**
	 * The tab bar's icons. Line drawings on a 24px grid in the text colour, so
	 * they follow the theme and the current tab's accent without a colour of
	 * their own -- and drawn inline rather than set from a glyph font, which
	 * would be one more file to ship for five pictures.
	 *
	 * Each says what its tab holds: today's page on the calendar; the timer; a
	 * drive as a route between two stops, the way the trip screens draw one; an
	 * invoice as a receipt; and the four places More opens onto.
	 */
	export type Tab = 'today' | 'time' | 'trips' | 'invoices' | 'more';

	let { name }: { name: Tab } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width="24"
	height="24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'today'}
		<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
		<path d="M8 3v4M16 3v4M3.5 10h17" />
		<rect x="13" y="13.5" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
	{:else if name === 'time'}
		<circle cx="12" cy="13.5" r="7.25" />
		<path d="M10 3h4M12 3v3.25M12 13.5l3-2.5M18.6 6.9l1.4-1.4" />
	{:else if name === 'trips'}
		<circle cx="6" cy="18" r="2.25" />
		<circle cx="18" cy="6" r="2.25" />
		<path d="M8.25 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.75" />
	{:else if name === 'invoices'}
		<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
		<path d="M9 8h6M9 11.5h6M9 15h3.5" />
	{:else}
		<rect x="3.5" y="3.5" width="7" height="7" rx="1.75" />
		<rect x="13.5" y="3.5" width="7" height="7" rx="1.75" />
		<rect x="3.5" y="13.5" width="7" height="7" rx="1.75" />
		<rect x="13.5" y="13.5" width="7" height="7" rx="1.75" />
	{/if}
</svg>
