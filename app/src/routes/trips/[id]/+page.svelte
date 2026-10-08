<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { dated, miles, quantity } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto } from '$app/navigation';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { findTrip, waitingCount, type QueuedTrip } from '#lib/queue.ts';
	import { onMount } from 'svelte';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { Decimal } from '#lib/decimal.ts';
	import { paysWhat } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// house_to_a and the rest say what a leg IS; this says it in words.
	const RULE: Record<string, string> = {
		house_to_a: 'base → A, caused by A',
		a_to_b: 'A → B, caused by B',
		b_to_house: 'B → base, caused by B',
		round_trip: 'out and back, one client',
		split: 'shared, split between them',
		chosen: 'given by hand',
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
	// A stop is its site, or the address two clients share, or somewhere else;
	// under it, who it was for.
	type StopRow = (typeof data.stops)[number];
	const placeOf = (s: StopRow) =>
		s.clients.length > 1 ? (s.street ?? s.site) : (s.site ?? s.address ?? 'Unrecorded');
	const forWhom = (s: StopRow) =>
		s.clients.length === 0
			? s.address
				? "The business's own errand"
				: null
			: s.clients
					.map((c) =>
						[s.clients.length > 1 ? c.site : null, c.asked_there ? 'asked once there' : null]
							.filter(Boolean)
							.reduce((line, x) => `${line} · ${x}`, c.name)
					)
					.join('\n');
	const odometer = $derived(
		data.trip.odometer_start && data.trip.odometer_end
			? `odometer ${quantity(data.trip.odometer_start)} → ${quantity(data.trip.odometer_end)}`
			: null
	);
	let problem = $state('');
	// A change to this trip made on this phone and not yet arrived (#lib/queue).
	let changed = $state<QueuedTrip | null>(null);
	let waiting = $state(0);
	onMount(() => {
		void findTrip(data.trip.id).then(
			(q) => (changed = q ?? null),
			() => {}
		);
		void waitingCount().then(
			(n) => (waiting = n),
			() => {}
		);
	});
	async function remove() {
		problem = '';
		const r = await fetch(`/api/trips/${data.trip.id}`, { method: 'DELETE' }).catch(() => null);
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).detail ?? 'Not removed.')
				: 'Not removed — no connection.';
			return;
		}
		await goto(resolve('/trips'));
	}

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

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if changed}
		<div class="rows">
			<div class="rec" class:acc={!changed.refused} class:warn={changed.refused}>
				<div class="rec-m">
					{#if changed.refused}
						<div class="rec-t">A change made on this phone was not sent</div>
						<div class="rec-s">
							{Object.values(changed.refused.errors ?? {})[0] ?? changed.refused.detail}
						</div>
					{:else}
						<div class="rec-t">Changed on this phone</div>
						<div class="rec-s">
							It is sent when there is a signal. This is the trip as it was before.
						</div>
					{/if}
				</div>
				{#if changed.refused}
					<div class="rec-n">
						<a
							class="btn sm"
							href={`${resolve('/trips/new')}?fix=${encodeURIComponent(data.trip.id)}`}>Fix</a
						>
					</div>
				{/if}
			</div>
		</div>
	{/if}
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
						<div class="rec-s">{[whose, odometer].filter(Boolean).join(' · ')}</div>
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
				<div class="leg"><div class="stop">{data.trip.start_address ?? 'Base'}</div></div>
				{#each data.stops as s (s.seq)}
					{@const who = forWhom(s)}
					<div class="leg">
						<div class="stop">{placeOf(s)}</div>
						{#if who}<div class="det">{who}</div>{/if}
					</div>
				{/each}
				<div class="leg"><div class="stop">{data.trip.end_address ?? 'Base'}</div></div>
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
	{#if data.trip.note}
		<div class="sec">
			<div class="sec-h"><h2>What it was for</h2></div>
			<div class="rows">
				<div class="rec">
					<div class="rec-m"><div class="rec-s">{data.trip.note}</div></div>
				</div>
			</div>
		</div>
	{/if}
	{#if data.trip.invoiced}
		<p class="aside">Its miles are on an invoice, so it stays as it was billed.</p>
	{:else}
		<div class="btnrow">
			<a class="btn" href={resolve('/trips/[id]/change', { id: data.trip.id })}>Change this trip</a>
			<button type="button" class="btn gho" onclick={remove}>Remove this trip</button>
		</div>
		{#if problem}<p class="why bad">{problem}</p>{/if}
	{/if}
</div>

<style>
	.stops {
		padding: 14px;
	}
	.det {
		white-space: pre-line;
	}
	.why {
		margin: 0;
	}
	.aside {
		margin: 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.why.bad {
		color: var(--crit);
	}
</style>
