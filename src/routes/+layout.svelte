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
	import TabIcon, { type Tab } from '#lib/TabIcon.svelte';
	import { hoursBadge, zoneName } from '#lib/format.ts';
	import { CLIENT_PAGE, LINK_PAGE } from '#lib/client-link.ts';
	import { opens } from '#lib/access.ts';
	// Primer's shapes, for the screens drawn to it so far (#lib/primer.css).
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

	// Five tabs, one per kind of work.
	const nav = [
		{ href: '/', label: 'Today', ic: 'today' },
		{ href: '/timesheet', label: 'Time', ic: 'time' },
		{ href: '/trips', label: 'Trips', ic: 'trips' },
		{ href: '/invoices', label: 'Invoices', ic: 'invoices' },
		{ href: '/more', label: 'More', ic: 'more' }
	] satisfies { href: RouteId; label: string; ic: Tab }[];

	// The rail flattens what the tab bar nests: on a screen with room, More is
	// not a place, it is four more rows. A section with tabs is opened on its
	// first (#lib/section-tabs), and lit on any of them.
	const rail = [
		{ href: '/', label: 'Today', count: () => counts.drafts },
		{ href: '/timesheet', label: 'Time', count: () => hours(counts.monthSeconds) },
		{ href: '/trips', label: 'Trips', count: () => null },
		{ href: '/invoices', label: 'Invoices', count: () => counts.drafts },
		{ href: '/catalogue/materials', at: '/catalogue', label: 'Catalogue', count: () => null },
		{ href: '/clients', label: 'Entities', count: () => counts.entities },
		{ href: '/team', label: 'Team', count: () => null },
		{ href: '/reports/pay', at: '/reports', label: 'Reports', count: () => null },
		{ href: '/settings', label: 'Settings', count: () => null }
	] satisfies {
		href: RouteId;
		at?: string;
		label: string;
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

{#if !data.user || CLIENT_PAGE.test(page.url.pathname) || LINK_PAGE.test(page.url.pathname)}
	<!-- Signed out, there is nothing to navigate to. The shell would be a header
	     and a row of links that all bounce back to here. A client's page is the
	     client's, whoever opens it, so it is drawn without the shell too, as is
	     the page an emailed link opens, which is for whoever it was sent to. -->
	{@render children()}
{:else}
	<div class="app">
		<div class="rail">
			<div class="rail-mark">
				{#if data.operator?.has_logo}
					<img class="logo" src="/operator/logo" alt={name} />
				{/if}
				<span>{name}</span>
			</div>
			<nav class="rail-nav" aria-label="Sections">
				{#each railShown as r (r.href)}
					{@const n = r.count()}
					<a
						href={resolve(r.href)}
						aria-current={here(('at' in r && r.at) || r.href) ? 'page' : undefined}
					>
						{r.label}{#if n !== null && n !== undefined}<span class="cnt">{n}</span>{/if}
					</a>
				{/each}
				{#if access === 'field' && data.user}
					<a
						href={resolve('/reports/pay/[person]', { person: data.user.id })}
						aria-current={page.url.pathname.startsWith('/reports/pay') ? 'page' : undefined}
						>Your pay</a
					>
				{/if}
			</nav>
			<form class="rail-foot" method="POST" action="/logout" onsubmit={beforeSigningOut}>
				<a
					class="me"
					href={resolve('/profile')}
					title="Your profile"
					aria-current={page.url.pathname === '/profile' ? 'page' : undefined}
				>
					<span class="avatar" aria-hidden="true">{initials}</span>
					<span class="who">{data.user?.name}</span>
				</a>
				<button type="submit">Sign out</button>
			</form>
		</div>

		<main>
			{#if elsewhere && data.user?.timezone}
				<div class="zone-ask" role="status">
					<p>
						This device is on {zoneName(elsewhere)}. Your clock is {zoneName(data.user.timezone)}.
					</p>
					<div class="acts">
						<button type="button" class="btn sm pri" onclick={useHere}
							>Use {zoneName(elsewhere)}</button
						>
						<button type="button" class="btn sm" onclick={keepZone}>Keep mine</button>
					</div>
				</div>
			{/if}
			<!-- SvelteKit notices a new deploy on navigation, on focus and hourly.
			     Said, not done: a reload in the middle of entering something would
			     lose it. -->
			{#if updated.current}
				<div class="updated" role="status">
					<span>reckon has been updated.</span>
					<button type="button" class="btn sm pri" onclick={() => location.reload()}>Reload</button>
				</div>
			{/if}
			{@render children()}
		</main>

		<nav class="tabbar" aria-label="Sections">
			{#each nav as n (n.href)}
				<a href={resolve(n.href)} aria-current={here(n.href) ? 'page' : undefined}>
					<TabIcon name={n.ic} />{n.label}
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
	   sizes, type and radii. reckon draws with Primer's tokens alone; what is
	   its own is the layout below.

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
		--pad: 16px;
		--tabh: 60px;
		/* The reading column. Width is capped by content type -- records, prose,
		   documents, controls -- and this is the widest of them. Inside no frame,
		   a narrow figure leaves a desert down both sides of a wide
		   monitor. */
		--col: 1200px;
		/* Form controls and scrollbars follow the theme <html> names. */
		color-scheme: light dark;
	}
	:global(:root[data-color-mode='light']) {
		color-scheme: light;
	}
	:global(:root[data-color-mode='dark']) {
		color-scheme: dark;
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
		font-size: 16px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
		-webkit-text-size-adjust: 100%;
	}
	:global(a) {
		color: var(--fgColor-accent);
	}

	/* ================================================================ system ==
	   The shared components, global so a page uses them by naming them
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
		font-family: var(--fontStack-monospace);
		font-size: 10.5px;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--fgColor-muted);
		font-weight: 400;
		margin: 0;
	}
	:global(.sec-h .sp) {
		margin-left: auto;
	}
	:global(.rows) {
		background: var(--bgColor-default);
		border: 1px solid var(--borderColor-default);
		border-radius: var(--borderRadius-medium);
		overflow: hidden;
	}

	/* The one row component. Every list in this app is made of these: unbilled
	   work, invoice lines, catalogue items, trip legs, report figures. */
	:global(.rec) {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--borderColor-muted);
		min-height: 56px;
		box-sizing: border-box;
		color: inherit;
		text-decoration: none;
	}
	:global(.rec:last-child) {
		border-bottom: 0;
	}
	:global(.rec.warn) {
		background: var(--bgColor-attention-muted);
	}
	:global(.rec.crit) {
		background: var(--bgColor-danger-muted);
	}
	:global(.rec.acc) {
		background: var(--bgColor-accent-muted);
	}
	:global(.rec.tot) {
		background: var(--bgColor-inset);
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
		color: var(--fgColor-muted);
		font-family: var(--fontStack-monospace);
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
		color: var(--fgColor-muted);
	}
	:global(.rec-s) {
		font-size: 13.5px;
		color: var(--fgColor-muted);
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
		font-family: var(--fontStack-monospace);
		font-variant-numeric: tabular-nums;
		font-size: 15px;
		font-weight: 700;
		white-space: nowrap;
		display: block;
	}
	:global(.rec-x) {
		font-family: var(--fontStack-monospace);
		font-variant-numeric: tabular-nums;
		font-size: 12px;
		color: var(--fgColor-muted);
		white-space: nowrap;
		display: block;
		margin-top: 3px;
	}
	:global(.rec-v.mut),
	:global(.rec-x.mut) {
		color: var(--fgColor-muted);
		font-weight: 400;
	}

	:global(.chip) {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--fontStack-monospace);
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 3px 7px;
		border-radius: 11px;
		border: 1px solid var(--borderColor-default);
		color: var(--fgColor-muted);
		background: var(--bgColor-muted);
		white-space: nowrap;
	}
	:global(.chip.good) {
		color: var(--fgColor-success);
		border-color: var(--borderColor-success-emphasis);
		background: var(--bgColor-success-muted);
	}
	:global(.chip.warn) {
		color: var(--fgColor-attention);
		border-color: var(--borderColor-attention-emphasis);
		background: var(--bgColor-attention-muted);
	}
	:global(.chip.crit) {
		color: var(--fgColor-danger);
		border-color: var(--borderColor-danger-emphasis);
		background: var(--bgColor-danger-muted);
	}
	:global(.chip.acc) {
		color: var(--fgColor-accent);
		border-color: var(--borderColor-accent-muted);
		background: var(--bgColor-accent-muted);
	}
	:global(.chip .dot) {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
	}

	:global(.none) {
		margin: 0;
		color: var(--fgColor-muted);
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
		background: var(--bgColor-default);
		border: 1px solid var(--borderColor-default);
		border-radius: var(--borderRadius-medium);
		padding: 13px 14px;
	}
	:global(.tile.wide) {
		grid-column: 1 / -1;
	}
	:global(.tile .k) {
		font-family: var(--fontStack-monospace);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fgColor-muted);
		display: block;
		margin-bottom: 7px;
	}
	:global(.tile .v) {
		font-family: var(--fontStack-monospace);
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
		color: var(--fgColor-success);
	}
	:global(.tile .v.crit) {
		color: var(--fgColor-danger);
	}
	:global(.tile .v.warn) {
		color: var(--fgColor-attention);
	}
	:global(.tile .s) {
		font-size: 12.5px;
		color: var(--fgColor-muted);
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
		color: var(--fgColor-accent);
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

	/* Primer's Button: its default, primary and danger variants in its own
	   button tokens, rest and hover; its medium size on a mouse, and Primer's
	   own touch target (control-minTarget-auto, 44px) on a touch screen. */
	:global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--base-size-8);
		font-family: var(--fontStack-sansSerif);
		font-size: var(--text-body-size-medium);
		font-weight: var(--base-text-weight-medium);
		min-height: max(var(--control-medium-size), var(--control-minTarget-auto, 0px));
		padding: 0 var(--control-medium-paddingInline-normal);
		border-radius: var(--borderRadius-medium);
		border: 1px solid var(--button-default-borderColor-rest);
		background: var(--button-default-bgColor-rest);
		color: var(--button-default-fgColor-rest);
		box-shadow: var(--button-default-shadow-resting);
		text-decoration: none;
		cursor: pointer;
	}
	:global(.btn:hover:not(:disabled)) {
		background: var(--button-default-bgColor-hover);
		border-color: var(--button-default-borderColor-hover);
	}
	:global(.btn.pri) {
		background: var(--button-primary-bgColor-rest);
		border-color: var(--button-primary-borderColor-rest);
		color: var(--button-primary-fgColor-rest);
	}
	:global(.btn.pri:hover:not(:disabled)) {
		background: var(--button-primary-bgColor-hover);
		border-color: var(--button-primary-borderColor-hover);
	}
	:global(.btn.gho) {
		background: transparent;
		border-color: transparent;
		box-shadow: none;
		color: var(--fgColor-muted);
	}
	/* What cannot be taken back: Primer's danger button where it is offered,
	   filled where it is confirmed (#lib/Dialog). */
	:global(.btn.danger) {
		color: var(--button-danger-fgColor-rest);
		background: var(--button-danger-bgColor-rest);
		border-color: var(--button-danger-borderColor-rest);
	}
	:global(.btn.danger:hover:not(:disabled)),
	:global(.btn.danger.solid) {
		color: var(--button-danger-fgColor-hover);
		background: var(--button-danger-bgColor-hover);
		border-color: var(--button-danger-borderColor-hover);
	}
	:global(.btn.sm) {
		min-height: max(var(--control-small-size), var(--control-minTarget-auto, 0px));
		padding: 0 var(--control-small-paddingInline-normal);
		font-size: var(--text-body-size-small);
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
	/* A card of fields rather than a list of rows. One definition, so settings
	   pages cannot disagree about a padding and a new page cannot get it wrong
	   by not knowing to copy it. */
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
		font-family: var(--fontStack-monospace);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fgColor-muted);
	}
	:global(.inp) {
		border: 1px solid var(--borderColor-default);
		border-radius: 8px;
		background: var(--bgColor-default);
		color: var(--fgColor-default);
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
		outline: 2px solid var(--borderColor-accent-emphasis);
		outline-offset: 1px;
	}
	:global(.inp .hint) {
		font-size: 13px;
		color: var(--fgColor-muted);
		font-family: var(--fontStack-monospace);
		white-space: nowrap;
	}
	:global(.inp.mut) {
		color: var(--fgColor-muted);
	}
	/* The platform's arrow ignores the padding above it; drawn here it lines up
	   with the text. */
	:global(select.inp) {
		appearance: none;
		padding-right: 2.4rem;
		background-image:
			linear-gradient(45deg, transparent 50%, currentColor 50%),
			linear-gradient(135deg, currentColor 50%, transparent 50%);
		background-size:
			0.36rem 0.36rem,
			0.36rem 0.36rem;
		background-position:
			right 1.2rem center,
			right 0.85rem center;
		background-repeat: no-repeat;
	}
	/* One row of choices where a dropdown would hide the options. Three of them
	   is faster to read than a select, and says what the alternatives are. */
	:global(.seg) {
		display: flex;
		border: 1px solid var(--borderColor-default);
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
		color: var(--fgColor-muted);
		background: var(--bgColor-default);
		border: 0;
		border-right: 1px solid var(--borderColor-default);
		cursor: pointer;
	}
	:global(.seg button:last-child) {
		border-right: 0;
	}
	:global(.seg button.on) {
		background: var(--bgColor-accent-emphasis);
		color: var(--fgColor-onEmphasis);
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
		color: var(--fgColor-default);
		font-family: inherit;
		cursor: pointer;
	}
	:global(.tog .sw) {
		width: 44px;
		height: 26px;
		border-radius: 13px;
		background: var(--borderColor-default);
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
		background: var(--bgColor-default);
		box-shadow: var(--shadow-resting-small);
	}
	:global(.tog.on .sw) {
		background: var(--bgColor-accent-emphasis);
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
		background: var(--borderColor-default);
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
		background: var(--bgColor-default);
		border: 2px solid var(--borderColor-accent-emphasis);
	}
	:global(.leg .stop) {
		font-size: 15px;
		font-weight: 600;
	}
	:global(.leg .det) {
		font-size: 13px;
		color: var(--fgColor-muted);
		margin-top: 2px;
	}
	:global(.btnrow .btn) {
		flex: 1 1 0;
	}

	/* A running timer, which is the one thing on screen that is happening now
	   rather than having happened. Bordered in the brand colour so it reads as
	   live at arm's length, which is how it is read -- on a phone, on a roof. */
	:global(.timer-card) {
		background: var(--bgColor-default);
		border: 1px solid var(--borderColor-emphasis);
		border-radius: var(--borderRadius-medium);
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	:global(.timer) {
		font-family: var(--fontStack-monospace);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: 46px;
		line-height: 1;
		letter-spacing: -0.035em;
		color: var(--fgColor-default);
	}
	:global(.timer small) {
		font-size: 24px;
		color: var(--fgColor-muted);
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
		background: var(--borderColor-muted);
	}
	:global(.kv) {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		font-size: 14px;
	}
	:global(.kv .k) {
		color: var(--fgColor-muted);
	}
	:global(.kv .v) {
		font-family: var(--fontStack-monospace);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	/* Said at the top of the screen, not in a toast: work is captured on
	   jobsites where reception fails, and "did that save" is the question the
	   screen must answer without being asked. */
	:global(.offline) {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--bgColor-attention-muted);
		color: var(--fgColor-attention);
		padding: 10px var(--pad);
		font-size: 13px;
		font-family: var(--fontStack-monospace);
		border-bottom: 1px solid var(--borderColor-default);
	}

	.app {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	/* The screen. Its header is the page's own .top, sticky to the top of it,
	   because what a screen is called belongs to the screen. */
	main {
		flex: 1 0 auto;
		min-width: 0;
	}

	/* Asks before a person's clock moves: the sentence on its own, the two
	   answers under it, so neither is squeezed on a phone. */
	.zone-ask {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px var(--pad);
		background: var(--bgColor-accent-muted);
		border-bottom: 1px solid var(--borderColor-accent-muted);
		font-size: 14px;
	}
	.zone-ask p {
		margin: 0;
	}
	.zone-ask .acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	/* A new version is out. A bar across the top of the screen, in the brand
	   colour, rather than a toast that goes before it is read. */
	.updated {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px var(--pad);
		background: var(--bgColor-accent-muted);
		border-bottom: 1px solid var(--borderColor-accent-muted);
		font-size: 14px;
	}

	/* Thumb-reach on a phone, because that is where a timer gets used.

	   Sticky in the page's flow rather than fixed over it. A fixed bar takes no
	   room, so the page has to reserve its height -- and a reserved height is a
	   guess: the bar grows with its padding, the safe area and the reader's text
	   size, and whatever it outgrows the guess by sits under it. In the flow the
	   bar's room is the bar's own height, whatever that turns out to be, and the
	   last thing on a page always ends above it. */
	.tabbar {
		position: sticky;
		bottom: 0;
		z-index: 40;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		background: var(--bgColor-default);
		border-top: 1px solid var(--borderColor-default);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.tabbar a {
		/* The bar is --tabh tall, padding included -- the height the token names,
		   rather than the token plus whatever the padding adds. */
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-height: var(--tabh);
		padding: 7px 2px;
		font-size: 10.5px;
		color: var(--fgColor-muted);
		text-decoration: none;
		border-top: 2px solid transparent;
		margin-top: -1px;
	}
	.tabbar a[aria-current='page'] {
		color: var(--fgColor-accent);
		border-top-color: var(--borderColor-emphasis);
		background: var(--bgColor-accent-muted);
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

	   At 980 the rail would take 236 and hand the screen back 744, while a
	   window one pixel narrower gives the screen 979 -- so widening the window
	   would make the content NARROWER, and the sidebar would read as taking the
	   page over rather than sitting beside it.

	   1180 is 236 for the rail plus the ~940 the screen already had at the top
	   of the tab-bar range. Crossing it still costs the content something --
	   that is unavoidable with a fixed rail -- but it lands at a width the
	   layout was already comfortable at, rather than below it. */
	@media (min-width: 1180px) {
		.tabbar {
			display: none;
		}
		/* The application fills the window. Capping it at 1280 and centring it
		   would leave 320px of page background down each side of a 1920 monitor
		   -- a frame around the thing rather than the thing.
		   What is capped is the reading column, below. */
		.app {
			display: grid;
			grid-template-columns: 236px 1fr;
			min-height: 100dvh;
			background: var(--bgColor-muted);
		}
		.rail {
			display: flex;
			flex-direction: column;
			gap: 20px;
			padding: 20px 0;
			border-right: 1px solid var(--borderColor-default);
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
			font-family: var(--fontStack-sansSerif);
			font-weight: 700;
			font-size: 15px;
			letter-spacing: 0.01em;
			color: var(--fgColor-default);
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
			color: var(--fgColor-muted);
			text-decoration: none;
			border-left: 2px solid transparent;
			min-height: 44px;
			box-sizing: border-box;
		}
		.rail-nav a[aria-current='page'] {
			color: var(--fgColor-accent);
			border-left-color: var(--borderColor-emphasis);
			background: var(--bgColor-accent-muted);
		}
		.rail-nav .cnt {
			margin-left: auto;
			font-family: var(--fontStack-monospace);
			font-size: 11px;
			color: var(--fgColor-muted);
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
			background: var(--bgColor-accent-emphasis);
			color: var(--fgColor-onEmphasis);
			font-family: var(--fontStack-monospace);
			font-size: 10.5px;
			font-weight: 700;
			display: grid;
			place-items: center;
			flex: 0 0 auto;
		}
		.rail-foot .me {
			display: flex;
			align-items: center;
			gap: 10px;
			min-width: 0;
			color: inherit;
			text-decoration: none;
			border-radius: 999px;
		}
		.rail-foot .who {
			font-size: 13.5px;
			color: var(--fgColor-muted);
		}
		.rail-foot .me:hover .who,
		.rail-foot .me[aria-current='page'] .who {
			color: var(--fgColor-default);
			text-decoration: underline;
		}
		.rail-foot button {
			margin-left: auto;
			font: inherit;
			font-size: 12px;
			padding: 4px 9px;
			border: 1px solid var(--borderColor-default);
			border-radius: 999px;
			background: var(--bgColor-default);
			color: var(--fgColor-muted);
			cursor: pointer;
		}

		/* ONE COLUMN, centred by padding rather than by each child centring
		   itself. Capped is right -- a record row a thousand pixels wide puts
		   the label at one end and the figure at the other with a desert
		   between them -- but margin-inline:auto on every child centres a
		   narrow panel inboard of a wide list, so a note under a screen would
		   not line up with the rows it explains. This makes a content box of
		   --col; narrow things sit at its left edge. */
		:global(.pad) {
			padding: 22px max(24px, calc((100% - var(--col)) / 2)) 40px;
			gap: 22px;
			background: var(--bgColor-default);
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
