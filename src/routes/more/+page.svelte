<script lang="ts">
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import { resolve } from '$app/paths';
	import type { RouteId } from '$app/types';
	import { beforeSigningOut } from '#lib/sign-out.svelte.ts';
	import { opens } from '#lib/access.ts';

	const op = $derived(page.data.operator);
	const name = $derived(op?.trading_name ?? 'reckon');

	// Three levels at most: tab, then list, then detail. This is the list.
	//
	// Every row has a screen, and the paths are typed against the real route
	// list, so a row with nowhere to go is a type error.
	const menu = [
		{
			href: '/catalogue/materials',
			title: 'Catalogue',
			sub: 'Materials, services and recurring agreements'
		},
		{ href: '/clients', title: 'Entities', sub: 'Who you invoice, and where the work happens' },
		{
			href: '/team',
			title: 'Team',
			sub: 'Who signs in, what they reach, and the roles they are paid as'
		},
		{
			href: '/reports/pay',
			title: 'Reports',
			sub: 'Pay, the retainer meter, time given away and Schedule A'
		},
		{
			href: '/settings',
			title: 'Settings',
			sub: 'The mark, the rates, the tax rules — everything you supply'
		},
		{
			href: '/profile',
			title: 'Your profile',
			sub: 'Your time zone, and how dates and figures read for you'
		}
	] satisfies { href: RouteId; title: string; sub: string }[];

	// Each row only where it opens for this person (#lib/access). Someone with
	// Field has their own pay here, in place of the reports; the entities read
	// as where the work happens, since what each owes is not theirs to see.
	const access = $derived(page.data.user?.access ?? null);
	const field = $derived(access === 'field');
	const shown = $derived(
		menu
			.filter((m) => opens(access, m.href))
			.map((m) =>
				field && m.href === '/clients'
					? { ...m, sub: 'Who the work is for, and where it happens' }
					: m
			)
	);
</script>

<Top title="More" sub={field ? 'Entities, your pay' : 'Catalogue, entities, team, reports'} />

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
			{#each shown as m (m.href)}
				<a class="rec link" href={resolve(m.href)}>
					<div class="rec-m">
						<div class="rec-t">{m.title}</div>
						<div class="rec-s">{m.sub}</div>
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
				{#if field && m.href === '/clients' && page.data.user}
					<a
						class="rec link"
						href={resolve('/reports/pay/[person]', { person: page.data.user.id })}
					>
						<div class="rec-m">
							<div class="rec-t">Your pay</div>
							<div class="rec-s">What you are owed, and what you have been paid</div>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{/if}
			{/each}
		</div>
	</div>

	<form class="out" method="POST" action="/logout" onsubmit={beforeSigningOut}>
		<span>Signed in as {page.data.user?.name}{field ? ' · Field' : ''}</span>
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
