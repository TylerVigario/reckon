<script lang="ts">
	import { page } from '$app/state';
	import Top from '$lib/Top.svelte';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';

	const op = $derived(page.data.operator);
	const name = $derived(op?.trading_name ?? 'reckon');

	// Three levels at most: tab, then list, then detail. This is the list.
	//
	// It once carried rows with no screen behind them, drawn greyed as "not
	// built yet" rather than hidden, because what is missing is part of what
	// the shape is. Every row has a screen now, and typing these against the
	// real route list is what said so: the branch drawing an unbuilt row had
	// become unreachable. Bring it back alongside a `href: null` row when there
	// is one to draw.
	const menu = [
		{
			href: '/catalogue',
			title: 'Catalogue',
			sub: 'Services, materials and recurring agreements'
		},
		{ href: '/clients', title: 'Entities', sub: 'Who you invoice, and where the work happens' },
		{ href: '/reports', title: 'Reports', sub: 'Schedule A, partner pay and the retainer meter' },
		{
			href: '/settings',
			title: 'Settings',
			sub: 'The mark, the rates, the tax rules — everything you supply'
		}
	] satisfies { href: Pathname; title: string; sub: string }[];
</script>

<Top title="More" sub="Catalogue, entities, reports" />

<div class="pad">
	<div class="brandhd">
		{#if op?.has_logo}
			<img src="/operator/logo" alt={name} />
		{:else}
			<b>{name}</b>
		{/if}
		<span>invoicing and time tracking</span>
	</div>

	<div class="sec">
		<div class="rows">
			{#each menu as m (m.href)}
				<a class="rec link" href={resolve(m.href)}>
					<div class="rec-m">
						<div class="rec-t">{m.title}</div>
						<div class="rec-s">{m.sub}</div>
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{/each}
		</div>
	</div>

	<form class="out" method="POST" action="/logout">
		<span>Signed in as {page.data.user?.name}</span>
		<button type="submit">Sign out</button>
	</form>
</div>

<style>
	.pad {
		padding: var(--pad);
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.pad > * {
		max-width: 960px;
	}

	.brandhd {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.brandhd img {
		height: 44px;
		width: auto;
		max-width: 260px;
	}
	.brandhd b {
		font-family: var(--f-display);
		font-size: 22px;
		color: var(--display-ink);
	}
	.brandhd span {
		font-size: 13px;
		color: var(--ink-3);
	}

	.sec {
		display: flex;
		flex-direction: column;
	}
	.rows {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r);
		overflow: hidden;
	}
	.rec {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--line-soft);
		min-height: 56px;
		box-sizing: border-box;
		color: inherit;
		text-decoration: none;
	}
	.rec:last-child {
		border-bottom: 0;
	}
	.rec-m {
		flex: 1 1 auto;
		min-width: 0;
	}
	.rec-t {
		font-size: 15px;
		font-weight: 600;
		line-height: 1.3;
	}
	.rec-s {
		font-size: 13.5px;
		color: var(--ink-3);
		margin-top: 3px;
		line-height: 1.4;
	}
	.arw {
		color: var(--ink-3);
		font-family: var(--f-mono);
		font-size: 16px;
	}

	.out {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.out span {
		font-size: 13px;
		color: var(--ink-3);
	}
	.out button {
		font: inherit;
		font-size: 13px;
		padding: 7px 14px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink-2);
		cursor: pointer;
	}
</style>
