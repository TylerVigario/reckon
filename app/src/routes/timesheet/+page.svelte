<script lang="ts">
	import { onMount } from 'svelte';
	import Top from '#lib/Top.svelte';
	import { held, flush, enqueue, discard, type Queued } from '#lib/queue.ts';
	import { running, drop, toEntry, type Running } from '#lib/timers.ts';
	import { refreshAll } from '$app/navigation';
	import { money } from '#lib/money.svelte.ts';
	import { clock as clockAt, day, elapsed, increment, minutesAsHours } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { rateFor } from '#lib/rates.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hhmm = (m: number) => elapsed(m * 60, false);

	// Everything here that is happening NOW is the browser's: the timer, and
	// whatever is waiting to be posted. Both are read on mount rather than
	// loaded, because neither is the server's to know yet.
	let timers = $state<Running[]>([]);
	let queued = $state(0);
	let notSaved = $state<Queued[]>([]);
	let online = $state(true);
	let now = $state(Date.now());
	let why = $state('');

	const readQueue = () =>
		held().then(
			(s) => {
				queued = s.waiting;
				notSaved = s.refused;
			},
			() => {}
		);

	onMount(() => {
		const read = () => {
			timers = running();
			void readQueue();
			online = navigator.onLine;
			now = Date.now();
		};
		read();
		const t = setInterval(read, 1000);
		const back = () => void flush().then(read, read);
		addEventListener('online', back);
		addEventListener('offline', read);
		return () => {
			clearInterval(t);
			removeEventListener('online', back);
			removeEventListener('offline', read);
		};
	});

	const live = $derived(timers[0]);

	// Written to the queue before the timer is dropped, and only once the write
	// has committed, so there is no moment at which the time is in neither
	// place. If the phone will not store it, the timer keeps running. The
	// buttons rest for a moment after a stop, so a double tap does not land on
	// whichever timer moved up into its place; the post itself goes on in the
	// background and never holds them.
	let stopping = $state(false);
	async function stop(t: Running) {
		if (stopping) return;
		stopping = true;
		why = '';
		try {
			await enqueue(toEntry(t, data.me, personalZone()));
		} catch {
			why = 'This phone would not save the entry, so the timer is still running.';
			stopping = false;
			return;
		}
		timers = drop(t.id);
		await readQueue();
		setTimeout(() => (stopping = false), 800);
		void flush()
			.catch(() => {})
			.then(async () => {
				await readQueue();
				return refreshAll();
			});
	}

	// Letting go of a refused entry is hours gone for good, so it takes a
	// second tap, and the first one says so.
	let confirming = $state<string | null>(null);
	async function letGo(id: string) {
		if (confirming !== id) {
			confirming = id;
			setTimeout(() => {
				if (confirming === id) confirming = null;
			}, 4000);
			return;
		}
		confirming = null;
		await discard(id).catch(() => {});
		await readQueue();
	}

	const nameOf = (list: { id: string; name: string }[], id: string | null) =>
		list.find((x) => x.id === id)?.name ?? null;

	const siteOf = (entityId: string | null, siteId: string | null) => {
		const e = data.entities.find((x) => x.id === entityId);
		return e?.sites.find((s) => s.id === siteId)?.label ?? null;
	};

	const svc = $derived(live ? data.services.find((s) => s.id === live.service_id) : undefined);
	// This client's price for this crew, not the every-client one-person figure:
	// the same choice the start form made when the timer was set going.
	const liveRate = $derived(
		live ? rateFor(data.prices, live.service_id, live.entity_id, live.crew) : null
	);

	const clock = (t: Running) => {
		const s = Math.max(0, Math.floor((now - t.started_at) / 1000));
		return { hm: elapsed(s, false), ss: String(s % 60).padStart(2, '0') };
	};

	const startedAt = (t: Running) => clockAt(t.started_at, personalZone());

	const sub = $derived(
		[
			notSaved.length ? `${notSaved.length} not saved` : null,
			queued ? `${queued} queued` : null,
			`${minutesAsHours(data.monthMinutes, 'whole')} this month`
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<Top title="Time" {sub}>
	{#snippet actions()}
		<a class="btn sm" href={resolve('/timesheet/manual')}>Add past work</a>
	{/snippet}
</Top>

{#if queued > 0 || !online}
	<div class="offline">
		<span aria-hidden="true">●</span>
		{#if !online}Offline — {queued} {queued === 1 ? 'entry' : 'entries'} queued
		{:else}{queued} {queued === 1 ? 'entry' : 'entries'} waiting to send{/if}
	</div>
{/if}

<div class="pad">
	{#if why}<p class="why bad">{why}</p>{/if}

	{#if notSaved.length}
		<div class="sec">
			<div class="sec-h"><h2>Not saved</h2></div>
			<div class="rows">
				{#each notSaved as q (q.entry.client_uuid)}
					{@const e = q.entry}
					<div class="rec crit">
						<div class="rec-m">
							<div class="rec-t">
								{siteOf(e.entity_id ?? null, e.site_id ?? null) ??
									nameOf(data.entities, e.entity_id ?? null) ??
									'No client'}
								<span class="lt">
									· {nameOf(data.services, e.service_id) ?? 'a service that is gone'}</span
								>
							</div>
							<div class="rec-s">
								{e.crew === 'team'
									? 'The team'
									: (nameOf(data.people, e.worked_by) ?? 'Unassigned')}
								· {day(e.worked_on)} · {hhmm(e.minutes)}
							</div>
							<div class="rec-s refusal">
								Refused: {q.refused?.detail} It is kept on this phone until it is fixed or let go.
							</div>
							<div class="acts">
								<a
									class="btn sm pri"
									href={`${resolve('/timesheet/manual')}?fix=${encodeURIComponent(e.client_uuid)}`}
									>Fix</a
								>
								<button class="btn sm gho" onclick={() => letGo(e.client_uuid)}>
									{confirming === e.client_uuid ? 'Tap again to discard' : 'Discard'}
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if live}
		{@const c = clock(live)}
		<div class="timer-card">
			<div>
				<div class="timer">{c.hm}<small>:{c.ss}</small></div>
				<div class="rec-s under">
					Started {startedAt(live)} · billing {increment(svc?.bill_to_nearest_seconds)}
				</div>
			</div>
			<div class="chips">
				{#if svc}
					<span class="chip acc"><span class="dot"></span>{svc.name}</span>
				{/if}
				<span class="chip">{live.billable ? 'Billable' : 'Non-billable'}</span>
				<span class="chip">
					{live.crew === 'team'
						? 'The team'
						: (nameOf(data.people, live.worked_by) ?? 'Unassigned')}
				</span>
			</div>
			<div class="hr"></div>
			<div class="stack">
				<div class="kv">
					<span class="k">Entity</span>
					<span class="v">{nameOf(data.entities, live.entity_id) ?? '—'}</span>
				</div>
				<div class="kv">
					<span class="k">Location</span>
					<span class="v">{siteOf(live.entity_id, live.site_id) ?? '—'}</span>
				</div>
				<div class="kv">
					<span class="k">Service</span><span class="v">{svc?.name ?? '—'}</span>
				</div>
				<div class="kv">
					<span class="k">Rate</span>
					<span class="v">
						{#if liveRate}{money(liveRate)}/h · {live.crew === 'team' ? 'the team' : 'one person'}
						{:else}not priced{/if}
					</span>
				</div>
			</div>
			<div class="btnrow">
				<button class="btn pri blk" disabled={stopping} onclick={() => stop(live)}>Stop</button>
				<a class="btn" href={resolve('/timesheet/start')}>Start another</a>
			</div>
		</div>
	{:else}
		<div class="timer-card">
			<div>
				<div class="timer">0:00<small>:00</small></div>
				<div class="rec-s under">Nothing running</div>
			</div>
			<div class="btnrow">
				<a class="btn pri blk" href={resolve('/timesheet/start')}>Start a timer</a>
			</div>
		</div>
	{/if}

	<div class="sec">
		<div class="sec-h">
			<h2>Today</h2>
			<a class="seeall" href={resolve('/timesheet/all')}>All entries</a>
		</div>
		<div class="rows">
			{#each timers as t (t.id)}
				{@const c = clock(t)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">
							{siteOf(t.entity_id, t.site_id) ?? nameOf(data.entities, t.entity_id) ?? 'No client'}
							<span class="lt">· {t.crew === 'team' ? 'team' : 'running'}</span>
						</div>
						<div class="rec-s">
							{t.crew === 'team' ? 'The team' : (nameOf(data.people, t.worked_by) ?? 'Unassigned')}
							· running since {startedAt(t)}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{c.hm}</span><span class="rec-x">running</span>
					</div>
					<button class="btn sm" disabled={stopping} onclick={() => stop(t)}>Stop</button>
				</div>
			{/each}

			{#each data.entries as e (e.id)}
				<div class="rec" class:gone={!e.billable}>
					<div class="rec-m">
						<div class="rec-t">
							{e.site ?? e.entity ?? e.note ?? 'No client'}
							{#if !e.billable}<span class="lt">· non-billable</span>{/if}
						</div>
						<div class="rec-s">
							{e.crew === 'team' ? 'The team' : (e.worked_by ?? 'Unassigned')} · {clockAt(
								e.at,
								personalZone()
							)} · {e.service}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v" class:mut={!e.billable}>{hhmm(e.minutes)}</span>
						<span class="rec-x">{e.invoiced ? 'billed' : 'unbilled'}</span>
					</div>
				</div>
			{/each}

			{#if timers.length === 0 && data.entries.length === 0}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing captured today</span></div>
						<div class="rec-s">A timer, or an entry by hand for work already done</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	/* The line under the running timer, set off from the figure above it. */
	.under {
		margin-top: 5px;
	}
	.why.bad {
		color: var(--crit);
	}
	/* Why the server would not take it, in its words. */
	.refusal {
		margin-top: 6px;
		color: var(--crit);
	}
	.acts {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
</style>
