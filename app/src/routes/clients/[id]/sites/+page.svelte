<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { pct } from '$lib/format';
	import Day from '$lib/Day.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// What the total is made of. A county with no district tax says so rather
	// than showing a 0.000 that reads like a figure -- Kings really does charge
	// the state's share and nothing else.
	const made = (s: { state_rate_pct: string; district_rate_pct: string }) =>
		Number(s.district_rate_pct) > 0
			? `${Number(s.state_rate_pct).toFixed(3)} state + ${Number(s.district_rate_pct).toFixed(
					3
				)} district`
			: `${Number(s.state_rate_pct).toFixed(3)} state, no district`;

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

	const active = $derived(data.sites.filter((s) => s.active));
	const sub = $derived(
		`${data.client.name} · ${active.length} ${active.length === 1 ? 'site' : 'sites'}`
	);
</script>

<Top
	title="Sites"
	{sub}
	trail={[
		{ href: resolve('/clients'), label: 'Entities' },
		{ href: resolve('/clients/[id]', { id: data.client.slug }), label: data.client.name }
	]}
>
	{#snippet actions()}
		<a class="btn pri sm" href={resolve('/clients/[id]/sites/new', { id: data.client.slug })}>New</a
		>
	{/snippet}
</Top>

<div class="pad">
	<div class="sec">
		<div class="rows">
			{#each data.sites as s (s.id)}
				<a
					class="rec link"
					class:gone={!s.active}
					class:warn={s.active && s.stale}
					href={resolve('/clients/[id]/sites/[site]', { id: data.client.slug, site: s.slug })}
				>
					<div class="rec-m">
						<div class="rec-t">
							{s.label}{#if !s.active}&nbsp;<span class="lt">· closed</span>{/if}
						</div>
						<div class="rec-s">{s.address ?? 'No address on file'}</div>
						<div class="rec-s">{ask(s)}</div>
						<div class="rec-c">
							<span class="chip">{s.jurisdiction}</span>
							<span class="chip">{made(s)}</span>
							{#if s.stale}
								<span class="chip warn">
									<span class="dot"></span>Priced <Day iso={s.verified_on} />, over 90 days ago
								</span>
							{:else}
								<span class="chip good"
									><span class="dot"></span>Priced <Day iso={s.verified_on} /></span
								>
							{/if}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{pct(s.rate_pct)}</span>
						{#if s.miles}
							<span class="rec-x">
								{Number(s.miles).toFixed(0)} mi{#if s.minutes}
									· {s.minutes} min{/if}
							</span>
						{/if}
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{:else}
				<div class="rec warn">
					<div class="rec-m">
						<div class="rec-t">Nowhere recorded</div>
						<div class="rec-s">Work has no jobsite, so no mileage can be computed</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
