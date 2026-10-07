<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
	import { unitPrice } from '#lib/money.svelte.ts';
	import Day from '#lib/Day.svelte';
	import { dated, miles } from '#lib/format.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const o = $derived(data.operator);
	// Whose it is, what it has been driven this year, and when it was retired.
	const about = (v: { owner: string | null; retired_on: string | null; miles: string }) =>
		[
			v.owner ? `${v.owner}'s` : "The business's",
			`${miles(v.miles)} on trips this year`,
			v.owner ? null : 'pays nobody',
			v.retired_on ? `retired ${dated(v.retired_on)}` : null
		]
			.filter(Boolean)
			.join(' · ');
</script>

<Top
	title="Travel"
	sub="Where trips start, what a mile costs, and the vehicles"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>Base</h2></div>
		<div class="rows">
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">Trips start and end here</div>
					<div class="rec-s">
						{o?.address ?? 'No address set'} — the base every trip starts and ends at.
					</div>
				</div>
				<div class="rec-n">
					<a class="btn sm" href={resolve('/settings/business')}>Edit</a>
				</div>
			</div>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h">
			<h2>Vehicles</h2>
			<span class="sp"></span>
			<a class="btn sm" href={resolve('/settings/travel/vehicles/new')}>Add a vehicle</a>
		</div>
		<div class="rows">
			{#each data.vehicles as v (v.id)}
				<a
					class="rec link"
					class:gone={v.retired_on}
					href={resolve('/settings/travel/vehicles/[id]', { id: v.id })}
				>
					<div class="rec-m">
						<div class="rec-t">
							{v.name}{#if v.retired_on}&nbsp;<span class="lt">· retired</span>{/if}
						</div>
						<div class="rec-s">{about(v)}</div>
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">No vehicles yet</span></div>
						<div class="rec-s">
							A trip names what it was driven in, and its owner is who its miles pay
						</div>
					</div>
				</div>
			{/each}
		</div>
		<p class="aside">
			Travel's vehicle rule pays a vehicle's owner, whoever drove it: a person's at their rule, the
			business's to nobody. One that changes hands is retired and added again, so trips already
			driven still pay who they paid.
		</p>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Rate</h2></div>
		<div class="rows">
			{#each data.rates as r (r.id)}
				<div class="rec" class:acc={r.state === 'scheduled'}>
					<div class="rec-m">
						<div class="rec-t">{r.state === 'scheduled' ? 'Scheduled' : 'Current'}</div>
						<div class="rec-s">
							{r.service} · {r.state === 'scheduled' ? 'takes over' : 'effective'}
							<Day iso={r.effective_from} />
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{unitPrice(r.rate)}</span><span class="rec-x">/mi</span>
					</div>
				</div>
			{:else}
				<div class="rec warn">
					<div class="rec-m">
						<div class="rec-t">Not priced</div>
						<div class="rec-s">Mileage is a service; give it a dated price to bill any</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">—</span></div>
				</div>
			{/each}
			{#each data.history as h (h.id)}
				<a class="rec link" href={resolve('/services/[id]/history', { id: h.id })}>
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Earlier rates</span></div>
						<div class="rec-s">
							{h.name} · {h.earlier} no longer in force, still priced on every line billed under them
						</div>
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{/each}
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>How legs are assigned</h2></div>
		<div class="rows inset">
			<Setting
				name="mileage_assignment"
				label="Rule"
				value={o?.mileage_assignment ?? 'actual'}
				options={[
					{ value: 'actual', label: 'Assign each leg to whoever caused it' },
					{ value: 'round_trip_per_client', label: 'A full round trip per client' }
				]}
				hint="Never bill more miles than were driven"
			/>
		</div>
	</div>
</div>

<style>
	.aside {
		margin: 8px 0 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
