<script lang="ts">
	import { minutesAsHours, pct } from '#lib/format.ts';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import { enqueue, find, flush, secondsOf, type Entry, type Queued } from '#lib/queue.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { rateFor } from '#lib/rates.ts';
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
	let duration = $state('');
	// Not every entry is today's -- an evening spent writing up Tuesday is the
	// ordinary case, so the day is asked for rather than assumed.
	let day = $state(untrack(() => data.today));
	let billable = $state(true);
	let note = $state('');
	let saving = $state(false);
	let why = $state('');

	// FIXING an entry the server refused: the same form, filled in from the
	// copy the phone kept, saved back under the same client_uuid -- which
	// replaces the refused copy rather than adding a second entry. Whatever
	// the server named as gone is left empty to be chosen again.
	let fixing = $state<Queued | null>(null);
	// A timed entry being fixed keeps its own start and end unless its length or
	// its day is changed here, where only a length can be typed.
	let asTimed = $state<{ duration: string; day: string } | null>(null);
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
		day = e.worked_on;
		const m = Math.max(1, Math.round(secondsOf(e) / 60));
		duration = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
		if (e.started_at) asTimed = { duration, day };
		billable = e.billable ?? true;
		note = e.note ?? '';
	});

	const entity = $derived((data.entities as Ent[]).find((e) => e.id === entityId));
	const sites = $derived(entity?.sites ?? []);
	const site = $derived(sites.find((s) => s.id === siteId));
	const service = $derived(data.services.find((s) => s.id === serviceId));

	const rate = $derived(rateFor(data.prices, serviceId, entityId, crew));

	/** "2:40" or "4.5" or "45m" -- all things a person actually types. */
	const minutes = $derived.by(() => {
		const v = duration.trim().toLowerCase();
		if (!v) return 0;
		let m = /^(\d+):([0-5]?\d)$/.exec(v);
		if (m) return Number(m[1]) * 60 + Number(m[2]);
		m = /^(\d+(?:\.\d+)?)\s*h?$/.exec(v);
		if (m) return Math.round(Number(m[1]) * 60);
		m = /^(\d+)\s*m$/.exec(v);
		if (m) return Number(m[1]);
		return NaN;
	});

	const hours = $derived(
		duration.trim() === '' || Number.isNaN(minutes) || minutes <= 0 ? null : minutesAsHours(minutes)
	);

	async function save() {
		why = '';
		if (!day || day > data.today) {
			why = 'Pick the day it was worked. It cannot be in the future.';
			return;
		}
		if (Number.isNaN(minutes) || minutes <= 0) {
			why = 'How long it took: 2:40, or 4.5, or 45m.';
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

		const kept = asTimed?.duration === duration && asTimed.day === day ? fixing?.entry : null;
		const entry: Entry = {
			client_uuid: fixing?.entry.client_uuid ?? crypto.randomUUID(),
			worked_on: day,
			...(kept
				? { started_at: kept.started_at, ended_at: kept.ended_at, zone: kept.zone }
				: { minutes }),
			crew,
			worked_by: crew === 'team' ? null : workedBy,
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

		<div class="fld">
			<label for="m-day">Day it was worked</label>
			<input id="m-day" class="inp" type="date" max={data.today} bind:value={day} />
		</div>

		<div class="fld">
			<label for="m-duration">How long it took</label>
			<span class="inp-wrap">
				<input
					id="m-duration"
					class="inp"
					inputmode="text"
					placeholder="2:40"
					bind:value={duration}
				/>
				{#if hours}<span class="hint">{hours}</span>{/if}
			</span>
			<!-- The three shapes the parser takes, said out loud. A box labelled
			     "Duration" with "2:40" greyed in it is a guess about whether 4.5
			     or 45m will be understood, and leaves the answer invisible. -->
			<small class="lt">2:40 for hours and minutes · 4.5 for hours · 45m for minutes</small>
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
