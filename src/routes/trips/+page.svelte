<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { day, miles } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { discardTrip, flush, tripsHeld, waitingCount, type QueuedTrip } from '#lib/queue.ts';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// Trips recorded or changed on this phone and not yet arrived (#lib/queue):
	// waiting for a signal, or refused, with the server's reason, to be fixed
	// or let go.
	let onPhone = $state<QueuedTrip[]>([]);
	let waiting = $state(0);
	const read = async () => {
		onPhone = await tripsHeld().catch(() => []);
		waiting = await waitingCount().catch(() => 0);
	};
	// Back in signal with the list open, what waits goes, and the list says so.
	onMount(() => {
		void read();
		const back = () => void flush().then(read, read);
		addEventListener('online', back);
		return () => removeEventListener('online', back);
	});
	// One tap does not let a trip go; a second, within a few seconds, does.
	let confirming = $state<string | null>(null);
	async function letGo(key: string) {
		if (confirming !== key) {
			confirming = key;
			setTimeout(() => {
				if (confirming === key) confirming = null;
			}, 4000);
			return;
		}
		confirming = null;
		await discardTrip(key).catch(() => {});
		await read();
	}
	const fix = (key: string) => resolve(`/trips/new?fix=${encodeURIComponent(key)}`);
	const shown = (q: QueuedTrip) =>
		[
			day(q.trip.shown.day),
			q.trip.shown.driver,
			q.trip.shown.miles ? miles(q.trip.shown.miles) : null,
			q.trip.trip_id ? 'a change to a saved trip' : null
		]
			.filter(Boolean)
			.join(' · ');

	// Built here rather than in the markup: an {#if} inside a sentence eats the
	// space in front of its separator, which reads as "Avery Lind· Harbor Light Dental".
	const detail = (t: {
		travelled_on: string;
		driver: string | null;
		vehicle: string | null;
		clients: string | null;
	}) =>
		[day(t.travelled_on), t.driver ?? 'unassigned', t.vehicle, t.clients]
			.filter(Boolean)
			.join(' · ');

	const title = (t: { stops: string | null; stop_count: number }) =>
		[t.stops ?? 'No stops recorded', t.stop_count > 1 ? `${t.stop_count} stops` : null]
			.filter(Boolean)
			.join(' · ');

	// The copy kept for no signal is the person's own trips still to put right
	// (#lib/offline-copy).
	const sub = $derived(
		[
			data.offline ? 'Yours, not yet billed' : data.totals?.month,
			`${data.totals?.trips ?? 0} ${Number(data.totals?.trips) === 1 ? 'trip' : 'trips'}`,
			miles(data.totals?.miles ?? '0')
		].join(' · ')
	);
</script>

<Top title="Trips" {sub}>
	{#snippet actions()}
		<a class="btn sm" href={resolve('/trips/new')}>New</a>
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad primer">
	{#if onPhone.length}
		<section class="box" aria-labelledby="phone-h">
			<div class="box-h">
				<h2 class="box-t" id="phone-h">On this phone</h2>
				<span class="count">{onPhone.length}</span>
			</div>
			{#each onPhone as q (q.trip.key)}
				<div class="box-row line" class:held={q.refused}>
					<span class="what">
						<span class="n">{q.trip.shown.label || 'A trip'}</span>
						<span class="sub">{shown(q)}</span>
						{#if q.refused}
							<span class="sub bad">
								Not sent: {Object.values(q.refused.errors ?? {})[0] ?? q.refused.detail}
							</span>
						{/if}
					</span>
					{#if q.refused}
						<span class="acts">
							<a class="btn sm pri" href={fix(q.trip.key)}>Fix</a>
							<button type="button" class="btn sm danger" onclick={() => letGo(q.trip.key)}
								>{confirming === q.trip.key ? 'Tap again to discard' : 'Discard'}</button
							>
						</span>
					{:else}
						<span class="lab acc">Waiting to send</span>
					{/if}
				</div>
			{/each}
		</section>
	{/if}
	{#each [{ key: 'unbilled', head: 'Unbilled', rows: data.unbilled }, { key: 'billed', head: 'Billed', rows: data.billed }] as group (group.key)}
		{#if group.rows.length}
			<section class="box" aria-labelledby="{group.key}-h">
				<div class="box-h">
					<h2 class="box-t" id="{group.key}-h">{group.head}</h2>
					<!-- The price opens the service it is the price of, for whoever may open it. -->
					{#if group.key === 'unbilled' && data.totals?.rate}
						{#if data.totals.rate_of && data.user?.access === 'full'}
							<a class="lk" href={resolve('/catalogue/services/[id]', { id: data.totals.rate_of })}
								>{unitPrice(data.totals.rate)} a mile</a
							>
						{:else}
							<span class="sub">{unitPrice(data.totals.rate)} a mile</span>
						{/if}
					{/if}
				</div>
				{#each group.rows as t (t.id)}
					<a class="box-row line" href={resolve('/trips/[id]', { id: t.id })}>
						<span class="what">
							<span class="n">{title(t)}</span>
							<span class="sub">{detail(t)}</span>
							{#if t.legs > 1}
								<span class="sub">One drive, {t.legs} legs</span>
								<span class="labs">
									{#if t.balanced}
										<span class="lab good">Every mile assigned</span>
									{:else}
										<span class="lab warn">Some miles assigned to nobody</span>
									{/if}
								</span>
							{/if}
						</span>
						<span class="fig">
							{#if t.value !== null}<span class="v">{money(t.value)}</span>{/if}
							<span class="sub">{miles(t.miles)}</span>
						</span>
					</a>
				{/each}
			</section>
		{/if}
	{/each}

	{#if data.offline}
		<p class="note">
			{data.user?.access === 'field'
				? 'Older trips, billed ones, and what any of them bill, need a connection.'
				: 'Older trips, billed ones, everyone else’s, and what any of them bill, need a connection.'}
		</p>
	{:else if data.unbilled.length === 0 && data.billed.length === 0}
		<section class="box" aria-labelledby="none-h">
			<div class="blank">
				<h2 class="blank-h" id="none-h">No trips this month</h2>
				<p class="blank-d">
					A trip is each drive for work: where it went, and whom each leg was for.
				</p>
				<a class="btn pri" href={resolve('/trips/new')}>New trip</a>
			</div>
		</section>
	{/if}
</div>

<style>
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.held {
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
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
	.sub.bad {
		color: var(--fgColor-danger);
	}
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
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
</style>
