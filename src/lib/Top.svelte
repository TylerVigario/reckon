<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	/**
	 * A screen's own header: what it is called, what it is of, and where it sits.
	 *
	 * Part of the screen rather than the shell, because a title belongs to the
	 * screen under it. Links, not history -- a screen reached three ways still
	 * goes back to the one place above it.
	 *
	 * ONE ROW STAYS. The bar -- the way back, and the screen's actions -- is
	 * pinned to the top. The title and the line under it are for arriving, and
	 * scroll away beneath it, as iOS's large titles do; once they have, the title
	 * reappears in the bar, shortened to fit. Pinned whole, the header took a
	 * fifth of a phone's screen with the tab bar, and beside a back link a title
	 * was squeezed into the middle and wrapped. A screen with no way back keeps
	 * its title in the bar, since there is nothing to share it with. A browser
	 * without scroll-driven animations pins the bar without the title.
	 *
	 * `trail` IS THE WHOLE PATH, not one step of it. A single back link answers
	 * "what did I come from" and nothing else, which is fine one level down and
	 * useless three: inside a site, "Sites" alone does not say which client's
	 * sites. Every ancestor is a link, so
	 * any of them is one tap away rather than three.
	 *
	 * `back` is kept for the screens one level down, where a trail of one is
	 * just a back link with extra ceremony. It becomes a one-item trail, so
	 * there is one thing to style and one thing to get right.
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
</script>

<div class="top">
	<div class="bar">
		{#if path.length > 1}
			<nav class="crumbs" aria-label="Where this sits">
				{#each path as c, i (c.href + i)}
					{#if i}<span class="sep" aria-hidden="true">›</span>{/if}
					<a href={c.href}>{c.label}</a>
				{/each}
			</nav>
		{:else if path.length === 1}
			<a class="back" href={path[0].href}>{path[0].label}</a>
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
	   stay pinned while the rest scrolls away beneath it. */
	.top {
		display: contents;
	}
	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		box-sizing: border-box;
		padding: calc(4px + env(safe-area-inset-top)) var(--pad) 4px;
		background: var(--surface);
	}
	.fold {
		background: var(--surface);
		padding: 0 var(--pad) 10px;
		border-bottom: 1px solid var(--line);
	}
	/* Alone, the bar is the whole header, and draws its own edge. */
	.bar:last-child {
		border-bottom: 1px solid var(--line);
		padding-bottom: 8px;
	}
	/* Scrolls rather than wraps: a trail is one line, and the bar one row. */
	.crumbs {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 0 1 auto;
		min-width: 0;
		min-height: 40px;
		overflow-x: auto;
		scrollbar-width: none;
		white-space: nowrap;
		font-size: 12.5px;
	}
	.crumbs::-webkit-scrollbar {
		display: none;
	}
	.crumbs a {
		color: var(--accent);
		text-decoration: none;
	}
	.crumbs a:hover {
		text-decoration: underline;
	}
	.sep {
		color: var(--ink-3);
	}
	h1 {
		font-family: var(--f-display);
		font-weight: 700;
		font-size: 19px;
		line-height: 1.25;
		letter-spacing: -0.01em;
		color: var(--display-ink);
		margin: 0;
		flex: 1 1 auto;
		min-width: 0;
	}
	.sub {
		margin: 2px 0 0;
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--ink-3);
	}
	.act {
		display: flex;
		gap: 8px;
		flex: 0 0 auto;
		margin-left: auto;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex: 0 0 auto;
		min-height: 40px;
		padding: 6px 12px 6px 8px;
		margin-left: -6px;
		font-size: 14.5px;
		color: var(--accent);
		text-decoration: none;
		border-radius: 8px;
	}
	.back::before {
		content: '\2039';
		font-size: 20px;
		line-height: 1;
		margin-top: -2px;
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
			font-family: var(--f-display);
			font-weight: 700;
			font-size: 15px;
			color: var(--display-ink);
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
			box-shadow: 0 1px 0 var(--line);
		}
	}

	/* Content is capped, not stretched -- the same --col the screen body uses.
	   A title bar that runs the full width of a desktop window puts the name at
	   one end and the action at the other with a desert between them. */
	/* Matches the shell's rail breakpoint: the header's padding has to change
	   at the same width the layout does, or the title stops sharing a left edge
	   with the body under it. */
	@media (min-width: 1180px) {
		/* The same content box as .pad, so the title shares its left edge. */
		.bar,
		.fold {
			padding-left: max(24px, calc((100% - var(--col)) / 2));
			padding-right: max(24px, calc((100% - var(--col)) / 2));
		}
		.bar {
			padding-top: 8px;
			padding-bottom: 8px;
		}
		.fold {
			padding-bottom: 14px;
		}

		/* MORE IS A MENU, NOT A PLACE. On a narrow screen it is how you reach
		   Catalogue, Entities, Reports and Settings, so "‹ More" is the way
		   back. At this width the rail lists all four directly and there is no
		   More to go back to -- a link to it would say those sections live
		   inside something else. */
		.back[href='/more'] {
			display: none;
		}
	}
</style>
