<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SETTINGS_GROUPS } from '#lib/settings-pages.ts';
	import type { LayoutProps } from './$types';

	/**
	 * Settings' screens, each with the list of them down its side on a wide
	 * screen, grouped under headings, as GitHub's settings are (Primer's
	 * NavList, its pattern for a settings menu: ten are more than a row of tabs
	 * holds). Beside the app's own pane it is a third column, which Primer
	 * gives its wide range (1400px): "Optional range when a 3rd layout column
	 * is needed". Narrower, the list is the Settings screen itself, and each
	 * screen opens over it.
	 */
	let { children }: LayoutProps = $props();

	const listed = $derived(page.route.id !== '/settings');
</script>

{#if listed}
	<div class="split">
		<nav class="side primer" aria-label="Settings">
			{#each SETTINGS_GROUPS as g (g.title)}
				<div class="navlist-g">
					<h2 class="navlist-h">{g.title}</h2>
					<ul class="navlist">
						{#each g.pages as p (p.route)}
							<li>
								<a
									href={resolve(p.route)}
									aria-current={page.route.id?.startsWith(p.route) ? 'page' : undefined}
									>{p.title}</a
								>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>
		<div class="main">{@render children()}</div>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.side {
		display: none;
	}
	@media (min-width: 1400px) {
		.split {
			display: grid;
			grid-template-columns: 200px minmax(0, 1fr);
			align-items: start;
		}
		.side {
			display: block;
			position: sticky;
			top: 0;
			padding: 22px 12px;
		}
		.main {
			min-width: 0;
			border-left: 1px solid var(--borderColor-default);
		}
	}
</style>
