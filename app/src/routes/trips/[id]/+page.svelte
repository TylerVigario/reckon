<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { dated } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const miles = (v: string) => `${Number(v).toFixed(1)} mi`;

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
			? Number(data.trip.round_trips) - Number(data.trip.billed)
			: null
	);

	const title = $derived(
		[data.trip.stops ?? 'Trip', data.stops.length > 1 ? `${data.stops.length} stops` : null]
			.filter(Boolean)
			.join(' · ')
	);
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
		{#if saved !== null && saved > 0}
			<div class="tile">
				<span class="k">Not over-billed</span>
				<span class="v sm">{money(String(saved))}</span>
				<span class="s">vs a round trip each</span>
			</div>
		{/if}
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
</div>

<style>
	.stops {
		padding: 14px;
	}
</style>
