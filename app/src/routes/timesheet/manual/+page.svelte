<script lang="ts">
	import { pct, secondsAsHours, zoneName } from '#lib/format.ts';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import { enqueue, find, flush, secondsOf, type Entry, type Queued } from '#lib/queue.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { rateFor } from '#lib/rates.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { at, clockOf, endAfter, endingAt, lengthText, parseLength } from '#lib/work-times.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	type Site = { id: string; label: string; rate_pct: string | null };
	type Ent = { id: string; name: string; sites: Site[] };

	let entityId = $state<string | null>(null);
	let siteId = $state<string | null>(null);
	// Seeded once from the load; after that the box is the truth. It opens on a
	// priced service, never one nothing can be billed under.
	let serviceId = $state<string | null>(
		untrack(() => {
			const priced = (s: { id: string }) => data.prices.some((p) => p.service_id === s.id);
			// Hourly first: this form records time, and a per-mile service
			// opening by default asks for a duration of driving.
			return (
				(
					data.services.find((s) => s.unit === 'hour' && priced(s)) ??
					data.services.find(priced) ??
					data.services[0]
				)?.id ?? null
			);
		})
	);
	let crew = $state<'one' | 'team'>('one');
	let workedBy = $state<string | null>(untrack(() => data.me));
	// Who is on a team: everyone holding a role, unless some are unticked.
	let crewIds = $state<string[]>(untrack(() => data.people.map((p) => p.id)));
	const heads = $derived(crew === 'team' ? crewIds.length : 1);
	const toggle = (id: string) =>
		(crewIds = crewIds.includes(id) ? crewIds.filter((x) => x !== id) : [...crewIds, id]);
	// WHEN: a day, and a start, a length and an end, any two of which give the
	// third (#lib/work-times), worked out here as they are typed, offline. Not
	// every entry is today's -- an evening spent writing up Tuesday is the
	// ordinary case, so the day is asked for rather than assumed.
	let day = $state(untrack(() => data.today));
	let start = $state('');
	let length = $state('');
	let end = $state('');
	// The person's own zone, or the zone an entry being fixed was worked in.
	let zone = $state(untrack(() => personalZone()));
	// Whether any of the four has been touched since the form was filled in.
	let moved = $state(false);
	let billable = $state(true);
	let note = $state('');
	let saving = $state(false);
	let why = $state('');

	// FIXING an entry the server refused: the same form, filled in from the
	// copy the phone kept, saved back under the same client_uuid -- which
	// replaces the refused copy rather than adding a second entry. Whatever
	// the server named as gone is left empty to be chosen again.
	let fixing = $state<Queued | null>(null);
	onMount(async () => {
		const id = page.url.searchParams.get('fix');
		const q = id ? await find(id).catch(() => undefined) : undefined;
		if (!q?.refused) return;
		const e = q.entry;
		const known = (list: { id: string }[], v: string | null | undefined) =>
			v && list.some((x) => x.id === v) ? v : null;
		fixing = q;
		entityId = known(data.entities, e.entity_id);
		siteId = known(entity?.sites ?? [], e.site_id);
		serviceId = known(data.services, e.service_id);
		crew = e.crew;
		workedBy = e.crew === 'team' ? workedBy : known(data.people, e.worked_by);
		// Who it named, of those who can still be on a team.
		if (e.crew === 'team' && e.crew_ids)
			crewIds = data.people.filter((p) => e.crew_ids!.includes(p.id)).map((p) => p.id);
		day = e.worked_on;
		length = lengthText(secondsOf(e));
		// A timed entry is shown on the clock it was worked on. One recorded as a
		// length alone has no start to show, and may be saved as a length again.
		if (e.started_at && e.ended_at && e.zone) {
			zone = e.zone;
			start = clockOf(Temporal.Instant.from(e.started_at).toZonedDateTimeISO(zone));
			end = clockOf(Temporal.Instant.from(e.ended_at).toZonedDateTimeISO(zone));
		}
		billable = e.billable ?? true;
		note = e.note ?? '';
	});

	const entity = $derived((data.entities as Ent[]).find((e) => e.id === entityId));
	const sites = $derived(entity?.sites ?? []);
	const site = $derived(sites.find((s) => s.id === siteId));
	const service = $derived(data.services.find((s) => s.id === serviceId));

	const rate = $derived(rateFor(data.prices, serviceId, entityId, heads));

	const seconds = $derived(parseLength(length));
	const took = $derived(seconds !== null && seconds > 0 ? seconds : null);
	const hours = $derived(took === null ? null : secondsAsHours(took));
	const nextDay = $derived(
		day && start && end ? endingAt(at(day, start, zone), end).nextDay : false
	);

	/**
	 * The start is the anchor. A changed start or day moves the end and keeps the
	 * length; a changed length moves the end; a changed end changes the length.
	 * Until there is a start, whatever else is typed waits for one.
	 */
	function follow(changed: 'start' | 'length' | 'end') {
		moved = true;
		if (!day || !start) return;
		const from = at(day, start, zone);
		if (changed === 'end') {
			if (end) length = lengthText(endingAt(from, end).seconds);
			return;
		}
		const len = parseLength(length);
		if (len !== null && len > 0) end = clockOf(endAfter(from, len));
		else if (changed === 'start' && end) length = lengthText(endingAt(from, end).seconds);
	}

	async function save() {
		why = '';
		if (!day || day > data.today) {
			why = 'Pick the day it was worked. It cannot be in the future.';
			return;
		}
		// Fixing an entry recorded as a length alone, with no start given: it is
		// saved as a length again.
		const untimed = !!fixing && !fixing.entry.started_at && !start;
		if (!start && !untimed) {
			why = 'When it started.';
			return;
		}
		if (took === null) {
			why = 'How long it took -- 2:40, 4.5 or 45m -- or when it ended.';
			return;
		}
		if (took >= 86_400) {
			why = 'Under a day. Work that ran longer is more than one entry.';
			return;
		}
		if (billable && !entityId) {
			why = 'Billable work needs somebody to bill.';
			return;
		}
		if (!serviceId) {
			why = 'What was done?';
			return;
		}
		if (crew === 'one' && !workedBy) {
			why = 'Who worked it?';
			return;
		}
		if (crew === 'team' && crewIds.length < 2) {
			why = 'A team is two or more. Tick who else was on it, or pick one person.';
			return;
		}

		// The two moments, worked out where the work was done. A fixed entry whose
		// times nobody touched keeps them to the second, as they were recorded.
		let when: Pick<Entry, 'started_at' | 'ended_at' | 'zone' | 'minutes'>;
		const kept = fixing?.entry.started_at && !moved ? fixing.entry : null;
		if (untimed) when = { minutes: Math.round(took / 60) };
		else if (kept) when = { started_at: kept.started_at, ended_at: kept.ended_at, zone: kept.zone };
		else {
			const from = at(day, start, zone);
			const to = endAfter(from, took);
			if (Temporal.Instant.compare(to.toInstant(), Temporal.Now.instant()) > 0) {
				why = 'That ends after now. Still working? Start a timer instead.';
				return;
			}
			when = { started_at: from.toInstant().toString(), ended_at: to.toInstant().toString(), zone };
		}
		const entry: Entry = {
			client_uuid: fixing?.entry.client_uuid ?? crypto.randomUUID(),
			worked_on: day,
			...when,
			crew,
			worked_by: crew === 'team' ? null : workedBy,
			...(crew === 'team' ? { crew_ids: [...crewIds] } : {}),
			created_by: data.me,
			entity_id: entityId,
			site_id: siteId,
			service_id: serviceId,
			billable,
			note: note.trim() || null
		};

		saving = true;
		// Written down locally first, always. The connection decides when it
		// reaches the server, not whether the work was recorded.
		try {
			await enqueue(entry);
		} catch {
			why = 'This phone would not save it. Nothing was recorded; try again.';
			saving = false;
			return;
		}
		await flush().catch(() => {});
		saving = false;
		await goto(resolve('/timesheet'));
	}
