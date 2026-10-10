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
	const fix = (key: string) => `${resolve('/trips/new')}?fix=${encodeURIComponent(key)}`;
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

	const sub = $derived(
		[
			data.totals?.month,
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

<div class="pad">
	{#if onPhone.length}
		<div class="sec">
			<div class="sec-h"><h2>On this phone</h2></div>
			<div class="rows">
				{#each onPhone as q (q.trip.key)}
					<div class="rec" class:warn={q.refused}>
						<div class="rec-m">
							<div class="rec-t">{q.trip.shown.label || 'A trip'}</div>
							<div class="rec-s">{shown(q)}</div>
							{#if q.refused}
								<div class="rec-s">
									Not sent: {Object.values(q.refused.errors ?? {})[0] ?? q.refused.detail}
								</div>
								<div class="rec-c btnrow">
									<a class="btn sm" href={fix(q.trip.key)}>Fix</a>
									<button type="button" class="btn sm gho" onclick={() => letGo(q.trip.key)}
										>{confirming === q.trip.key ? 'Tap again to discard' : 'Discard'}</button
									>
								</div>
							{:else}
								<div class="rec-c">
									<span class="chip acc"><span class="dot"></span>On this phone</span>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
	{#each [{ key: 'unbilled', head: 'Unbilled', rows: data.unbilled }, { key: 'billed', head: 'Billed', rows: data.billed }] as group (group.key)}
		{#if group.rows.length}
			<div class="sec">
				<div class="sec-h">
					<h2>{group.head}</h2>
					{#if group.key === 'unbilled' && data.totals?.rate}
						<span class="sp"></span>
						<span class="chip">Rate {unitPrice(data.totals.rate)}/mi</span>
					{/if}
				</div>
				<div class="rows">
					{#each group.rows as t (t.id)}
						<a class="rec link" href={resolve('/trips/[id]', { id: t.id })}>
							<div class="rec-m">
								<div class="rec-t">{title(t)}</div>
								<div class="rec-s">
									{detail(t)}
									{#if t.legs > 1}<br />One drive, {t.legs} legs{/if}
								</div>
								{#if t.legs > 1}
									<div class="rec-c">
										{#if t.balanced}
											<span class="chip good"><span class="dot"></span>Every mile assigned</span>
										{:else}
											<span class="chip warn"
												><span class="dot"></span>Some miles assigned to nobody</span
											>
										{/if}
									</div>
								{/if}
							</div>
							<div class="rec-n">
								<span class="rec-v">{money(t.value)}</span>
								<span class="rec-x">{miles(t.miles)}</span>
							</div>
							<span class="arw" aria-hidden="true">›</span>
						</a>
					{/each}
				</div>
			</div>
		{/if}
	{/each}

	{#if data.unbilled.length === 0 && data.billed.length === 0}
		<p class="none">No trips this month.</p>
	{/if}
</div>
