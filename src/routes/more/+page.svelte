<script lang="ts">
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import { resolve } from '$app/paths';
	import type { RouteId } from '$app/types';
	import { beforeSigningOut } from '#lib/sign-out.svelte.ts';
	import { opens } from '#lib/access.ts';
	import Octicon from '#lib/Octicon.svelte';
	import type { OcticonName } from '#lib/octicons.ts';

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
			ic: 'package',
			sub: 'Materials, services and recurring agreements'
		},
		{
			href: '/clients',
			title: 'Entities',
			ic: 'organization',
			sub: 'Who you invoice, and where the work happens'
		},
		{
			href: '/team',
			title: 'Team',
			ic: 'people',
			sub: 'Who signs in, what they reach, and the roles they are paid as'
		},
		{
			href: '/reports/pay',
			title: 'Reports',
			ic: 'graph',
			sub: 'Pay, the retainer meter, time given away and Schedule A'
		},
		{
			href: '/settings',
			title: 'Settings',
			ic: 'gear',
			sub: 'The mark, the rates, the tax rules — everything you supply'
		},
		{
			href: '/profile',
			title: 'Your profile',
			ic: 'person',
			sub: 'Your time zone, and how dates and figures read for you'
		}
	] satisfies { href: RouteId; title: string; ic: OcticonName; sub: string }[];

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

<!-- The pane's sections on a phone, as a page of their own: Primer's NavList,
     each with what it holds under it. -->
<div class="pad primer">
	<div class="mark">
		<img src={op?.has_logo ? '/operator/logo' : '/icons/reckon.svg'} alt="" />
		<span>{name}</span>
	</div>
	<nav aria-label="More">
		<ul class="navlist">
			{#each shown as m (m.href)}
				<li>
					<a href={resolve(m.href)}>
						<Octicon name={m.ic} />
						<span class="navlist-m"
							><span>{m.title}</span><span class="navlist-b">{m.sub}</span></span
						>
					</a>
				</li>
				{#if field && m.href === '/clients' && page.data.user}
					<li>
						<a href={resolve('/reports/pay/[person]', { person: page.data.user.id })}>
							<Octicon name="creditCard" />
							<span class="navlist-m"
								><span>Your pay</span><span class="navlist-b"
									>What you are owed, and what you have been paid</span
								></span
							>
						</a>
					</li>
				{/if}
			{/each}
		</ul>
	</nav>
	<form class="out" method="POST" action="/logout" onsubmit={beforeSigningOut}>
		<p class="note">Signed in as {page.data.user?.name}{field ? ' · Field' : ''}</p>
		<button class="btn" type="submit"><Octicon name="signOut" />Sign out</button>
	</form>
</div>

<style>
	.mark {
		display: flex;
		align-items: center;
		gap: var(--base-size-8);
		font-weight: var(--base-text-weight-semibold);
	}
	.mark img {
		width: var(--base-size-32);
		height: var(--base-size-32);
		object-fit: contain;
	}
	/* The list's rows are taller on a page of their own: a label and what it
	   holds under it. */
	.navlist a {
		align-items: flex-start;
		padding-block: var(--base-size-8);
	}
	.navlist a > :global(svg) {
		margin-top: var(--base-size-2);
	}
	.out {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--base-size-8);
		padding-top: var(--base-size-16);
		border-top: var(--borderWidth-thin) solid var(--borderColor-muted);
	}
</style>
