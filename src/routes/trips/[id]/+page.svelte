<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
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
	// Removing asks first: it cannot be undone, and it takes with it what the
	// trip would bill the client and what it owes the vehicle's owner.
	let removing = $state(false);
	let working = $state(false);
	const goesWith = $derived(
		[
			data.trip.billed === null || Decimal.from(data.trip.billed).isZero()
				? null
				: `${money(data.trip.billed)} not yet billed to the client`,
			data.trip.owner && data.trip.paid && !Decimal.from(data.trip.paid).isZero()
				? `${money(data.trip.paid)} owed to ${data.trip.owner} for the vehicle`
				: null
		].filter(Boolean)
	);

	async function remove() {
		problem = '';
		working = true;
		const r = await fetch(`/api/trips/${data.trip.id}`, { method: 'DELETE' }).catch(() => null);
		if (!r?.ok) {
			working = false;
			removing = false;
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
		if (t.withheld) return 'What it pays them is theirs to see';
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

<Top {title} {sub} back={resolve('/trips')} backLabel="Trips">
	{#snippet actions()}
		{#if data.trip.changeable && !data.trip.invoiced && !data.trip.paid_for}
			<a class="btn sm" href={resolve('/trips/[id]/change', { id: data.trip.id })}>Change</a>
		{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad primer">
	{#if problem}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}
	{#if changed?.refused}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t">
					A change made on this phone was not sent: {Object.values(
						changed.refused.errors ?? {}
					)[0] ?? changed.refused.detail}
				</p>
			</div>
		</div>
		<div class="acts">
			<a class="btn pri" href={resolve(`/trips/new?fix=${encodeURIComponent(data.trip.id)}`)}
				>Fix it</a
			>
		</div>
	{:else if changed}
		<div class="banner" role="status">
			<Octicon name="info" />
			<div class="banner-m">
				<p class="banner-t">
					Changed on this phone, and sent when there is a signal. This is the trip as it was before.
				</p>
			</div>
		</div>
	{/if}

	{#if data.trip.billed !== null}
		<div class="state">
			<span class="lab {data.trip.invoiced ? 'good' : ''}"
				>{data.trip.invoiced ? 'Invoiced' : 'Not yet billed'}</span
			>
			<span class="muted">
				{money(data.trip.billed)} for {miles(data.trip.miles)}{saved !== null && saved.gt(0)
					? ` · ${money(saved.toString())} less than a round trip to each`
					: ''}
			</span>
		</div>
	{/if}

	<section class="box" aria-labelledby="in-h">
		<div class="box-h"><h2 class="box-t" id="in-h">Driven in</h2></div>
		<div class="box-row line">
			<span class="what">
				{#if data.trip.vehicle}
					<span class="n">{data.trip.vehicle}</span>
					<span class="sub">{[whose, odometer].filter(Boolean).join(' · ')}</span>
				{:else}
					<span class="n">Not recorded</span>
					<span class="sub">Recorded before trips named their vehicle, so its miles pay nobody</span
					>
				{/if}
			</span>
			{#if data.trip.vehicle_retired_on}<span class="lab">Retired</span>{/if}
			{#if !data.trip.vehicle}<span class="lab warn">No vehicle</span>{/if}
		</div>
	</section>

	<section class="box" aria-labelledby="stops-h">
		<div class="box-h"><h2 class="box-t" id="stops-h">Stops, in order</h2></div>
		<div class="box-row">
			<ol class="tl" aria-labelledby="stops-h">
				<li class="tl-i">
					<span class="tl-b" aria-hidden="true"></span>
					<span class="tl-m"><span class="n">{data.trip.start_address ?? 'Base'}</span></span>
				</li>
				{#each data.stops as s (s.seq)}
					{@const who = forWhom(s)}
					<li class="tl-i">
						<span class="tl-b" aria-hidden="true"></span>
						<span class="tl-m">
							<span class="n">{placeOf(s)}</span>
							{#if who}<span class="sub det">{who}</span>{/if}
						</span>
					</li>
				{/each}
				<li class="tl-i">
					<span class="tl-b" aria-hidden="true"></span>
					<span class="tl-m"><span class="n">{data.trip.end_address ?? 'Base'}</span></span>
				</li>
			</ol>
		</div>
	</section>

	<section class="box" aria-labelledby="legs-h">
		<div class="box-h"><h2 class="box-t" id="legs-h">Legs, to whoever caused them</h2></div>
		{#each data.legs as l (l.id)}
			<div class="box-row line">
				<span class="what">
					<span class="n">{l.who ?? 'Nobody'}</span>
					<span class="sub">{l.rule ? RULE[l.rule] : 'no rule recorded'}</span>
				</span>
				{#if !l.who}<span class="lab warn">Unassigned</span>{/if}
				<span class="fig">
					{#if data.offline}
						<span class="v">{miles(l.miles)}</span>
					{:else}
						<span class="v" class:mut={!l.who}>{l.who ? money(l.value) : '—'}</span>
						<span class="sub">{miles(l.miles)}</span>
					{/if}
				</span>
			</div>
		{/each}
		<div class="box-row line tot">
			<span class="what"
				><span class="n">{data.offline ? 'Driven' : 'Driven, and billed'}</span></span
			>
			<span class="fig">
				{#if data.offline}
					<span class="v">{miles(data.trip.miles)}</span>
				{:else}
					<span class="v">{money(data.trip.billed)}</span>
					<span class="sub">{miles(data.trip.miles)}</span>
				{/if}
			</span>
		</div>
	</section>

	{#if data.trip.vehicle && !data.offline}
		<section class="box" aria-labelledby="paid-h">
			<div class="box-h"><h2 class="box-t" id="paid-h">Paid for the vehicle</h2></div>
			<div class="box-row line">
				<span class="what">
					<span class="n">{data.trip.owner ?? 'Nobody'}</span>
					<span class="sub">{how}</span>
				</span>
				{#if data.trip.paid === null && !data.trip.withheld && data.trip.owner}<span
						class="lab warn">No rule</span
					>{/if}
				<span class="fig">
					<span class="v" class:mut={!data.trip.owner || data.trip.withheld}
						>{data.trip.owner && !data.trip.withheld ? money(data.trip.paid) : '—'}</span
					>
				</span>
			</div>
			<!-- What the business kept is Full's to see (#lib/access). -->
			{#if data.user?.access === 'full'}
				<div class="box-row line tot">
					<span class="what"><span class="n">Kept</span></span>
					<span class="fig"><span class="v">{money(data.trip.kept)}</span></span>
				</div>
			{/if}
		</section>
	{/if}

	{#if data.trip.note}
		<section class="box" aria-labelledby="note-h">
			<div class="box-h"><h2 class="box-t" id="note-h">What it was for</h2></div>
			<div class="box-row">{data.trip.note}</div>
		</section>
	{/if}

	{#if data.offline}
		<p class="note">What it bills, and what it pays for the vehicle, needs a connection.</p>
	{/if}
	{#if data.trip.invoiced}
		<p class="note">Its miles are on an invoice, so it stays as it was billed.</p>
	{:else if data.trip.paid_for}
		<p class="note">Its miles are in a payment for the vehicle, so it stays as it was paid.</p>
	{:else if !data.trip.changeable}
		<p class="note">Someone else recorded it, so it is theirs to change.</p>
	{:else if !data.offline}
		<!-- Removing needs the server; a trip opened with no signal does not offer it. -->
		<div class="acts">
			<button type="button" class="btn danger" onclick={() => (removing = true)}
				>Remove this trip</button
			>
		</div>
	{/if}
</div>

<Dialog
	open={removing}
	title="Remove this trip?"
	go="Remove it for good"
	going="Removing…"
	tone="danger"
	{working}
	ongo={remove}
	onclose={() => (removing = false)}
>
	<p>
		{miles(data.trip.miles)} driven on {dated(data.trip.travelled_on)}, with its stops and legs.{goesWith.length
			? ` It takes with it ${goesWith.join(' and ')}.`
			: ''} This cannot be undone.
	</p>
</Dialog>

<style>
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
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
	.det {
		white-space: pre-line;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.v.mut {
		color: var(--fgColor-muted);
	}
	.tot {
		background: var(--bgColor-muted);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
</style>
