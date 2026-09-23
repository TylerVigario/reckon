<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';

	let { data, children }: LayoutProps = $props();

	// The operator may set the one hue; the mock's own is what it falls back to.
	// Both are true at once -- the palette below is the target's, and an operator
	// who has chosen a colour still gets theirs.
	const accent = $derived(data.operator?.accent_colour || '');
	const name = $derived(data.operator?.trading_name ?? 'reckon');

	// Five tabs, as drawn. Trips and Invoices have no screens behind them yet
	// and say so rather than being left off -- a tab bar that grows as the work
	// is done hides where the work is going.
	const nav = [
		{ href: '/', label: 'Today', ic: 'i1' },
		{ href: '/timesheet', label: 'Time', ic: 'i2' },
		{ href: '/trips', label: 'Trips', ic: 'i3' },
		{ href: '/invoices', label: 'Invoices', ic: 'i4' },
		{ href: '/more', label: 'More', ic: 'i9' }
	] satisfies { href: Pathname; label: string; ic: string }[];

	// The rail flattens what the tab bar nests: on a screen with room, More is
	// not a place, it is four more rows.
	const rail = [
		{ href: '/', label: 'Today', count: () => counts.drafts },
		{ href: '/timesheet', label: 'Time', count: () => hours(counts.monthMinutes) },
		{ href: '/trips', label: 'Trips', count: () => null },
		{ href: '/invoices', label: 'Invoices', count: () => counts.drafts },
		{ href: '/catalogue', label: 'Catalogue', count: () => null },
		{ href: '/clients', label: 'Entities', count: () => counts.entities },
		{ href: '/reports', label: 'Reports', count: () => null },
		{ href: '/settings', label: 'Settings', count: () => null }
	] satisfies { href: Pathname; label: string; count: () => string | number | null | undefined }[];

	const counts = $derived(data.counts ?? {});
	const hours = (m: number | undefined) => (m === undefined ? null : `${Math.round(m / 60)}h`);

	// Two letters, from a name nobody has to configure.
	const initials = $derived(
		(data.user?.name ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w: string) => w[0]?.toUpperCase() ?? '')
			.join('')
	);

	// Everything reached through More lights More, the way the mock does it.
	const UNDER_MORE = ['/more', '/catalogue', '/clients', '/services', '/settings'];
	// And a screen that hangs off Today lights Today. Unbilled work is Today's
	// second tile opened up -- it spans time and mileage, so it belongs to
	// neither of their tabs.
	const UNDER_TODAY = ['/unbilled'];
	const here = $derived((href: string) => {
		if (href === '/more') return UNDER_MORE.some((p) => page.url.pathname.startsWith(p));
		if (href === '/')
			return page.url.pathname === '/' || UNDER_TODAY.some((p) => page.url.pathname.startsWith(p));
		return page.url.pathname.startsWith(href);
	});
</script>

<svelte:head><title>{name}</title></svelte:head>

