<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import Octicon from './Octicon.svelte';
	/**
	 * A screen's own header, Primer's PageHeader: where it sits, what it is
	 * called, what it is of, and what can be done to it.
	 *
	 * Part of the screen rather than the shell, because a title belongs to the
	 * screen under it. Links, not history -- a screen reached three ways still
	 * goes back to the one place above it.
	 *
	 * ONE ROW STAYS. The context bar -- the way up, and the screen's actions --
	 * is pinned to the top. The title and the line under it are for arriving,
	 * and scroll away beneath it, as iOS's large titles do; once they have, the
	 * title reappears in the bar, shortened to fit. Pinned whole, the header took
	 * a fifth of a phone's screen with the tab bar, and beside a back link a
	 * title was squeezed into the middle and wrapped. A screen with no way up
	 * keeps its title in the bar, since there is nothing to share it with. A
	 * browser without scroll-driven animations pins the bar without the title.
	 * The bar is Primer's context area, which it hides at its regular width by
	 * default and is shown here at every width, so the way up and the actions
	 * keep one place.
	 *
	 * ONE LEVEL UP IS PRIMER'S PARENT LINK -- an arrow and the parent's name,
	 * muted -- "the default way to let users navigate up in the hierarchy".
	 * DEEPER, `trail` IS THE WHOLE PATH, as Primer's Breadcrumbs: "If the flow
	 * allows the user to go deeper than the detail page, use a breadcrumb to
	 * allow users to navigate anywhere in the hierarchy." Inside a site,
	 * "Sites" alone does not say which client's sites. Every ancestor is a link,
	 * so any of them is one tap away rather than three.
	 *
	 * `back` is kept for the screens one level down, where a trail of one is
	 * the parent link. It becomes a one-item trail, so there is one thing to
	 * get right.
	 *
	 * PATHS ARRIVE ALREADY RESOLVED. This component cannot resolve them itself
	 * -- resolve() is overloaded per route and picks its overload from a
	 * literal, which a shared component never has. So the caller resolves and
	 * the type here says so: ResolvedPathname refuses '/clinets' and
	 * '/nonsense' alike, which is the same guarantee resolve() gives, moved to
	 * where the route is actually known.
	 */
	let {
		title,
		sub = '',
		back = null,
		backLabel = '',
		trail = null,
		actions
	}: {
		title: string;
		sub?: string;
		/** A screen, resolved with its query where it has one: a draft started on a phone. */
		back?: ResolvedPathname | null;
		backLabel?: string;
		/** Every ancestor, outermost first. The current screen is the title. */
		trail?: { href: ResolvedPathname; label: string }[] | null;
		actions?: import('svelte').Snippet;
	} = $props();

	const path = $derived(
		trail && trail.length ? trail : back ? [{ href: back, label: backLabel || 'Back' }] : []
	);
	// Up to More, which the pane replaces from 768px: there the bar has nothing
	// to hold but the actions, and with none it goes, as Primer's context area
	// does at its regular width.
	const upToMore = $derived(path.length === 1 && path[0].href === '/more');
</script>

