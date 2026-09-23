<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	/**
	 * A screen's own header: what it is called, what it is of, and where it sits.
	 *
	 * Sticky to the top of the screen rather than sitting in the shell, because
	 * a title belongs to the screen under it. Links, not history -- a screen
	 * reached three ways still goes back to the one place above it.
	 *
	 * `trail` IS THE WHOLE PATH, not one step of it. A single back link answers
	 * "what did I come from" and nothing else, which is fine one level down and
	 * useless three: inside a site the only way out was "Sites", and which
	 * client's sites was not on the screen at all. Every ancestor is a link, so
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
	{#if path.length > 1}
		<nav class="crumbs" aria-label="Where this sits">
			{#each path as c, i (c.href + i)}
				{#if i}<span class="sep" aria-hidden="true">›</span>{/if}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the caller; ResolvedPathname enforces it -->
				<a href={c.href}>{c.label}</a>
			{/each}
		</nav>
	{/if}
	<div class="inner">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- as above -->
		{#if path.length === 1}<a class="back" href={path[0].href}>{path[0].label}</a>{/if}
		<h1>
			{title}{#if sub}<small>{sub}</small>{/if}
		</h1>
		{#if actions}<div class="act">{@render actions()}</div>{/if}
	</div>
</div>

<style>
	.top {
		position: sticky;
		top: 0;
		z-index: 20;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
		padding: calc(12px + env(safe-area-inset-top)) var(--pad) 12px;
	}
	/* The bar runs the full width; what is inside it lines up with the reading
	   column below. Capping the h1 instead put the title 34px off the tiles,
	   because the row is a flex box and the action button on the right changes
	   where the middle is. */
	.inner {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	/* Scrolls rather than wraps: a trail that grows to two lines moves the
	   title down, and the title is what the eye is looking for. */
	.crumbs {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 0 6px;
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
		letter-spacing: -0.01em;
		color: var(--display-ink);
		margin: 0;
		flex: 1 1 auto;
		min-width: 0;
	}
	h1 small {
		display: block;
		font-family: var(--f-text);
		font-weight: 400;
		font-size: 12.5px;
		color: var(--ink-3);
		letter-spacing: 0;
		margin-top: 2px;
	}
	.act {
		display: flex;
		gap: 8px;
		flex: 0 0 auto;
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

	/* Content is capped, not stretched -- the same 960px the screen body uses.
	   A title bar that runs the full width of a desktop window puts the name at
	   one end and the action at the other with a desert between them. */
	/* Matches the shell's rail breakpoint: the header's padding has to change
	   at the same width the layout does, or the title stops sharing a left edge
	   with the body under it. */
	@media (min-width: 1180px) {
		/* The same content box as .pad, so the title shares its left edge. */
		.top {
			padding: 16px max(24px, calc((100% - var(--col)) / 2));
		}

		/* MORE IS A MENU, NOT A PLACE. On a narrow screen it is how you reach
		   Catalogue, Entities, Reports and Settings, so "‹ More" is the way
		   back. At this width the rail lists all four directly and there is no
		   More to go back to -- a link to it says those sections live inside
		   something, which is what put Catalogue and Entities under Settings. */
		.back[href='/more'] {
			display: none;
		}
	}
</style>