{#if !data.user}
	<!-- Signed out, there is nothing to navigate to. The shell would be a header
	     and a row of links that all bounce back to here. -->
	{@render children()}
{:else}
	<div class="app" style={accent ? `--accent: ${accent}` : ''}>
		<div class="rail">
			<div class="rail-mark">
				{#if data.operator?.has_logo}
					<img class="logo" src="/operator/logo" alt={name} />
				{/if}
				<span>{name}</span>
			</div>
			<nav class="rail-nav" aria-label="Sections">
				{#each rail as r (r.href)}
					{@const n = r.count()}
					<a href={resolve(r.href)} aria-current={here(r.href) ? 'page' : undefined}>
						{r.label}{#if n !== null && n !== undefined}<span class="cnt">{n}</span>{/if}
					</a>
				{/each}
			</nav>
			<form class="rail-foot" method="POST" action="/logout">
				<span class="avatar" aria-hidden="true">{initials}</span>
				<span class="who">{data.user?.name}</span>
				<button type="submit">Sign out</button>
			</form>
		</div>

		<main>{@render children()}</main>

		<nav class="tabbar" aria-label="Sections">
			{#each nav as n (n.href)}
				<a href={resolve(n.href)} aria-current={here(n.href) ? 'page' : undefined}>
					<span class="ic {n.ic}" aria-hidden="true"></span>{n.label}
				</a>
			{/each}
		</nav>
	</div>
{/if}

<style>
	/* Press's own faces, subset to what the interface draws. The same Montserrat
	   and Open Sans the PDF is set in, because both come out of @vts/press --
	   an invoice on screen and the same invoice on paper should not be set in
	   two different voices. */
	@font-face {
		font-family: 'VTS Display';
		src: url('/fonts/vts-display-400.woff2') format('woff2');
		font-weight: 400;
		font-display: swap;
	}
	@font-face {
		font-family: 'VTS Display';
		src: url('/fonts/vts-display-700.woff2') format('woff2');
		font-weight: 700;
		font-display: swap;
	}
	@font-face {
		font-family: 'VTS Text';
		src: url('/fonts/vts-text-400.woff2') format('woff2');
		font-weight: 400;
		font-display: swap;
	}
	@font-face {
		font-family: 'VTS Text';
		src: url('/fonts/vts-text-700.woff2') format('woff2');
		font-weight: 700;
		font-display: swap;
	}
	@font-face {
		font-family: 'VTS Mono';
		src: url('/fonts/vts-mono-400.woff2') format('woff2');
		font-weight: 400;
		font-display: swap;
	}

	:global(:root) {
		--paper: #eef1f5;
		--surface: #fff;
		--surface-2: #f4f6fa;
		--sunken: #e6eaf1;
		--line: #d4dae4;
		--line-soft: #e4e8ef;
		--ink: #141a2b;
		--ink-2: #4a5468;
		--ink-3: #7b8698;
		--brand: #2382b3;
		--brand-deep: #185c8b;
		--display-ink: #2e3a68;
		--accent: #1d6f9c;
		--accent-ink: #fff;
		--accent-wash: #e2eef6;
		--accent-line: #a9cde3;
		--good: #2e7554;
		--good-wash: #dcede3;
		--warn: #8a6614;
		--warn-wash: #f5e9cc;
		--crit: #a2382f;
		--crit-wash: #f7dedb;
		--f-display: 'VTS Display', 'Montserrat', system-ui, sans-serif;
		--f-text: 'VTS Text', 'Open Sans', system-ui, sans-serif;
		--f-mono: 'VTS Mono', 'Liberation Mono', ui-monospace, monospace;
		--r: 10px;
		--pad: 16px;
		--tabh: 60px;
		/* The reading column. The mock caps by content type -- records, prose,
		   documents, controls -- and this is the widest of them. It read 960
		   there because it sat inside a 1280 frame with 42px of slack; without
		   the frame that number leaves a desert down both sides of a wide
		   monitor, so it is the one figure retuned. The narrower caps below are
		   untouched: prose at 760 is a line-length rule, not a layout one. */
		--col: 1200px;
		color-scheme: light dark;

		/* The names the pages used before the mock's palette landed. Aliases
		   rather than a rename in nineteen files at once: a page is converted
		   when it is converted, and until then it paints in the right colours
		   instead of in nothing at all. These go when the last page stops
		   naming them. */
		--ground: var(--paper);
		--card: var(--surface);
		--ink-soft: var(--ink-2);
		--ink-faint: var(--ink-3);
		--radius: var(--r);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--paper: #0d1219;
			--surface: #161d29;
			--surface-2: #1c2431;
			--sunken: #111823;
			--line: #2c3646;
			--line-soft: #222b39;
			--ink: #e4e9f2;
			--ink-2: #9daabd;
			--ink-3: #6f7c90;
			--brand: #4ea3d1;
			--brand-deep: #2382b3;
			--display-ink: #e4e9f2;
			--accent: #5aaed6;
			--accent-ink: #06202e;
			--accent-wash: #13303f;
			--accent-line: #2c5f7d;
			--good: #63c294;
			--good-wash: #143326;
			--warn: #d9a93f;
			--warn-wash: #3a2e0f;
			--crit: #e0796d;
			--crit-wash: #3d1b17;
		}
	}

	:global(body) {
		margin: 0;
		background: var(--paper);
		color: var(--ink);
		font-family: var(--f-text);
		font-size: 16px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
		-webkit-text-size-adjust: 100%;
	}
	:global(a) {
		color: var(--accent);
	}

	/* ================================================================ system ==
	   The mock's own components, global so a page uses them by naming them
	   rather than by restating them. Svelte scopes styles per component, and a
	   design system copied into nine files is nine files to get out of step. */

	/* The content area under a screen's .top. */
	:global(.pad) {
		padding: var(--pad);
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	:global(.pad > *) {
		max-width: var(--col);
	}

	/* A header and a list of records. Full bleed on a phone: a card inside a
	   card is what makes a small screen feel cramped. */
	:global(.sec) {
		display: flex;
		flex-direction: column;
	}
	:global(.sec-h) {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
		padding: 0 2px 8px;
	}
	:global(.sec-h h2) {
		font-family: var(--f-mono);
		font-size: 10.5px;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--ink-3);
		font-weight: 400;
		margin: 0;
	}
	:global(.sec-h .sp) {
		margin-left: auto;
	}
	:global(.rows) {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r);
		overflow: hidden;
	}

	/* The one row component. Every list in this app is made of these: unbilled
	   work, invoice lines, catalogue items, trip legs, report figures. */
	:global(.rec) {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--line-soft);
		min-height: 56px;
		box-sizing: border-box;
		color: inherit;
		text-decoration: none;
	}
	:global(.rec:last-child) {
		border-bottom: 0;
	}
	:global(.rec.warn) {
		background: var(--warn-wash);
	}
	:global(.rec.crit) {
		background: var(--crit-wash);
	}
	:global(.rec.acc) {
		background: var(--accent-wash);
	}
	:global(.rec.tot) {
		background: var(--sunken);
	}
	:global(.rec.tot .rec-t),
	:global(.rec.tot .rec-v) {
		font-weight: 700;
	}
	:global(.rec.gone) {
		opacity: 0.5;
	}
	:global(.rec.link) {
		align-items: center;
	}
	:global(.rec .arw) {
		color: var(--ink-3);
		font-family: var(--f-mono);
		font-size: 16px;
		align-self: center;
	}
	:global(.rec-m) {
		flex: 1 1 auto;
		min-width: 0;
	}
	:global(.rec-t) {
		font-size: 15px;
		font-weight: 600;
		line-height: 1.3;
	}
	:global(.rec-t .lt) {
		font-weight: 400;
		color: var(--ink-3);
	}
	:global(.rec-s) {
		font-size: 13.5px;
		color: var(--ink-3);
		margin-top: 3px;
		line-height: 1.4;
	}
	/* a record can carry a second line of chips */
	:global(.rec-c) {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 7px;
	}
	:global(.rec-n) {
		flex: 0 0 auto;
		text-align: right;
	}
	:global(.rec-v) {
		font-family: var(--f-mono);
		font-variant-numeric: tabular-nums;
		font-size: 15px;
		font-weight: 700;
		white-space: nowrap;
		display: block;
	}
	:global(.rec-x) {
		font-family: var(--f-mono);
		font-variant-numeric: tabular-nums;
		font-size: 12px;
		color: var(--ink-3);
		white-space: nowrap;
		display: block;
		margin-top: 3px;
	}
	:global(.rec-v.mut),
	:global(.rec-x.mut) {
		color: var(--ink-3);
		font-weight: 400;
	}

	:global(.chip) {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 3px 7px;
		border-radius: 11px;
		border: 1px solid var(--line);
		color: var(--ink-2);
		background: var(--surface-2);
		white-space: nowrap;
	}
	:global(.chip.good) {
		color: var(--good);
		border-color: var(--good);
		background: var(--good-wash);
	}
	:global(.chip.warn) {
		color: var(--warn);
		border-color: var(--warn);
		background: var(--warn-wash);
	}
	:global(.chip.crit) {
		color: var(--crit);
		border-color: var(--crit);
		background: var(--crit-wash);
	}
	:global(.chip.acc) {
		color: var(--accent);
		border-color: var(--accent-line);
		background: var(--accent-wash);
	}
	:global(.chip .dot) {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
	}

	:global(.none) {
		margin: 0;
		color: var(--ink-3);
		font-size: 14.5px;
		max-width: 46ch;
	}

	/* A figure, big enough to read across a workshop. */
	:global(.tiles) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	:global(.tile) {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: 13px 14px;
	}
	:global(.tile.wide) {
		grid-column: 1 / -1;
	}
	:global(.tile .k) {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
		display: block;
		margin-bottom: 7px;
	}
	:global(.tile .v) {
		font-family: var(--f-mono);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: 24px;
		letter-spacing: -0.02em;
		line-height: 1.05;
		display: block;
	}
	:global(.tile .v.sm) {
		font-size: 19px;
	}
	:global(.tile .v.good) {
		color: var(--good);
	}
	:global(.tile .v.crit) {
		color: var(--crit);
	}
	:global(.tile .s) {
		font-size: 12.5px;
		color: var(--ink-3);
		margin-top: 5px;
		display: block;
	}

	/* Two lists side by side where there is room, stacked where there is not. */
	:global(.duo) {
		display: grid;
		gap: 18px;
	}
	:global(.duo > *) {
		min-width: 0;
	}

	:global(.seeall) {
		margin-left: auto;
		font-size: 13px;
		color: var(--accent);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 32px;
	}
	:global(.seeall)::after {
		content: '\2039';
		transform: rotate(180deg);
		font-size: 17px;
		line-height: 1;
	}

	:global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		font-family: var(--f-text);
		font-size: 14px;
		font-weight: 600;
		min-height: 40px;
		padding: 8px 14px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
		cursor: pointer;
	}
	:global(.btn.pri) {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	:global(.btn.gho) {
		background: transparent;
		color: var(--ink-2);
	}
	:global(.btn.sm) {
		min-height: 34px;
		padding: 5px 11px;
		font-size: 13px;
	}
	:global(.btn.blk) {
		width: 100%;
		min-height: 50px;
		font-size: 16px;
	}
	:global(.btnrow) {
		display: flex;
		gap: 10px;
	}

	/* ============================================================= controls ==
	   Everything is at least 48px tall. These are tapped with a thumb, often a
	   cold one, standing on a roof. */
	/* A card of fields rather than a list of rows. Every settings page had its
	   own copy of this, which is how four pages end up disagreeing about a
	   padding -- and how a new page gets it wrong by not knowing to copy it. */
	:global(.rows.inset) {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	:global(.pair) {
		display: grid;
		gap: 14px;
	}
	@media (min-width: 560px) {
		:global(.pair) {
			grid-template-columns: 1fr 1fr;
		}
	}
	:global(.fld) {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	:global(.fld > label) {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	:global(.inp) {
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 16px;
		min-height: 50px;
		padding: 12px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		box-sizing: border-box;
	}
	:global(.inp:focus-visible),
	:global(.seg button:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	:global(.inp .hint) {
		font-size: 13px;
		color: var(--ink-3);
		font-family: var(--f-mono);
		white-space: nowrap;
	}
	:global(.inp.mut) {
		color: var(--ink-3);
	}
	/* One row of choices where a dropdown would hide the options. Three of them
	   is faster to read than a select, and says what the alternatives are. */
	:global(.seg) {
		display: flex;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}
	:global(.seg button) {
		flex: 1 1 0;
		text-align: center;
		padding: 12px 6px;
		font: inherit;
		font-size: 14px;
		min-height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-2);
		background: var(--surface);
		border: 0;
		border-right: 1px solid var(--line);
		cursor: pointer;
	}
	:global(.seg button:last-child) {
		border-right: 0;
	}
	:global(.seg button.on) {
		background: var(--accent);
		color: var(--accent-ink);
		font-weight: 600;
	}
	:global(.tog) {
		display: flex;
		align-items: center;
		gap: 11px;
		font-size: 15px;
		min-height: 48px;
		background: none;
		border: 0;
		padding: 0;
		color: var(--ink);
		font-family: inherit;
		cursor: pointer;
	}
	:global(.tog .sw) {
		width: 44px;
		height: 26px;
		border-radius: 13px;
		background: var(--line);
		position: relative;
		flex: 0 0 auto;
	}
	:global(.tog .sw)::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
	}
	:global(.tog.on .sw) {
		background: var(--accent);
	}
	:global(.tog.on .sw)::after {
		left: auto;
		right: 3px;
	}

	/* A drive, in order. The line and the dots are the route: where it went
	   and in what sequence, which is what makes a leg assignment checkable. */
	:global(.legs) {
		position: relative;
		padding-left: 22px;
	}
	:global(.legs)::before {
		content: '';
		position: absolute;
		left: 5px;
		top: 10px;
		bottom: 10px;
		width: 1px;
		background: var(--line);
	}
	:global(.leg) {
		position: relative;
		padding: 9px 0;
	}
	:global(.leg)::before {
		content: '';
		position: absolute;
		left: -21px;
		top: 15px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--surface);
		border: 2px solid var(--accent);
	}
	:global(.leg .stop) {
		font-size: 15px;
		font-weight: 600;
	}
	:global(.leg .det) {
		font-size: 13px;
		color: var(--ink-3);
		margin-top: 2px;
	}
	:global(.btnrow .btn) {
		flex: 1 1 0;
	}

	/* A running timer, which is the one thing on screen that is happening now
	   rather than having happened. Bordered in the brand colour so it reads as
	   live at arm's length, which is how it is read -- on a phone, on a roof. */
	:global(.timer-card) {
		background: var(--surface);
		border: 1px solid var(--brand);
		border-radius: var(--r);
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	:global(.timer) {
		font-family: var(--f-mono);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: 46px;
		line-height: 1;
		letter-spacing: -0.035em;
		color: var(--brand-deep);
	}
	:global(.timer small) {
		font-size: 24px;
		color: var(--ink-3);
	}
	:global(.chips) {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	:global(.stack) {
		display: flex;
		flex-direction: column;
		gap: 11px;
	}
	:global(.hr) {
		height: 1px;
		background: var(--line-soft);
	}
	:global(.kv) {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		font-size: 14px;
	}
	:global(.kv .k) {
		color: var(--ink-2);
	}
	:global(.kv .v) {
		font-family: var(--f-mono);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	/* Said at the top of the screen, not in a toast: work is captured in metal
	   sheds where reception fails, and "did that save" is the question the
	   screen must answer without being asked. */
	:global(.offline) {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--warn-wash);
		color: var(--warn);
		padding: 10px var(--pad);
		font-size: 13px;
		font-family: var(--f-mono);
		border-bottom: 1px solid var(--line);
	}

	.app {
		min-height: 100dvh;
	}

	/* The screen. Its header is the page's own .top, sticky to the top of it,
	   because what a screen is called belongs to the screen. */
	main {
		min-width: 0;
		padding-bottom: calc(var(--tabh) + env(safe-area-inset-bottom));
	}

	/* Thumb-reach on a phone, because that is where a timer gets used. */
	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 40;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		background: var(--surface);
		border-top: 1px solid var(--line);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.tabbar a {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-height: var(--tabh);
		padding: 7px 2px;
		font-size: 10.5px;
		color: var(--ink-3);
		text-decoration: none;
		border-top: 2px solid transparent;
		margin-top: -1px;
	}
	.tabbar a[aria-current='page'] {
		color: var(--accent);
		border-top-color: var(--brand);
		background: var(--accent-wash);
	}

	/* Drawn rather than set: a glyph font is one more thing to ship, and these
	   are four rectangles and a rule. */
	.ic {
		width: 20px;
		height: 20px;
		border: 1.7px solid currentColor;
		border-radius: 5px;
	}
	.ic.i2 {
		border-radius: 50%;
	}
	.ic.i3 {
		border-radius: 5px 14px 5px 14px;
	}
	.ic.i4 {
		border-radius: 3px;
		border-left-width: 6px;
	}
	.ic.i9 {
		border: 0;
		border-radius: 0;
		box-shadow:
			0 -6px 0 -4px currentColor,
			0 0 0 -4px currentColor,
			0 6px 0 -4px currentColor;
	}

	/* Below the rail's width there is no rail; the tab bar is the navigation. */
	.rail {
		display: none;
	}

	@media (min-width: 620px) {
		:global(.tiles) {
			grid-template-columns: repeat(3, 1fr);
		}
		:global(.tile.wide) {
			grid-column: auto;
		}
	}

	/* THE RAIL APPEARS WHEN THE WINDOW CAN AFFORD IT, which is not the same as
	   when it fits.

	   At 980 -- the mock's figure, carried over without being questioned -- the
	   rail takes 236 of them and hands the screen back 744. A window one pixel
	   narrower gave the screen 979. So widening the window made the content
	   NARROWER, and the sidebar read as taking the page over rather than
	   sitting beside it.

	   1180 is 236 for the rail plus the ~940 the screen already had at the top
	   of the tab-bar range. Crossing it still costs the content something --
	   that is unavoidable with a fixed rail -- but it lands at a width the
	   layout was already comfortable at, rather than below it. */
	@media (min-width: 1180px) {
		.tabbar {
			display: none;
		}
		main {
			padding-bottom: 0;
		}
		/* The application fills the window. The mock caps it at 1280 and centres
		   it, which leaves 320px of page background down each side of a 1920
		   monitor -- a frame around the thing rather than the thing.
		   What is capped is the reading column, below. */
		.app {
			display: grid;
			grid-template-columns: 236px 1fr;
			min-height: 100dvh;
			background: var(--surface-2);
		}
		.rail {
			display: flex;
			flex-direction: column;
			gap: 20px;
			padding: 20px 0;
			border-right: 1px solid var(--line);
			position: sticky;
			top: 0;
			align-self: start;
			height: 100dvh;
			box-sizing: border-box;
		}
		.rail-mark {
			padding: 0 18px;
			display: flex;
			flex-direction: column;
			gap: 5px;
		}
		.rail-mark img {
			width: 104px;
			height: auto;
			display: block;
		}
		.rail-mark span {
			font-family: var(--f-display);
			font-weight: 700;
			font-size: 15px;
			letter-spacing: 0.01em;
			color: var(--display-ink);
		}
		.rail-nav {
			display: flex;
			flex-direction: column;
		}
		.rail-nav a {
			display: flex;
			align-items: center;
			gap: 9px;
			padding: 10px 18px;
			font-size: 14.5px;
			color: var(--ink-2);
			text-decoration: none;
			border-left: 2px solid transparent;
			min-height: 44px;
			box-sizing: border-box;
		}
		.rail-nav a[aria-current='page'] {
			color: var(--accent);
			border-left-color: var(--brand);
			background: var(--accent-wash);
		}
		.rail-nav .cnt {
			margin-left: auto;
			font-family: var(--f-mono);
			font-size: 11px;
			color: var(--ink-3);
			font-variant-numeric: tabular-nums;
		}
		.rail-foot {
			margin-top: auto;
			padding: 0 18px;
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.avatar {
			width: 26px;
			height: 26px;
			border-radius: 50%;
			background: var(--accent);
			color: var(--accent-ink);
			font-family: var(--f-mono);
			font-size: 10.5px;
			font-weight: 700;
			display: grid;
			place-items: center;
			flex: 0 0 auto;
		}
		.rail-foot .who {
			font-size: 13.5px;
			color: var(--ink-2);
		}
		.rail-foot button {
			margin-left: auto;
			font: inherit;
			font-size: 12px;
			padding: 4px 9px;
			border: 1px solid var(--line);
			border-radius: 999px;
			background: var(--surface);
			color: var(--ink-3);
			cursor: pointer;
		}

		/* ONE COLUMN, centred by padding rather than by each child centring
		   itself. Capped is right -- a record row a thousand pixels wide puts
		   the label at one end and the figure at the other with a desert
		   between them -- but margin-inline:auto on every child centres a
		   narrow panel inboard of a wide list, so the note under a screen
		   stopped lining up with the rows it explains. This makes a 960px
		   content box; narrow things sit at its left edge. */
		:global(.pad) {
			padding: 22px max(24px, calc((100% - var(--col)) / 2)) 40px;
			gap: 22px;
			background: var(--surface);
			min-height: calc(100dvh - 70px);
		}
		:global(.tiles) {
			grid-template-columns: repeat(4, 1fr);
		}
		:global(.duo) {
			grid-template-columns: 1.6fr 1fr;
			gap: 22px;
			align-items: start;
		}
	}
</style>