<div class="top">
	<div class="bar" class:bare={upToMore && !actions}>
		{#if path.length > 1}
			<nav class="crumbs" aria-label="Breadcrumbs">
				<ol>
					{#each path as c, i (c.href + i)}
						<li><a href={c.href}>{c.label}</a></li>
					{/each}
				</ol>
			</nav>
		{:else if path.length === 1}
			<a class="parent" href={path[0].href}><Octicon name="arrowLeft" />{path[0].label}</a>
		{/if}
		{#if path.length}
			<!-- The title again, for once the heading has scrolled away. -->
			<span class="mini" aria-hidden="true">{title}</span>
		{:else}
			<h1>{title}</h1>
		{/if}
		{#if actions}<div class="act">{@render actions()}</div>{/if}
	</div>
	{#if path.length || sub}
		<div class="fold">
			{#if path.length}<h1>{title}</h1>{/if}
			{#if sub}<p class="sub">{sub}</p>{/if}
		</div>
	{/if}
</div>

<style>
	/* The bar and what is under it stand in the screen itself, so the bar can
	   stay pinned while the rest scrolls away beneath it. Both share the
	   content's left edge and width (+layout.svelte's .pad). */
	.top {
		display: contents;
	}
	.bar,
	.fold {
		padding-inline: max(var(--pad), calc((100% - var(--col)) / 2));
		background: var(--bgColor-default);
	}
	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: var(--stack-gap-condensed);
		min-height: 48px;
		box-sizing: border-box;
		padding-top: env(safe-area-inset-top);
		font-size: var(--text-body-size-medium);
		line-height: var(--text-body-lineHeight-medium);
	}
	/* Primer's PageHeader with its border: the line under it, 8px below. */
	.fold {
		padding-bottom: var(--base-size-8);
		border-bottom: var(--borderWidth-thin) solid var(--borderColor-default);
	}
	/* Alone, the bar is the whole header, and draws its own edge. */
	.bar:last-child {
		border-bottom: var(--borderWidth-thin) solid var(--borderColor-default);
	}
	.parent {
		display: inline-flex;
		align-items: center;
		gap: var(--stack-gap-condensed);
		flex: 0 0 auto;
		min-height: max(var(--control-medium-size), var(--control-minTarget-auto, 0px));
		color: var(--fgColor-muted);
		text-decoration: none;
	}
	.parent:hover {
		color: var(--fgColor-accent);
		text-decoration: underline;
	}
	/* Primer's Breadcrumbs: links, each followed by its slanted rule. One
	   line, scrolled rather than wrapped, since the bar is one row. */
	.crumbs {
		flex: 0 1 auto;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.crumbs::-webkit-scrollbar {
		display: none;
	}
	.crumbs ol {
		display: flex;
		align-items: center;
		min-height: max(var(--control-medium-size), var(--control-minTarget-auto, 0px));
		margin: 0;
		padding: 0;
		white-space: nowrap;
		list-style: none;
	}
	.crumbs li::after {
		display: inline-block;
		height: 0.8em;
		margin: 0 0.5em;
		content: '';
		border-right: 0.1em solid var(--fgColor-muted);
		transform: rotate(15deg) translateY(0.0625em);
	}
	.crumbs li:last-child::after {
		content: none;
	}
	.crumbs a {
		color: var(--fgColor-link, var(--fgColor-accent));
		text-decoration: none;
	}
	.crumbs a:hover {
		text-decoration: underline;
	}
	.parent:focus-visible,
	.crumbs a:focus-visible {
		outline: 2px solid var(--focus-outlineColor);
		outline-offset: 2px;
		border-radius: var(--borderRadius-small);
	}
	/* Primer's title: its medium size, semibold. */
	h1 {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: var(--text-title-size-medium);
		font-weight: var(--text-title-weight-medium);
		line-height: var(--text-title-lineHeight-medium);
		color: var(--fgColor-default);
		overflow-wrap: anywhere;
	}
	.sub {
		margin: 0;
		font-size: var(--text-body-size-medium);
		line-height: var(--text-body-lineHeight-medium);
		color: var(--fgColor-muted);
	}
	.act {
		display: flex;
		align-items: center;
		gap: var(--stack-gap-condensed);
		flex: 0 0 auto;
		margin-left: auto;
	}

	/* The title in the bar, and the bar's edge, arrive as the heading leaves:
	   driven by the page's own scroll, so they need no script and follow the
	   finger. Without it the bar is pinned with neither. */
	.mini {
		display: none;
	}
	@supports (animation-timeline: scroll()) {
		.mini {
			display: block;
			flex: 1 1 0;
			min-width: 0;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
			font-weight: var(--base-text-weight-semibold);
			color: var(--fgColor-default);
			opacity: 0;
			animation: appear linear both;
			animation-timeline: scroll(root);
			animation-range: 24px 56px;
		}
		.bar:not(:last-child) {
			animation: edge linear both;
			animation-timeline: scroll(root);
			animation-range: 0 12px;
		}
	}
	@keyframes appear {
		to {
			opacity: 1;
		}
	}
	@keyframes edge {
		to {
			box-shadow: 0 1px 0 var(--borderColor-default);
		}
	}

	/* MORE IS A PAGE ONLY ON A PHONE. There it is how you reach Catalogue,
	   Entities, Reports and Settings, so "More" is the way up. Where the pane
	   lists all four (+layout.svelte, 768px) there is no More to go up to -- a
	   link to it would say those sections live inside something else. */
	@media (min-width: 768px) {
		.parent[href='/more'] {
			display: none;
		}
		.bar.bare {
			display: none;
		}
		.bar.bare + .fold {
			padding-top: var(--base-size-16);
		}
	}
</style>
