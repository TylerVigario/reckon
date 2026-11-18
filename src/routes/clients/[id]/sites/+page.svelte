<script lang="ts">
	import { count, day, miles, pct } from '#lib/format.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { opens } from '#lib/access.ts';

	let { data }: PageProps = $props();

	// Who to ask for when you get there. A site that names nobody falls back to
	// the client's primary, and says so -- asking for the wrong person at the
	// gate is what the distinction costs.
	const ask = (s: { people: { name: string; is_primary: boolean }[]; fallback: string | null }) =>
		s.people.length
			? `Ask for ${s.people[0].name}` +
				(s.people.length > 1
					? `, then ${s.people
							.slice(1)
							.map((p) => p.name)
							.join(' or ')}`
					: '')
			: s.fallback
				? `Ask for ${s.fallback}, the client's own contact`
				: 'Nobody to ask for';
</script>

<section class="box" aria-labelledby="sites-h">
	<div class="box-h">
		<h2 class="box-t" id="sites-h">Sites</h2>
		{#if opens(data.user?.access, '/clients/[id]/sites/new')}
			<a class="btn sm" href={resolve('/clients/[id]/sites/new', { id: data.client.slug })}
				>New site</a
			>
		{/if}
	</div>
	{#each data.sites as s (s.id)}
		<a
			class="box-row"
			href={resolve('/clients/[id]/sites/[site]', { id: data.client.slug, site: s.slug })}
		>
			<span class="what">
				<span class="n">{s.label}</span>
				<span class="sub">{s.address ?? 'No address on file'}</span>
				<span class="sub">{ask(s)}</span>
				{#if !s.active}
					<span class="lab">Closed</span>
				{:else if s.stale}
					<span class="lab warn">Rate last confirmed {day(s.confirmed_on)}</span>
				{/if}
			</span>
			<span class="fig">
				<span class="v">{pct(s.rate_pct)}</span>
				{#if s.miles}
					<span class="sub">
						{[miles(s.miles, 'distance'), s.minutes ? count(s.minutes, 'minute', 'short') : null]
							.filter(Boolean)
							.join(' · ')}
					</span>
				{/if}
			</span>
		</a>
	{:else}
		<p class="box-row muted">
			Nowhere recorded: work has no jobsite, so no mileage can be worked out.
		</p>
	{/each}
</section>

<style>
	.box-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		box-sizing: border-box;
		margin: 0;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.lab {
		margin-top: 4px;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
</style>