</script>

<Top
	title={fixing ? 'Fix an entry' : 'Add past work'}
	sub={fixing
		? 'Refused by the server, kept on this phone'
		: 'Work already finished, entered by hand'}
	back={resolve('/timesheet')}
	backLabel="Time"
/>

<div class="pad">
	<div class="rows form">
		{#if fixing?.refused}<p class="why bad">Refused: {fixing.refused.detail}</p>{/if}

		<div class="fld">
			<label for="m-entity">Who pays</label>
			<select id="m-entity" class="inp" bind:value={entityId} onchange={() => (siteId = null)}>
				<option value={null}>Nobody — not billable</option>
				{#each data.entities as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
			</select>
		</div>

		<div class="fld">
			<label for="m-site">Where</label>
			<span class="inp-wrap">
				<select id="m-site" class="inp" bind:value={siteId} disabled={!entityId}>
					<option value={null}>{entityId ? 'Which site' : 'Choose who pays first'}</option>
					{#each sites as st (st.id)}<option value={st.id}>{st.label}</option>{/each}
				</select>
				{#if site?.rate_pct}<span class="hint">{pct(site.rate_pct)}</span>{/if}
			</span>
		</div>

		<div class="fld">
			<label for="m-service">What was done</label>
			<span class="inp-wrap">
				<select id="m-service" class="inp" bind:value={serviceId}>
					{#if !serviceId}<option value={null} disabled>Choose what was done</option>{/if}
					{#each data.services as sv (sv.id)}<option value={sv.id}>{sv.name}</option>{/each}
				</select>
				{#if serviceId}
					<span class="hint">
						{rate ? `${unitPrice(rate)}/${service?.unit === 'mile' ? 'mi' : 'h'}` : 'not priced'}
					</span>
				{/if}
			</span>
		</div>

		<div class="fld">
			<span class="lbl">Who worked it</span>
			<div class="seg">
				{#each data.people as p (p.id)}
					<button
						type="button"
						class:on={crew === 'one' && workedBy === p.id}
						onclick={() => {
							crew = 'one';
							workedBy = p.id;
						}}>{p.name.split(' ')[0]}</button
					>
				{/each}
				<button type="button" class:on={crew === 'team'} onclick={() => (crew = 'team')}
					>Team</button
				>
			</div>
		</div>

		{#if crew === 'team'}
			<div class="fld">
				<span class="lbl">Who was on it</span>
				<div class="seg">
					{#each data.people as p (p.id)}
						<button
							type="button"
							class:on={crewIds.includes(p.id)}
							aria-pressed={crewIds.includes(p.id)}
							onclick={() => toggle(p.id)}>{p.name.split(' ')[0]}</button
						>
					{/each}
				</div>
				<small class="lt">Billed for {heads}, and each of them paid.</small>
			</div>
		{/if}

		<div class="fld">
			<label for="m-day">Day it was worked</label>
			<input
				id="m-day"
				class="inp"
				type="date"
				max={data.today}
				value={day}
				oninput={(e) => {
					day = e.currentTarget.value;
					follow('start');
				}}
			/>
		</div>

		<!-- The start and one other; the third fills itself in, and any of the
		     three can be changed after. -->
		<div class="fld">
			<label for="m-start">Started</label>
			<input
				id="m-start"
				class="inp"
				type="time"
				value={start}
				oninput={(e) => {
					start = e.currentTarget.value;
					follow('start');
				}}
			/>
		</div>

		<div class="fld">
			<label for="m-length">Took</label>
			<span class="inp-wrap">
				<input
					id="m-length"
					class="inp"
					inputmode="text"
					placeholder="2:40"
					value={length}
					oninput={(e) => {
						length = e.currentTarget.value;
						follow('length');
					}}
				/>
				{#if hours}<span class="hint">{hours}</span>{/if}
			</span>
			<!-- The three shapes the parser takes, said out loud. A box labelled
			     "Duration" with "2:40" greyed in it is a guess about whether 4.5
			     or 45m will be understood, and leaves the answer invisible. -->
			<small class="lt">2:40 for hours and minutes · 4.5 for hours · 45m for minutes</small>
		</div>

		<div class="fld">
			<label for="m-end">Ended</label>
			<span class="inp-wrap">
				<input
					id="m-end"
					class="inp"
					type="time"
					value={end}
					oninput={(e) => {
						end = e.currentTarget.value;
						follow('end');
					}}
				/>
				{#if nextDay}<span class="hint">the next day</span>{/if}
			</span>
			<small class="lt"
				>A start and either how long it took or when it ended{#if zone !== personalZone()}
					· on the clock in {zoneName(zone)}{/if}</small
			>
		</div>

		<button type="button" class="tog" class:on={billable} onclick={() => (billable = !billable)}>
			<span class="sw"></span>
			<span>{billable ? 'Billable' : 'Not billable'}</span>
		</button>

		<div class="fld">
			<label for="m-note">Note — appears on the invoice</label>
			<input id="m-note" class="inp" placeholder="What was done" bind:value={note} />
		</div>

		{#if why}<p class="why bad">{why}</p>{/if}

		<button class="btn pri blk" onclick={save} disabled={saving}>
			{saving ? 'Saving…' : fixing ? 'Save and send again' : 'Save entry'}
		</button>

		<p class="aside">
			Still working? <a href={resolve('/timesheet/start')}>Start a timer</a> instead and it will fill
			this in for you.
		</p>
	</div>
</div>

<style>
	.form {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 15px;
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	/* The hint sits inside the box. */
	.inp-wrap {
		position: relative;
		display: block;
	}
	.inp-wrap .hint {
		position: absolute;
		right: 38px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		color: var(--ink-3);
		font-family: var(--f-mono);
		pointer-events: none;
	}
	.why.bad {
		border-left-color: var(--crit);
		color: var(--crit);
	}
	.aside {
		margin: 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	select.inp:disabled {
		color: var(--ink-3);
	}
	button.btn[disabled] {
		opacity: 0.6;
		cursor: default;
	}
</style>
