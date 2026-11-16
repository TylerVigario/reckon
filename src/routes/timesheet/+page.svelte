<script lang="ts">
	import { onMount } from 'svelte';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import {
		held,
		flush,
		enqueue,
		discard,
		discardTimeChange,
		secondsOf,
		type Queued,
		type QueuedTimeChange
	} from '#lib/queue.ts';
	import { addAgain, asChanged, changesByEntry, markOf } from '#lib/entry-changes.ts';
	import { running, drop, moveStart, toEntry, type Running } from '#lib/timers.ts';
	import { clockOf, lastAt } from '#lib/work-times.ts';
	import { refreshAll } from '$app/navigation';
	import { unitPrice } from '#lib/money.svelte.ts';
	import {
		clock as clockAt,
		datedAt,
		day,
		elapsed,
		increment,
		secondsAsHours,
		workedTimes,
		names
	} from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { rateFor } from '#lib/rates.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hhmm = (seconds: number) => elapsed(seconds, false);

	// Everything here that is happening NOW is the browser's: the timer, and
	// whatever is waiting to be posted. Both are read on mount rather than
	// loaded, because neither is the server's to know yet.
	let timers = $state<Running[]>([]);
	let queued = $state(0);
	let notSaved = $state<Queued[]>([]);
	/** Changes made on this phone to entries the server has, by entry. */
	let changes = $state(new Map<string, QueuedTimeChange>());
	let now = $state(Date.now());
	let why = $state('');

	const readQueue = () =>
		Promise.all([held(), changesByEntry()]).then(
			([s, c]) => {
				queued = s.waiting + [...c.values()].filter((q) => !q.refused).length;
				notSaved = s.refused;
				changes = c;
			},
			() => {}
		);

	onMount(() => {
		const read = () => {
			timers = running();
			void readQueue();
			now = Date.now();
		};
		read();
		const t = setInterval(read, 1000);
		const back = () => void flush().then(read, read);
		addEventListener('online', back);
		return () => {
			clearInterval(t);
			removeEventListener('online', back);
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

	// A timer set going late -- somebody arrived, dealt with the first thing,
	// and only then remembered it -- has its start moved back to when the work
	// began: the last time the clock read what is chosen, today or else
	// yesterday. On the phone, like the timer, so it works with no signal.
	let moving = $state<string | null>(null);
	let movingTo = $state('');
	let moveWhy = $state('');
	function beginMove(t: Running) {
		moving = t.id;
		movingTo = clockOf(
			Temporal.Instant.fromEpochMilliseconds(t.started_at).toZonedDateTimeISO(personalZone())
		);
		moveWhy = '';
	}
	function setStart(t: Running) {
		if (!movingTo) {
			moveWhy = 'When it started.';
			return;
		}
		const to = lastAt(movingTo, personalZone(), Temporal.Now.instant());
		const moved = moveStart(t.id, to.epochMilliseconds);
		if (!moved) {
			moveWhy = 'It has to have started before now.';
			return;
		}
		timers = moved;
		moving = null;
	}

	// Letting go of a refused entry is hours gone for good, so it takes a
	// second tap, and the first one says so.
	let confirming = $state<string | null>(null);
	async function letGo(id: string, change = false) {
		if (confirming !== id) {
			confirming = id;
			setTimeout(() => {
				if (confirming === id) confirming = null;
			}, 4000);
			return;
		}
		confirming = null;
		await (change ? discardTimeChange(id) : discard(id)).catch(() => {});
		await readQueue();
	}

	// CHANGES TO ENTRIES THAT RAN INTO SOMETHING wait here too, whatever day they
	// were worked: a part someone else changed as well, an entry changed after it
	// was removed here, or a refusal, each decided on the entry's screen. One
	// removed meanwhile has no screen to open, so it is decided here: added
	// again with the change, or the change let go.
	const stuck = $derived([...changes.values()].filter((q) => q.refused));
	async function again(q: QueuedTimeChange) {
		try {
			await addAgain(q, $state.snapshot(q.change.fields), data.me);
		} catch {
			why = 'This phone would not save that, so nothing was added.';
			return;
		}
		await readQueue();
		await refreshAll();
	}
	/** "9:50 AM", or "Oct 2, 9:50 AM" on another day. */
	const when = (iso: string) =>
		(Date.parse(iso) > Date.now() - 86_400_000 ? '' : `${datedAt(iso, personalZone())}, `) +
		clockAt(iso, personalZone());

	const nameOf = (list: { id: string; name: string }[], id: string | null) =>
		list.find((x) => x.id === id)?.name ?? null;

	const siteOf = (entityId: string | null, siteId: string | null) => {
		const e = data.entities.find((x) => x.id === entityId);
		return e?.sites.find((s) => s.id === siteId)?.label ?? null;
	};

	const svc = $derived(live ? data.services.find((s) => s.id === live.service_id) : undefined);
	// A team timer names its crew; one set going before timers did is everyone
	// holding a role, as a team was then.
	const crewOf = (t: { crew_ids?: string[] }) =>
		t.crew_ids ? data.people.filter((p) => t.crew_ids!.includes(p.id)) : data.people;
	const headsOf = (t: { crew: string; crew_ids?: string[] }) =>
		t.crew === 'team' ? crewOf(t).length : 1;
	const crewNamed = (t: { crew_ids?: string[] }) => names(crewOf(t).map((p) => p.name));
	// This client's price for this crew, not the every-client one-person figure:
	// the same choice the start form made when the timer was set going.
	const liveRate = $derived(
		live ? rateFor(data.prices, live.service_id, live.entity_id, headsOf(live)) : null
	);

	const clock = (t: Running) => {
		const s = Math.max(0, Math.floor((now - t.started_at) / 1000));
		return { hm: elapsed(s, false), ss: String(s % 60).padStart(2, '0') };
	};

	const startedAt = (t: Running) => clockAt(t.started_at, personalZone());

	// Someone with Field sees only what they worked (#lib/access), and is told
	// so; so does anyone opening the copy kept for no signal (#lib/offline-copy).
	const field = $derived(data.user?.access === 'field');
	const sub = $derived(
		[
			field || data.offline ? 'Your work' : null,
			notSaved.length ? `${notSaved.length} not saved` : null,
			queued ? `${queued} queued` : null,
			`${secondsAsHours(data.monthSeconds, 'whole')} this month`
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

<OfflineBanner asOf={data.as_of} waiting={queued} />

<div class="pad primer">
	{#if why}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{why}</p></div>
		</div>
	{/if}

	{#if notSaved.length || stuck.length}
		<section class="box" aria-labelledby="ns-h">
			<div class="box-h">
				<h2 class="box-t" id="ns-h">Not saved</h2>
				<span class="count">{notSaved.length + stuck.length}</span>
			</div>
			{#each stuck as q (q.change.entry_id)}
				{@const s = q.change.shown}
				{@const c = q.refused?.conflict}
				<div class="box-row held">
					<span class="what">
						<span class="n">{s.site ?? s.entity ?? 'No client'} · {s.service}</span>
						<span class="sub">
							{[
								s.crew === 'team' ? names(s.crew_names) : (s.worked_by ?? 'Unassigned'),
								day(s.worked_on),
								hhmm(s.seconds),
								s.note
							]
								.filter(Boolean)
								.join(' · ')}
						</span>
						<span class="sub bad">
							{#if c?.what === 'removed'}
								{c.by ?? 'Someone'} removed this entry at {when(c.at)}, while your change waited on
								this phone.
							{:else if c}
								{markOf(q).text}: your change waits on this phone until you decide.
							{:else}
								Refused: {q.refused?.detail} Your change is kept on this phone until it is fixed or let
								go.
							{/if}
						</span>
					</span>
					<div class="acts">
						{#if c?.what === 'removed'}
							<button class="btn sm pri" onclick={() => again(q)}
								>Add it again, with your change</button
							>
							<button class="btn sm" onclick={() => letGo(q.change.entry_id, true)}>
								{confirming === q.change.entry_id ? 'Tap again to let it go' : 'Let the change go'}
							</button>
						{:else}
							<a class="btn sm pri" href={resolve('/timesheet/[id]', { id: q.change.entry_id })}
								>{c ? 'Decide' : 'Fix'}</a
							>
						{/if}
					</div>
				</div>
			{/each}
			{#each notSaved as q (q.entry.client_uuid)}
				{@const e = q.entry}
				<div class="box-row held">
					<span class="what">
						<span class="n">
							{siteOf(e.entity_id ?? null, e.site_id ?? null) ??
								nameOf(data.entities, e.entity_id ?? null) ??
								'No client'} · {nameOf(data.services, e.service_id) ?? 'a service that is gone'}
						</span>
						<span class="sub">
							{e.crew === 'team'
								? crewNamed(e)
								: (nameOf(data.people, e.worked_by) ?? 'Unassigned')}
							· {day(e.worked_on)} · {hhmm(secondsOf(e))}
						</span>
						<span class="sub bad">
							Refused: {q.refused?.detail} It is kept on this phone until it is fixed or let go.
						</span>
					</span>
					<div class="acts">
						<a
							class="btn sm pri"
							href={resolve(`/timesheet/manual?fix=${encodeURIComponent(e.client_uuid)}`)}>Fix</a
						>
						<button class="btn sm danger" onclick={() => letGo(e.client_uuid)}>
							{confirming === e.client_uuid ? 'Tap again to discard' : 'Discard'}
						</button>
					</div>
				</div>
			{/each}
		</section>
	{/if}

	<!-- When a running timer started, which a tap corrects: set going late,
	     its start is moved back to when the work began. -->
	{#snippet since(t: Running)}
		<button
			type="button"
			class="since"
			aria-label="Started {startedAt(t)}: change when it started"
			onclick={() => beginMove(t)}>{startedAt(t)}</button
		>
	{/snippet}
	{#snippet move(t: Running)}
		{#if moving === t.id}
			<span class="move">
				<label class="fc-l" for={`move-${t.id}`}>It started at</label>
				<span class="move-row">
					<input
						id={`move-${t.id}`}
						class="ti"
						type="time"
						bind:value={movingTo}
						aria-invalid={moveWhy ? 'true' : undefined}
						aria-describedby={moveWhy ? `move-${t.id}-e` : undefined}
					/>
					<button class="btn pri" onclick={() => setStart(t)}>Set</button>
					<button class="btn" onclick={() => (moving = null)}>Cancel</button>
				</span>
				{#if moveWhy}<span class="fc-e" id={`move-${t.id}-e`}
						><Octicon name="alert" />{moveWhy}</span
					>{/if}
			</span>
		{/if}
	{/snippet}

	{#if live}
		{@const c = clock(live)}
		<section class="box" aria-labelledby="run-h">
			<div class="box-h">
				<h2 class="box-t" id="run-h">Running</h2>
				<span class="lab {live.billable ? 'acc' : ''}"
					>{live.billable ? 'Billable' : 'Not billable'}</span
				>
			</div>
			<div class="box-row clock">
				<span class="big" role="timer">{c.hm}<small>:{c.ss}</small></span>
				<span class="sub"
					>Started {@render since(live)} · billed {svc?.bill_to_nearest_seconds
						? increment(svc.bill_to_nearest_seconds)
						: 'to the second'}</span
				>
				{@render move(live)}
			</div>
			<div class="box-row">
				<span class="what">
					<span class="n">
						{siteOf(live.entity_id, live.site_id) ??
							nameOf(data.entities, live.entity_id) ??
							'Nobody pays'}
					</span>
					<span class="sub">
						{svc?.name ?? 'A service that is gone'} · {liveRate
							? `${unitPrice(liveRate)} an hour, for ${live.crew === 'team' ? `a crew of ${headsOf(live)}` : 'one person'}`
							: 'not priced'}
					</span>
					<span class="sub">
						{live.crew === 'team'
							? crewNamed(live)
							: (nameOf(data.people, live.worked_by) ?? 'Unassigned')}
					</span>
				</span>
			</div>
			<div class="box-row keep">
				<button class="btn pri" disabled={stopping} onclick={() => stop(live)}>Stop</button>
				<a class="btn" href={resolve('/timesheet/start')}>Start another</a>
			</div>
		</section>
	{:else}
		<section class="box" aria-labelledby="run-h">
			<div class="blank">
				<h2 class="blank-h" id="run-h">Nothing running</h2>
				<p class="blank-d">
					A timer runs on this phone, signal or not, and is put down as an entry when it stops.
				</p>
				<a class="btn pri" href={resolve('/timesheet/start')}>Start a timer</a>
			</div>
		</section>
	{/if}

	<section class="box" aria-labelledby="today-h">
		<div class="box-h">
			<h2 class="box-t" id="today-h">Today</h2>
			<a class="lk" href={resolve('/timesheet/all')}>{field ? 'All yours' : 'All entries'}</a>
		</div>
		<!-- The first timer is the one above; any others run here. -->
		{#each timers.slice(1) as t (t.id)}
			{@const c = clock(t)}
			<div class="box-row line">
				<span class="what">
					<span class="n">
						{siteOf(t.entity_id, t.site_id) ?? nameOf(data.entities, t.entity_id) ?? 'Nobody pays'}
					</span>
					<span class="sub">
						{t.crew === 'team' ? crewNamed(t) : (nameOf(data.people, t.worked_by) ?? 'Unassigned')}
						· since {@render since(t)}
					</span>
					{@render move(t)}
				</span>
				<span class="fig">
					<span class="v">{c.hm}</span>
					<span class="sub">running</span>
				</span>
				<button class="btn sm" disabled={stopping} onclick={() => stop(t)}>Stop</button>
			</div>
		{/each}

		{#each data.entries as row (row.id)}
			{@const q = changes.get(row.id)}
			{@const e = asChanged(row, q)}
			{@const mark = q ? markOf(q) : null}
			<a
				class="box-row line"
				class:gone={!e.billable || q?.change.act === 'remove'}
				href={resolve('/timesheet/[id]', { id: e.id })}
			>
				<span class="what">
					<span class="n">{e.site ?? e.entity ?? e.note ?? 'No client'}</span>
					<span class="sub">
						{e.crew === 'team' ? names(e.crew_names) : (e.worked_by ?? 'Unassigned')} ·
						{e.started_at && e.ended_at && e.zone
							? workedTimes(e.started_at, e.ended_at, e.zone, personalZone())
							: clockAt(e.at, personalZone())} · {e.service}
					</span>
					{#if mark || !e.billable}
						<span class="labs">
							{#if !e.billable}<span class="lab">Not billable</span>{/if}
							{#if mark}<span class="lab {mark.tone}">{mark.text}</span>{/if}
						</span>
					{/if}
				</span>
				<span class="fig">
					<span class="v">{hhmm(e.seconds)}</span>
					<span class="sub">{e.invoiced ? 'billed' : 'unbilled'}</span>
				</span>
			</a>
		{/each}

		{#if timers.length < 2 && data.entries.length === 0}
			<div class="box-row">
				<p class="sub none">Nothing put down today.</p>
			</div>
		{/if}
	</section>
	{#if data.offline && !field}
		<p class="note">Everyone else’s work today needs a connection.</p>
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
		display: flex;
		flex-direction: column;
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
	.none {
		margin: 0;
		font-size: inherit;
	}
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
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
	.gone .n,
	.gone .v {
		color: var(--fgColor-muted);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	/* The running clock: the one figure on this screen read at a glance. */
	.clock {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.big {
		font-family: var(--fontStack-monospace);
		font-size: 40px;
		font-weight: 600;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.big small {
		font-size: 20px;
		color: var(--fgColor-muted);
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		background: var(--bgColor-muted);
	}
	/* When a running timer started, which a tap corrects. */
	.since {
		font: inherit;
		color: var(--fgColor-accent);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
	}
	.since:hover {
		text-decoration: underline;
	}
	.move {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}
	.move-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.move-row .ti {
		flex: 1 1 8rem;
		width: auto;
	}
</style>
