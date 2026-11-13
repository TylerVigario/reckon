<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import EntryForm from '#lib/EntryForm.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import type { EntryFields, EntrySeed } from '#lib/entry-form.ts';
	import { withPart, type EntryPart } from '#lib/entry-merge.ts';
	import { addAgain } from '#lib/entry-changes.ts';
	import { clock, datedAt, day, names, secondsAsHours, todayIn, workedTimes } from '#lib/format.ts';
	import {
		discardTimeChange,
		enqueueTimeChange,
		findTimeChange,
		flush,
		notKept,
		secondsOf,
		waitingCount,
		type QueuedTimeChange,
		type ShownEntry,
		type TimeChange
	} from '#lib/queue.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * One time entry, changed after the fact (+page.server.ts): the Add past work
	 * form, filled in from it. A change, or removing it, is written on this phone
	 * first and sent when there is a connection (#lib/queue), saying which save
	 * it began from, so one made meanwhile is merged with it rather than written
	 * over (#lib/entry-merge). What it runs into -- a part someone else changed
	 * too, the entry removed meanwhile, or changed after it was removed here --
	 * is kept with it until a person decides, here.
	 *
	 * One on an invoice or in a payment says where, instead; one someone else
	 * entered says who changes it.
	 */
	let { data }: PageProps = $props();
	const field = untrack(() => data.user?.access === 'field');
	const e = $derived(data.entry);
	const time = resolve('/timesheet');

	/** "Nov 4 · 9:00 – 11:20 AM", or the day and how long, for one recorded as a length. */
	const whenOf = (
		s: Pick<ShownEntry, 'worked_on' | 'started_at' | 'ended_at' | 'zone' | 'seconds'>
	) =>
		s.started_at && s.ended_at && s.zone
			? `${day(s.worked_on)} · ${workedTimes(s.started_at, s.ended_at, s.zone, personalZone())}`
			: `${day(s.worked_on)} · ${secondsAsHours(s.seconds, 'glance')}`;
	const when = $derived(
		e.started_at && e.ended_at && e.zone
			? `${day(e.worked_on)} · ${workedTimes(e.started_at, e.ended_at, e.zone, personalZone())}`
			: day(e.worked_on)
	);

	/** An entry as Time and All entries show it while its change waits: names, not ids. */
	function shownOf(f: EntryFields): ShownEntry {
		const person = (id: string | null | undefined) =>
			data.people.find((p) => p.id === id)?.name ?? null;
		const client = data.entities.find((x) => x.id === f.entity_id);
		return {
			worked_on: f.worked_on,
			seconds: secondsOf(f),
			started_at: f.started_at ?? null,
			ended_at: f.ended_at ?? null,
			zone: f.zone ?? null,
			crew: f.crew,
			worked_by: f.crew === 'team' ? null : person(f.worked_by),
			crew_names:
				f.crew === 'team'
					? (f.crew_ids ?? [])
							.map(person)
							.filter((n): n is string => n !== null)
							.sort()
					: [],
			entity: client?.name ?? null,
			site: client?.sites.find((s) => s.id === f.site_id)?.label ?? null,
			service: data.services.find((s) => s.id === f.service_id)?.name ?? e.service,
			billable: f.billable ?? true,
			note: f.note ?? null
		};
	}

	// WHAT THIS PHONE HAS FOR THE ENTRY: a change waiting to send, or one that
	// ran into something. The server cannot know it yet, so it is read from the
	// queue, and the form opens on it rather than on the server's copy.
	let mine = $state<QueuedTimeChange | null>(null);
	let waiting = $state(0);
	let ready = $state(false);
	async function read() {
		try {
			mine = (await findTimeChange(e.id)) ?? null;
			waiting = await waitingCount();
		} catch {
			mine = null;
		}
		ready = true;
	}
	onMount(() => void read());
	const conflict = $derived(mine?.refused?.conflict ?? null);
	const collided = $derived(conflict?.what === 'collided' ? conflict : null);

	const seedOf = (f: EntryFields): EntrySeed => ({
		...f,
		seconds: secondsOf(f),
		entity_id: f.entity_id ?? null,
		site_id: f.site_id ?? null,
		billable: f.billable ?? true,
		note: f.note ?? null
	});

	/** Written on the phone; a copy, since a $state proxy is not something IndexedDB stores. */
	async function keep(c: TimeChange, fresh = false) {
		await enqueueTimeChange($state.snapshot(c), fresh);
	}

	/**
	 * Sends what waits, for as long as a connection takes to answer. Gone, or
	 * waiting for one, it is back to Time; run into something, it stays here,
	 * to be decided.
	 */
	async function send() {
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		await read();
		if (!mine?.refused) await goto(time, { invalidateAll: true });
	}

	async function save(fields: EntryFields) {
		try {
			await keep({
				entry_id: e.id,
				act: 'change',
				version: e.version,
				base: data.base,
				fields,
				made_at: new Date().toISOString(),
				shown: shownOf(fields)
			});
		} catch (err) {
			return notKept(err, 'This phone would not save that, so nothing was changed.');
		}
		await send();
		return null;
	}

	let removing = $state(false);
	let working = $state(false);
	let why = $state('');
	async function remove() {
		working = true;
		const fields = mine?.change.fields ?? data.base;
		try {
			await keep({
				entry_id: e.id,
				act: 'remove',
				version: e.version,
				base: data.base,
				fields,
				made_at: new Date().toISOString(),
				shown: shownOf(fields)
			});
		} catch (err) {
			working = false;
			removing = false;
			why = notKept(err, 'This phone would not save that, so the entry is still there.');
			return;
		}
		await send();
		working = false;
		removing = false;
	}

	/** Lets go of what this phone has for the entry: only ever a person's decision. */
	async function letGo(leave = false) {
		await discardTimeChange(e.id).catch(() => {});
		if (leave) await goto(time, { invalidateAll: true });
		else await read();
	}

	/** Removed here and changed since: removed anyway. */
	async function removeAnyway() {
		if (!mine) return;
		await keep({ ...mine.change, force: true }, true);
		await send();
	}

	/** Removed meanwhile: added again, as a new entry, with the change. */
	async function again() {
		if (!mine) return;
		try {
			await addAgain(mine, $state.snapshot(mine.change.fields), data.me);
		} catch {
			why = 'This phone would not save that, so nothing was added.';
			return;
		}
		await goto(time, { invalidateAll: true });
	}

	// A collision is settled part by part: each picks where both started,
	// theirs, or the phone's own, and starts on the phone's.
	type Side = 'base' | 'theirs' | 'mine';
	let picks = $state<Partial<Record<EntryPart, Side>>>({});
	$effect(() => {
		if (collided) picks = Object.fromEntries(collided.collided.map((p) => [p, 'mine']));
	});
	const sideOf = (side: Side): EntryFields | null =>
		!mine || !collided
			? null
			: side === 'base'
				? mine.change.base
				: side === 'mine'
					? mine.change.fields
					: collided.server;
	let deciding = $state(false);
	async function keepPicks() {
		if (!collided || !mine) return;
		deciding = true;
		// The entry as the server has it, with what merged from this phone, and
		// the picks: made against the save the server is at.
		let fields = collided.server;
		for (const [p, side] of Object.entries(collided.from) as [EntryPart, string][])
			if (side === 'phone') fields = withPart(p, fields, mine.change.fields);
		for (const p of collided.collided)
			fields = withPart(p, fields, sideOf(picks[p] ?? 'mine') ?? fields);
		try {
			await keep(
				{
					...mine.change,
					version: collided.version,
					base: collided.server,
					fields,
					shown: shownOf(fields)
				},
				true
			);
		} catch (err) {
			why = notKept(err, 'This phone would not save that, so nothing is decided yet.');
			deciding = false;
			return;
		}
		await send();
		deciding = false;
	}

	const PART: Record<EntryPart, string> = {
		when: 'When',
		who: 'Who worked it',
		where: 'Who pays, and where',
		service: 'What was done',
		billable: 'Billable',
		note: 'Note'
	};
	/** One part of an entry, as this screen says it. */
	function said(part: EntryPart, f: EntryFields): string {
		const s = shownOf(f);
		switch (part) {
			case 'when':
				return whenOf(s);
			case 'who':
				return s.crew === 'team' ? `Team: ${names(s.crew_names)}` : (s.worked_by ?? 'Nobody');
			case 'where':
				return [s.entity ?? 'No client', s.site].filter(Boolean).join(' · ');
			case 'service':
				return s.service;
			case 'billable':
				return s.billable ? 'Billable' : 'Not billable';
			case 'note':
				return s.note ? `“${s.note}”` : 'No note';
		}
	}
	/** "9:50 AM", or "Oct 2, 2026, 9:50 AM" on another day. */
	const at = (iso: string) => {
		const zone = personalZone();
		const ms = Date.parse(iso);
		return todayIn(zone, ms) === todayIn(zone)
			? clock(ms, zone)
			: `${datedAt(ms, zone)}, ${clock(ms, zone)}`;
	};
	const choices = $derived(
		collided
			? ([
					['base', 'Where both started'],
					[
						'theirs',
						`${collided.by ?? 'Someone else'}${collided.at ? ` · ${at(collided.at)}` : ''}`
					],
					['mine', 'You · on this phone']
				] as [Side, string][])
			: []
	);

	const changeable = $derived(data.mayChange && !data.used && !data.paidTo);
</script>

<Top
	title={changeable ? 'Change an entry' : 'An entry'}
	sub="{when} · {e.service}"
	back={time}
	backLabel="Time"
/>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if why}<p class="why bad" role="alert">{why}</p>{/if}

	{#if data.used}
		<p class="why">
			This hour is on {data.used.draft ? 'draft' : 'invoice'}
			<a href={resolve('/invoices/[id]', { id: data.used.invoice })}
				>{data.used.number ?? 'a draft'}</a
			>, so it stays as it was billed.
			{data.used.draft
				? 'Take it off the draft to change it.'
				: 'Credit the invoice to correct it.'}
		</p>
	{:else if data.paidTo}
		<p class="why">
			This hour is in a payment to {data.paidTo}, so it stays as it was paid. A correction goes on
			their next payment.
		</p>
	{:else if !data.mayChange}
		<p class="why">
			Entered by {e.entered_by}. Whoever entered it, or someone with Full, changes it.
		</p>
	{:else if !ready}
		<p class="lt">Reading this phone…</p>
	{:else if collided && mine}
		<p class="why">
			{collided.by ?? 'Someone'} changed this entry{collided.at ? ` at ${at(collided.at)}` : ''} while
			your change waited on this phone. {Object.keys(collided.from).length
				? `${Object.keys(collided.from).length === 1 ? 'One part' : `${Object.keys(collided.from).length} parts`} merged on ${Object.keys(collided.from).length === 1 ? 'its' : 'their'} own; `
				: ''}{collided.collided.length === 1
				? 'one needs a choice'
				: `${collided.collided.length} need a choice`}. Until it is made, your change waits on this
			phone.
		</p>
		{#each Object.entries(collided.from) as [p, side] (p)}
			{@const part = p as EntryPart}
			<div class="sec">
				<div class="sec-h">
					<h2>{PART[part]}</h2>
					<span class="sp"></span>
					<span class="chip good"><span class="dot"></span>Merged</span>
				</div>
				<div class="rows">
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">
								{said(part, side === 'phone' ? mine.change.fields : collided.server)}
							</div>
							<div class="rec-s">
								{side === 'phone'
									? 'Only you changed it, on this phone'
									: `Only ${collided.by ?? 'they'} changed it`}
							</div>
						</div>
					</div>
				</div>
			</div>
		{/each}
		{#each collided.collided as part (part)}
			<div class="sec">
				<div class="sec-h">
					<h2>{PART[part]} — pick one</h2>
					<span class="sp"></span>
					<span class="chip warn"><span class="dot"></span>Both changed</span>
				</div>
				<div class="rows" role="radiogroup" aria-label={PART[part]}>
					{#each choices as [side, who] (side)}
						<button
							type="button"
							class="rec pick"
							class:on={picks[part] === side}
							role="radio"
							aria-checked={picks[part] === side}
							onclick={() => (picks = { ...picks, [part]: side })}
						>
							<span class="radio" aria-hidden="true"></span>
							<span class="rec-m">
								<span class="rec-t">{said(part, sideOf(side)!)}</span>
								<span class="rec-s">{who}</span>
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}
		<div class="btnrow">
			<button class="btn pri blk" disabled={deciding} onclick={keepPicks}>Keep these</button>
			<a class="btn blk" href={time}>Later</a>
		</div>
	{:else if conflict?.what === 'removed' && mine}
		<p class="why">
			{conflict.by ?? 'Someone'} removed this entry at {at(conflict.at)}, while your change waited
			on this phone.
		</p>
		<div class="btnrow">
			<button class="btn pri blk" onclick={again}>Add it again, with your change</button>
			<button class="btn blk" onclick={() => letGo(true)}>Let the change go</button>
		</div>
	{:else if conflict?.what === 'changed' && mine}
		<p class="why">
			{conflict.by ?? 'Someone'} changed this entry{conflict.at ? ` at ${at(conflict.at)}` : ''},
			after it was removed on this phone.
		</p>
		<div class="btnrow">
			<button class="btn pri blk" onclick={removeAnyway}>Remove it anyway</button>
			<button class="btn blk" onclick={() => letGo()}>Keep it</button>
		</div>
	{:else if mine?.change.act === 'remove' && !mine.refused}
		<p class="why">Removed on this phone: it goes when it reaches the server.</p>
		<div class="btnrow">
			<button class="btn blk" onclick={() => letGo()}>Keep it after all</button>
		</div>
	{:else}
		{#key mine?.queued_at ?? 0}
			<EntryForm
				choices={data}
				{field}
				seed={seedOf(mine?.change.fields ?? data.base)}
				saveLabel="Save changes"
				onsave={save}
			>
				{#snippet above()}
					{#if mine?.refused}
						<p class="why bad">
							Refused: {mine.refused.detail} Your change is kept on this phone until it is fixed or let
							go.
						</p>
					{:else if mine}
						<p class="lt waits">A change made on this phone waits to send.</p>
					{/if}
				{/snippet}
				{#snippet below()}
					{#if mine}
						<button class="btn gho blk" type="button" onclick={() => letGo()}
							>Let the change go</button
						>
					{/if}
					<button class="btn gho blk" type="button" onclick={() => (removing = true)}
						>Remove this entry</button
					>
				{/snippet}
			</EntryForm>
		{/key}
	{/if}
</div>

<Dialog
	open={removing}
	title="Remove this entry?"
	go="Remove"
	going="Removing…"
	tone="danger"
	{working}
	ongo={remove}
	onclose={() => (removing = false)}
>
	<p>
		{when} · {e.service}. It goes when it reaches the server, and the record of it is kept in its
		history.
	</p>
</Dialog>

<style>
	.why {
		margin: 0 0 14px;
	}
	.why.bad {
		border-left-color: var(--crit);
		color: var(--crit);
	}
	.waits {
		margin: 0;
	}
	.btnrow {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 16px 0;
	}
	.btnrow > * {
		box-sizing: border-box;
		width: 100%;
		text-align: center;
	}
	button.rec.pick {
		width: 100%;
		text-align: left;
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		cursor: pointer;
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.pick .rec-m,
	.pick .rec-t,
	.pick .rec-s {
		display: block;
	}
	.pick .radio {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid var(--line);
		flex: none;
	}
	.pick.on .radio {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 4px var(--card);
		background: var(--accent);
	}
	.pick.on {
		background: var(--accent-wash);
	}
</style>
