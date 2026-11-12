<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SETTINGS_PAGES } from '#lib/settings-pages.ts';
	import type { LayoutProps } from './$types';

	/**
	 * Settings' screens, each with the list of them down its side on a wide
	 * screen, as GitHub's settings are (Primer's NavList, its pattern for a
	 * settings menu: six are more than a row of tabs holds). On a phone the
	 * list is the Settings screen itself, and each screen opens over it.
	 */
	let { children }: LayoutProps = $props();

	const listed = $derived(page.route.id !== '/settings');
</script>

{#if listed}
	<div class="split">
		<nav class="side primer" aria-label="Settings">
			<ul class="navlist">
				{#each SETTINGS_PAGES as p (p.route)}
					<li>
						<a
							href={resolve(p.route)}
							aria-current={page.route.id?.startsWith(p.route) ? 'page' : undefined}>{p.title}</a
						>
					</li>
				{/each}
			</ul>
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
	@media (min-width: 1180px) {
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
			border-left: 1px solid var(--line);
		}
	}
</style>
