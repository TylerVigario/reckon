<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import Top from '$lib/Top.svelte';
	import { enqueue, flush, type Entry } from '$lib/queue';
	import { money } from '$lib/money.svelte';
	import { rateFor } from '$lib/rates';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	type Site = { id: string; label: string; rate_pct: string | null };
	type Ent = { id: string; name: string; sites: Site[] };

	let entityId = $state<string | null>(null);
	let siteId = $state<string | null>(null);
	// Seeded once from the load; after that the box is the truth. Alphabetical
	// order put the unpriced "Emergency attendance" first, so the form opened on
	// the one service nothing can be billed under.
	let serviceId = $state<string | null>(
		untrack(() => {
			const priced = (s: { id: string }) => data.prices.some((p) => p.service_id === s.id);
			// Attendance first: this form records time, and a per-mile service
			// opening by default asks for a duration of driving. Alphabetical
			// order gave Emergency attendance (unpriced), then Mileage.
			return (
				(
					data.services.find((s) => s.delivery === 'on_site' && priced(s)) ??
					data.services.find((s) => s.delivery && priced(s)) ??
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
	// ordinary case, and the form used to silently file it as today.
	let day = $state(untrack(() => data.today));
	let billable = $state(true);
	let note = $state('');
	let saving = $state(false);
	let why = $state('');

	const entity = $derived((data.entities as Ent[]).find((e) => e.id === entityId));
	const sites = $derived(entity?.sites ?? []);
	const site = $derived(sites.find((s) => s.id === siteId));
	const service = $derived(data.services.find((s) => s.id === serviceId));

	const rate = $derived(rateFor(data.prices, serviceId, entityId, crew));

	/** "4:31" or "4.5" or "45m" -- all things a person actually types. */
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
		duration.trim() === '' || Number.isNaN(minutes) || minutes <= 0
			? null
			: (minutes / 60).toFixed(4)
	);

	async function save() {
		why = '';
		if (!day || day > data.today) {
			why = 'Pick the day it was worked. It cannot be in the future.';
			return;
		}
		if (Number.isNaN(minutes) || minutes <= 0) {
			why = 'How long it took: 4:31, or 4.5, or 45m.';
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

		const entry: Entry = {
			client_uuid: crypto.randomUUID(),
			worked_on: day,
			minutes,
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
		enqueue(entry);
		await flush().catch(() => {});
		saving = false;
		await goto(resolve('/timesheet'));
	}
</script>

<Top
	title="Add past work"
	sub="Work already finished, entered by hand"
	back={resolve('/timesheet')}
	backLabel="Time"
/>

<div class="pad">
	<div class="rows form">
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
				{#if site?.rate_pct}<span class="hint">{Number(site.rate_pct).toFixed(3)}%</span>{/if}
			</span>
		</div>

		<div class="fld">
			<label for="m-service">What was done</label>
			<span class="inp-wrap">
				<select id="m-service" class="inp" bind:value={serviceId}>
					{#each data.services as sv (sv.id)}<option value={sv.id}>{sv.name}</option>{/each}
				</select>
				<span class="hint">
					{rate ? `${money(rate)}/${service?.unit === 'mile' ? 'mi' : 'h'}` : 'not priced'}
				</span>
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
					>Both</button
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
					placeholder="4:31"
					bind:value={duration}
				/>
				{#if hours}<span class="hint">{hours} h</span>{/if}
			</span>
			<!-- The three shapes the parser takes, said out loud. A box labelled
			     "Duration" with "4:31" greyed in it is a guess about whether 4.5
			     or 45m will be understood, and the answer was invisible. -->
			<small class="lt">4:31 for hours and minutes · 4.5 for hours · 45m for minutes</small>
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
			{saving ? 'Saving…' : 'Save entry'}
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
	/* The hint sits inside the box, where the mock puts it. */
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
	/* The platform's arrow ignores the padding above it; drawn here it lines up
	   with the text, the same way the settings selects do. */
	select.inp {
		appearance: none;
		padding-right: 2.4rem;
		background-image:
			linear-gradient(45deg, transparent 50%, currentColor 50%),
			linear-gradient(135deg, currentColor 50%, transparent 50%);
		background-size:
			0.36rem 0.36rem,
			0.36rem 0.36rem;
		background-position:
			right 1.2rem center,
			right 0.85rem center;
		background-repeat: no-repeat;
	}
	select.inp:disabled {
		color: var(--ink-3);
	}
	button.btn[disabled] {
		opacity: 0.6;
		cursor: default;
	}
</style>
