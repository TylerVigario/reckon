<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/env';
	import { setOwner } from '#lib/owner.ts';
	import { claimUnownedTimers } from '#lib/timers.ts';
	import { page, updated } from '$app/state';
	import { afterNavigate, invalidateAll } from '$app/navigation';
	import { claimUnowned, flush } from '#lib/queue.ts';
	import Dialog from '#lib/Dialog.svelte';
	import { beforeSigningOut, signingOut, signOutAnyway, stay } from '#lib/sign-out.svelte.ts';
	import { warm } from '#lib/warm.ts';
	import type { LayoutProps } from './$types';
	import { resolve } from '$app/paths';
	import type { RouteId } from '$app/types';
	import Octicon from '#lib/Octicon.svelte';
	import type { Octicon24Name, OcticonName } from '#lib/octicons.ts';
	import { working } from '#lib/busy.svelte.ts';
	import { hoursBadge, zoneName } from '#lib/format.ts';
	import { CLIENT_PAGE, LINK_PAGE } from '#lib/client-link.ts';
	import { opens } from '#lib/access.ts';
	// Primer's primitives: its colours, light and dark, and its sizes and type.
	import '@primer/primitives/dist/css/functional/themes/light.css';
	import '@primer/primitives/dist/css/functional/themes/dark.css';
	import '@primer/primitives/dist/css/base/size/size.css';
	import '@primer/primitives/dist/css/base/typography/typography.css';
	import '@primer/primitives/dist/css/functional/size/border.css';
	import '@primer/primitives/dist/css/functional/size/radius.css';
	import '@primer/primitives/dist/css/functional/size/size.css';
	import '@primer/primitives/dist/css/functional/size/size-coarse.css';
	import '@primer/primitives/dist/css/functional/size/size-fine.css';
	import '@primer/primitives/dist/css/functional/typography/typography.css';
	// Noto, as press sets its documents in, bundled.
	import '@fontsource-variable/noto-sans';
	import '@fontsource-variable/noto-sans-mono';
	// Primer's shapes, drawn in its primitives (#lib/primer.css).
	import '#lib/primer.css';

	let { data, children }: LayoutProps = $props();

	// Whose unsent work this phone shows and sends (#lib/owner): said now,
	// before anything on the page reads the queue, and again as it changes.
	if (browser) setOwner(untrack(() => data.user?.id ?? null));
	$effect(() => {
		if (browser) setOwner(data.user?.id ?? null);
	});

	// The operator may set the one hue; the palette below is what it falls back
	// to, and an operator who has chosen a colour gets theirs.
	const accent = $derived(data.operator?.accent_colour || '');
	const name = $derived(data.operator?.trading_name ?? 'reckon');

	// The installed app's icon, and the tab's: the operator's logo where it is
	// fit to be one, reckon's tally where it is not.
	const appleIcon = $derived(
		data.operator?.logo_is_app_icon ? '/operator/logo' : '/icons/apple-touch-icon.png'
	);
	const tabIcon = $derived(data.operator?.has_logo ? '/operator/logo' : '/icons/reckon.svg');

	// The server drew the first paint in this device's theme (hooks.server.ts).
	// Set again in the profile, the page redraws without coming back from the
	// server whole, so <html> is moved to match here.
	$effect(() => {
		document.documentElement.dataset.colorMode = data.theme || 'auto';
	});

	// The service worker keeps Today, the Time screens and the drafts for when
	// there is no signal (src/service-worker). Signed in and online, it is asked
	// to fetch them now, so a phone that has never opened one can still open it
	// offline.
	onMount(() => {
		// The service worker is registered here, for somebody signed in, rather
		// than by SvelteKit on every page: a client opening their invoice's link
		// is not installing the app (vite.config.ts).
		if (data.user && 'serviceWorker' in navigator)
			void navigator.serviceWorker
				.register('/service-worker.js', { type: 'module' })
				.catch(() => {});
		if (!data.user) return;
		// Anything left from before the queue named its maker is theirs.
		claimUnownedTimers();
		const claimed = claimUnowned().catch(() => {});
		if (!navigator.onLine) return;
		// Whatever the capture queue still holds of theirs goes now. A page opened
		// with a signal never hears the browser say it is back online, so without
		// this an entry recorded offline would wait for the next one to carry it.
		void claimed.then(() => flush()).catch(() => {});
		warm();
	});

	// A PERSON'S TIME ZONE is theirs, on their user record (#lib/server/calendar).
	// The first time they sign in it is taken from this browser, without asking.
	// After that, a phone that finds itself in another zone asks before changing
	// it: somebody away for a day may want to keep their own clock. Keeping it is
	// remembered on this device, for that zone, so it asks once.
	const KEPT = 'reckon.zone.kept';
	let elsewhere = $state<string | null>(null);
	const same = (a: string, b: string) => {
		try {
			const as = (z: string) =>
				new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone;
			return as(a) === as(b);
		} catch {
			return a === b;
		}
	};
	async function saveZone(zone: string) {
		if (!data.user) return;
		const r = await fetch(`/api/people/${data.user.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { timezone: zone } })
		}).catch(() => null);
		if (r?.ok) await invalidateAll();
	}
	onMount(() => {
		if (!data.user || !navigator.onLine) return;
		const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!here) return;
		if (data.user.timezone === null) {
			void saveZone(here);
			return;
		}
		let kept: string | null = null;
		try {
			kept = localStorage.getItem(KEPT);
		} catch {
			/* nothing remembered: it asks */
		}
		if (!same(here, data.user.timezone) && kept !== here) elsewhere = here;
	});
	function keepZone() {
		try {
			if (elsewhere) localStorage.setItem(KEPT, elsewhere);
		} catch {
			/* it will ask again next time */
		}
		elsewhere = null;
	}
	function useHere() {
		const zone = elsewhere;
		elsewhere = null;
		if (zone) void saveZone(zone);
	}

	// A full-page load is the only thing that makes a browser look for a new
	// service worker. Asking on every navigation picks up a deploy as eagerly as
	// the page itself notices one. The asking fails whenever it cannot be
	// answered -- no connection, or a worker still installing -- and that is
	// nothing to report: the next navigation asks again.
	afterNavigate(() => {
		if ('serviceWorker' in navigator)
			void navigator.serviceWorker
				.getRegistration()
				.then((r) => r?.update())
				.catch(() => {});
	});

	// ON A PHONE, five tabs along the bottom, one per kind of work, as GitHub's
	// own phone app has its sections (docs.github.com, GitHub Mobile: "At the
	// bottom of the app"): in thumb's reach, since that is where a timer gets
	// started. More is the rest of the sections as a page of its own, Primer's
	// sidebar on a narrow screen: "an index page" to go back to.
	const nav = [
		{ href: '/', label: 'Today', ic: 'home' },
		{ href: '/timesheet', label: 'Time', ic: 'clock' },
		{ href: '/trips', label: 'Trips', ic: 'location' },
		{ href: '/invoices', label: 'Invoices', ic: 'file' },
		{ href: '/more', label: 'More', ic: 'apps' }
	] satisfies { href: RouteId; label: string; ic: Octicon24Name }[];

	// WITH ROOM FOR TWO COLUMNS -- Primer's regular range, from 768px -- every
	// section down the side, as Primer's NavList in a split page's pane: "On
	// wide viewports, the sidebar is always visible." More is not a place
	// there, it is four more rows. A section with tabs is opened on its first
	// (#lib/section-tabs), and lit on any of them.
	const rail = [
		{ href: '/', label: 'Today', ic: 'home', count: () => counts.drafts },
		{
			href: '/timesheet',
			label: 'Time',
			ic: 'clock',
			count: () => hours(counts.monthSeconds)
		},
		{ href: '/trips', label: 'Trips', ic: 'location', count: () => null },
		{ href: '/invoices', label: 'Invoices', ic: 'file', count: () => counts.drafts },
		{
			href: '/catalogue/materials',
			at: '/catalogue',
			label: 'Catalogue',
			ic: 'package',
			count: () => null
		},
		{ href: '/clients', label: 'Entities', ic: 'organization', count: () => counts.entities },
		{ href: '/team', label: 'Team', ic: 'people', count: () => null },
		{ href: '/reports/pay', at: '/reports', label: 'Reports', ic: 'graph', count: () => null },
		{ href: '/settings', label: 'Settings', ic: 'gear', count: () => null }
	] satisfies {
		href: RouteId;
		at?: string;
		label: string;
		ic: OcticonName;
		count: () => string | number | null | undefined;
	}[];

	// Each section is offered only where it opens for this person (#lib/access);
	// someone with Field has their own pay in place of the reports.
	const access = $derived(data.user?.access ?? null);
	const railShown = $derived(rail.filter((r) => opens(access, r.href)));

	const counts = $derived(data.counts ?? {});
	const hours = (s: number | undefined) => (s === undefined ? null : hoursBadge(s));

	// Two letters, from a name nobody has to configure.
	const initials = $derived(
		(data.user?.name ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w: string) => w[0]?.toUpperCase() ?? '')
			.join('')
	);

	// Everything reached through More lights More.
	const UNDER_MORE = [
		'/more',
		'/catalogue',
		'/clients',
		'/team',
		'/reports',
		'/settings',
		'/profile'
	];
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

<svelte:head>
	<title>{name}</title>
	<!-- Named outright: no icon named sends every browser to ask for a
	     /favicon.ico that does not exist. -->
	<link rel="icon" href={tabIcon} />
	<link rel="apple-touch-icon" href={appleIcon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<!-- The business's own colour colours what is its: the installed app's
	     frame, as its manifest does, and the emails and invoices it sends. The
	     app itself is drawn in Primer's. -->
	<meta name="theme-color" content={accent || '#1d6f9c'} />
</svelte:head>

<!-- What a working button is doing (#lib/busy), said for whoever can't see
     its spinner: there from the first paint, so it is heard when it changes. -->
<div class="sr-only" aria-live="polite">{working.said}</div>

{#if !data.user || CLIENT_PAGE.test(page.url.pathname) || LINK_PAGE.test(page.url.pathname)}
	<!-- Signed out, there is nothing to navigate to. The shell would be a header
	     and a row of links that all bounce back to here. A client's page is the
	     client's, whoever opens it, so it is drawn without the shell too, as is
	     the page an emailed link opens, which is for whoever it was sent to. -->
	{@render children()}
{:else}
	<div class="app">
		<!-- Primer: "a skip link near the global navigation that allows users
		     skip over all the global navigation items and go straight to the
		     main content". -->
		<a class="skip btn" href="#main">Skip to content</a>
		<div class="pane">
			<a class="mark" href={resolve('/')}>
				<img src={tabIcon} alt="" />
				<span>{name}</span>
			</a>
			<nav aria-label="Sections">
				<ul class="navlist">
					{#each railShown as r (r.href)}
						{@const n = r.count()}
						<li>
							<a
								href={resolve(r.href)}
								aria-current={here(('at' in r && r.at) || r.href) ? 'page' : undefined}
							>
								<Octicon name={r.ic} />{r.label}{#if n !== null && n !== undefined}<span
										class="count">{n}</span
									>{/if}
							</a>
						</li>
					{/each}
					{#if access === 'field' && data.user}
						<li>
							<a
								href={resolve('/reports/pay/[person]', { person: data.user.id })}
								aria-current={page.url.pathname.startsWith('/reports/pay') ? 'page' : undefined}
								><Octicon name="creditCard" />Your pay</a
							>
						</li>
					{/if}
				</ul>
			</nav>
			<form class="foot" method="POST" action="/logout" onsubmit={beforeSigningOut}>
				<ul class="navlist">
					<li>
						<a
							href={resolve('/profile')}
							aria-current={page.url.pathname.startsWith('/profile') ? 'page' : undefined}
						>
							<span class="ava" aria-hidden="true">{initials}</span>
							<span class="navlist-m"
								><span>{data.user?.name}</span><span class="navlist-b">Your profile</span></span
							>
						</a>
					</li>
				</ul>
				<button class="btn sm gho" type="submit"><Octicon name="signOut" />Sign out</button>
			</form>
		</div>

		<main id="main">
			{#if elsewhere && data.user?.timezone}
				<div class="notice">
					<div class="banner info zone-ask" role="status">
						<Octicon name="clock" />
						<div class="banner-m">
							<p class="banner-t">This device is on {zoneName(elsewhere)}</p>
							<p class="banner-d">Your clock is {zoneName(data.user.timezone)}.</p>
							<div class="acts">
								<button type="button" class="btn sm pri" onclick={useHere}
									>Use {zoneName(elsewhere)}</button
								>
								<button type="button" class="btn sm" onclick={keepZone}>Keep mine</button>
							</div>
						</div>
					</div>
				</div>
			{/if}
			<!-- SvelteKit notices a new deploy on navigation, on focus and hourly.
			     Said, not done: a reload in the middle of entering something would
			     lose it. -->
			{#if updated.current}
				<div class="notice">
					<div class="banner info updated" role="status">
						<Octicon name="info" />
						<div class="banner-m">
							<p class="banner-t">reckon has been updated</p>
							<div class="acts">
								<button type="button" class="btn sm pri" onclick={() => location.reload()}
									>Reload</button
								>
							</div>
						</div>
					</div>
				</div>
			{/if}
			{@render children()}
		</main>

		<nav class="tabbar" aria-label="Sections">
			{#each nav as n (n.href)}
				<a href={resolve(n.href)} aria-current={here(n.href) ? 'page' : undefined}>
					<Octicon name={n.ic} size={24} />{n.label}
				</a>
			{/each}
		</nav>
	</div>

	<Dialog
		open={signingOut.form !== null}
		title="Sign out with work still on this phone?"
		go="Sign out"
		ongo={signOutAnyway}
		onclose={stay}
	>
		<p>
			{#if signingOut.waiting}
				{signingOut.waiting}
				{signingOut.waiting === 1 ? 'thing' : 'things'} you recorded on this phone
				{signingOut.waiting === 1 ? 'hasn’t' : 'haven’t'} reached reckon yet.
			{/if}
			{#if signingOut.timers}
				{signingOut.timers}
				{signingOut.timers === 1 ? 'timer is' : 'timers are'} still running.
			{/if}
		</p>
		<p>
			{#if signingOut.waiting}It stays on this phone, and goes the next time you sign in on it.{/if}
			{#if signingOut.timers}A timer keeps running until you stop it.{/if}
			Nobody else who signs in here sees any of it.
		</p>
	</Dialog>
{/if}

<style>
	/* PRIMER'S OWN PRIMITIVES (@primer/primitives, MIT), bundled and imported
	   above: its colours, in its light and dark themes, which <html> names
	   (data-color-mode, data-light-theme, data-dark-theme -- the device's own
	   choice, unless this device is set to one, #lib/device-fields), and its
	   sizes, type and radii. reckon draws with Primer's tokens alone, and its
	   shapes are Primer's (#lib/primer.css); what is its own is the layout
	   below.

	   The type is Noto -- Noto Sans and Noto Sans Mono, bundled (OFL-1.1) --
	   which Primer's own font stack names, and which press sets its documents
	   in, so an invoice on screen and on paper speak in one voice. Primer's
	   stacks keep their own fallbacks behind it. */
	:global(:root) {
		--fontStack-sansSerif:
			'Noto Sans Variable', 'Noto Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica,
			Arial, sans-serif;
		--fontStack-system: var(--fontStack-sansSerif);
		--fontStack-monospace:
			'Noto Sans Mono Variable', 'Noto Sans Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo,
			Consolas, 'Liberation Mono', monospace;
		/* A page's padding, Primer's: 16px, and 24px from its large breakpoint
		   (1012px), on the content and the pane alike. */
		--pad: var(--base-size-16);
		/* The content's width at most: Primer's xlarge, 1280px, its padding
		   included -- so 1232px of content inside 24px either side. */
		--col: 1232px;
		/* The tab bar's height, its line included, which a screen pinning
		   something above the bar reads (catalogue/receipts/new). */
		--tabh: 60px;
		/* Form controls and scrollbars follow the theme <html> names. */
		color-scheme: light dark;
	}
	:global(:root[data-color-mode='light']) {
		color-scheme: light;
	}
	:global(:root[data-color-mode='dark']) {
		color-scheme: dark;
	}
	@media (min-width: 1012px) {
		:global(:root) {
			--pad: var(--base-size-24);
		}
	}

	/* app.html's wrapper. A rule rather than its own style attribute, which the
	   content security policy refuses. */
	:global(#app) {
		display: contents;
	}

	:global(body) {
		margin: 0;
		background: var(--bgColor-default);
		color: var(--fgColor-default);
		font-family: var(--fontStack-sansSerif);
		font-size: var(--text-body-size-medium);
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
		-webkit-text-size-adjust: 100%;
	}
	:global(a) {
		color: var(--fgColor-accent);
	}

	/* Read by a screen reader, not drawn: Primer's sr-only. */
	:global(.sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* A screen's content, under its header (#lib/Top): Primer's content
	   region, its blocks a padding apart, and no wider than --col. Centred by
	   padding rather than by each child centring itself, so a narrow note sits
	   at the left edge of the rows it explains rather than inboard of them. */
	:global(.pad) {
		display: flex;
		flex-direction: column;
		gap: var(--pad);
		padding: var(--pad) max(var(--pad), calc((100% - var(--col)) / 2));
	}
	:global(.pad > *) {
		max-width: var(--col);
	}

	.app {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	main {
		flex: 1 0 auto;
		min-width: 0;
	}

	/* Out of sight until it has the focus, then at the top of the page. */
	.skip {
		position: absolute;
		top: var(--base-size-8);
		left: var(--base-size-8);
		z-index: 60;
		transform: translateY(-200%);
	}
	.skip:focus-visible {
		transform: none;
	}

	/* What the shell itself says -- this device's clock, a new version -- as
	   Primer's Banner, over the screen. */
	.notice {
		padding: var(--base-size-8) var(--pad) 0;
	}
	.notice .acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--base-size-8);
	}

	/* THE TAB BAR. Sticky in the page's flow rather than fixed over it. A fixed
	   bar takes no room, so the page has to reserve its height -- and a
	   reserved height is a guess: the bar grows with its padding, the safe area
	   and the reader's text size, and whatever it outgrows the guess by sits
	   under it. In the flow the bar's room is the bar's own height, whatever
	   that turns out to be, and the last thing on a page always ends above it.

	   Drawn as Primer draws its tabs (UnderlineNav): the current one's label in
	   the text colour, semibold, under Primer's line for the current tab, here
	   at the bar's top edge, since the bar is at the screen's bottom. */
	.tabbar {
		position: sticky;
		bottom: 0;
		z-index: 40;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		background: var(--bgColor-default);
		border-top: var(--borderWidth-thin) solid var(--borderColor-default);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.tabbar a {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--base-size-4);
		height: var(--tabh);
		margin-top: -1px;
		padding: 0 var(--base-size-2);
		font-size: var(--text-caption-size);
		line-height: var(--text-caption-lineHeight);
		color: var(--fgColor-muted);
		text-decoration: none;
		border-top: 2px solid transparent;
	}
	.tabbar a:focus-visible {
		outline: 2px solid var(--focus-outlineColor);
		outline-offset: -2px;
	}
	.tabbar a[aria-current='page'] {
		color: var(--fgColor-default);
		font-weight: var(--base-text-weight-semibold);
		border-top-color: var(--underlineNav-borderColor-active);
	}

	/* Below Primer's regular range there is no pane; the tab bar is the
	   navigation. */
	.pane {
		display: none;
	}

	/* PRIMER'S SPLIT PAGE, from its regular range (768px): the pane flush to
	   the left and as tall as the window, scrolling on its own, split from the
	   content by Primer's divider, at Primer's medium pane width -- 256px, and
	   296px from 1012px. The application fills the window; what is capped is
	   the content, by --col. */
	@media (min-width: 768px) {
		.tabbar {
			display: none;
		}
		.app {
			display: grid;
			grid-template-columns: var(--pane-w, 256px) minmax(0, 1fr);
			align-items: start;
		}
		.pane {
			position: sticky;
			top: 0;
			display: flex;
			flex-direction: column;
			gap: var(--base-size-16);
			height: 100dvh;
			box-sizing: border-box;
			padding: var(--pad) var(--base-size-16);
			overflow-y: auto;
			border-right: var(--borderWidth-thin) solid var(--borderColor-default);
		}
		main {
			min-height: 100dvh;
		}
		/* The business, as GitHub's header names where you are: its mark, and
		   its name beside it. */
		.mark {
			display: flex;
			align-items: center;
			gap: var(--base-size-8);
			min-height: var(--control-medium-size);
			padding: 0 var(--base-size-8);
			color: var(--fgColor-default);
			font-weight: var(--base-text-weight-semibold);
			text-decoration: none;
			border-radius: var(--borderRadius-medium);
		}
		.mark:hover {
			background: var(--control-transparent-bgColor-hover);
		}
		.mark img {
			flex: 0 0 auto;
			width: var(--base-size-32);
			height: var(--base-size-32);
			object-fit: contain;
		}
		.mark span {
			min-width: 0;
			overflow-wrap: anywhere;
		}
		.foot {
			display: flex;
			flex-direction: column;
			gap: var(--base-size-8);
			margin-top: auto;
			padding-top: var(--base-size-16);
			border-top: var(--borderWidth-thin) solid var(--borderColor-muted);
		}
		.foot .btn {
			align-self: flex-start;
		}
		.foot .ava {
			width: var(--base-size-24);
			height: var(--base-size-24);
			font-size: var(--text-caption-size, 12px);
		}
	}
	@media (min-width: 1012px) {
		.app {
			--pane-w: 296px;
		}
	}
</style>
