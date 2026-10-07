<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { dated, miles } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { Decimal } from '#lib/decimal.ts';
	import { paysWhat } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// house_to_a and the rest say what a leg IS; this says it in words.
	const RULE: Record<string, string> = {
		house_to_a: 'house → A, caused by A',
		a_to_b: 'A → B, caused by B',
		b_to_house: 'B → house, caused by B',
		round_trip: 'out and back, one client',
		split: 'shared, split between them',
		unassigned: 'nobody asked for it'
	};

	const saved = $derived(
		data.trip.round_trips && data.trip.billed
			? Decimal.from(data.trip.round_trips).sub(data.trip.billed)
			: null
	);

	const title = $derived(
		[data.trip.stops ?? 'Trip', data.stops.length > 1 ? `${data.stops.length} stops` : null]
			.filter(Boolean)
			.join(' · ')
	);
	// Whose the vehicle is, and how its miles were paid.
	const whose = $derived(data.trip.owner ? `${data.trip.owner}'s` : "The business's");
	const how = $derived.by(() => {
		const t = data.trip;
		if (!t.owner) return "It is the business's, whoever drove it";
		if (t.paid === null) return 'No vehicle rule reaches them';
		if (!t.rule) return "By each leg's own rule";
		const w = paysWhat(t.rule, { money, unitPrice });
		return `${w.v} ${w.x}, each leg`;
	});
	const sub = $derived(
		[dated(data.trip.travelled_on), data.trip.driver, `${miles(data.trip.miles)} driven`]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<Top {title} {sub} back={resolve('/trips')} backLabel="Trips" />

<div class="pad">
	<div class="tiles">
		<div class="tile">
			<span class="k">Billed</span>
			<span class="v good">{money(data.trip.billed)}</span>
			<span class="s">for {miles(data.trip.miles)} driven</span>
		</div>
		{#if saved !== null && saved.gt(0)}
			<div class="tile">
				<span class="k">Not over-billed</span>
				<span class="v sm">{money(saved.toString())}</span>
				<span class="s">vs a round trip each</span>
			</div>
		{/if}
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Driven in</h2></div>
		<div class="rows">
			{#if data.trip.vehicle}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">
							{data.trip.vehicle}{#if data.trip.vehicle_retired_on}&nbsp;<span class="lt"
									>· retired</span
								>{/if}
						</div>
						<div class="rec-s">{whose}</div>
					</div>
				</div>
			{:else}
				<div class="rec warn">
					<div class="rec-m">
						<div class="rec-t">Not recorded</div>
						<div class="rec-s">
							Recorded before trips named their vehicle, so its miles pay nobody
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Stops, in order</h2></div>
		<div class="rows stops">
			<div class="legs">
				{#each data.stops as s (s.seq)}
					<div class="leg">
						<div class="stop">{s.place}</div>
						{#if s.detail}<div class="det">{s.detail}</div>{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Leg assignment</h2></div>
		<div class="rows">
			{#each data.legs as l (l.id)}
				<div class="rec" class:warn={!l.who}>
					<div class="rec-m">
						<div class="rec-t">{l.who ?? 'Nobody'}</div>
						<div class="rec-s">{l.rule ? RULE[l.rule] : 'no rule recorded'}</div>
					</div>
					<div class="rec-n">
						{#if l.who}
							<span class="rec-v">{money(l.value)}</span>
						{:else}
							<span class="rec-v mut">—</span>
						{/if}
						<span class="rec-x">{miles(l.miles)}</span>
					</div>
				</div>
			{/each}
			<div class="rec tot">
				<div class="rec-m"><div class="rec-t">Driven, and billed</div></div>
				<div class="rec-n">
					<span class="rec-v">{money(data.trip.billed)}</span>
					<span class="rec-x">{miles(data.trip.miles)}</span>
				</div>
			</div>
		</div>
	</div>
	{#if data.trip.vehicle}
		<div class="sec">
			<div class="sec-h"><h2>Paid for the vehicle</h2></div>
			<div class="rows">
				<div class="rec" class:warn={data.trip.paid === null}>
					<div class="rec-m">
						<div class="rec-t">{data.trip.owner ?? 'Nobody'}</div>
						<div class="rec-s">{how}</div>
					</div>
					<div class="rec-n">
						{#if data.trip.owner}
							<span class="rec-v">{money(data.trip.paid)}</span>
						{:else}
							<span class="rec-v mut">—</span>
						{/if}
					</div>
				</div>
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Kept</div></div>
					<div class="rec-n"><span class="rec-v">{money(data.trip.kept)}</span></div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.stops {
		padding: 14px;
	}
</style>
