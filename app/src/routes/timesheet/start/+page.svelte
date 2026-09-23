<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import Top from '$lib/Top.svelte';
	import { start } from '$lib/timers';
	import { money } from '$lib/money.svelte';
	import { rateFor } from '$lib/rates';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	/**
	 * Starts a timer. It does not ask how long anything took.
	 *
	 * That sounds obvious and was not: "Start a timer" linked to the manual
	 * entry form, which opens with a Duration box. Pressing start and being
	 * asked how long the work you have not done yet will take is nonsense, and
	 * it made the one thing this app exists for -- capture time as it happens
	 * -- the one thing it could not do.
	 *
	 * The clock starts NOW and nothing is written down yet. A running timer
	 * lives in this browser precisely so it survives a shed with no reception
	 * and a reload; the entry is made when it stops.
	 */
	// untrack: these seed the form once. A later load must not reach in and
	// change what somebody has already picked.
	let entityId = $state<string | null>(null);
	let siteId = $state<string | null>(null);
	// The same rule the manual form uses, for the same reason: alphabetical
	// order opens on "Emergency attendance", which nothing can be billed under,
	// and a per-mile service opening by default starts a clock on driving.
	let serviceId = $state<string>(
		untrack(() => {
			const priced = (s: { id: string }) => data.prices.some((p) => p.service_id === s.id);
			return (
				(
					data.services.find((s) => s.delivery === 'on_site' && priced(s)) ??
					data.services.find((s) => s.delivery && priced(s)) ??
					data.services.find(priced) ??
					data.services[0]
				)?.id ?? ''
			);
		})
	);
	let crew = $state<'one' | 'team'>('one');
	let workedBy = $state<string | null>(untrack(() => data.me ?? data.people[0]?.id ?? null));
	let billable = $state(true);
	let note = $state('');
	let why = $state('');

	const sites = $derived(data.entities.find((e) => e.id === entityId)?.sites ?? []);
	const site = $derived(sites.find((s) => s.id === siteId));
	const service = $derived(data.services.find((s) => s.id === serviceId));

	const rate = $derived(rateFor(data.prices, serviceId, entityId, crew));

	function go() {
		why = '';
		if (billable && !entityId) {
			why = 'Billable work needs somebody to bill. Turn it off, or pick who pays.';
			return;
		}
		if (!serviceId) {
			why = 'Pick what is being done.';
			return;
		}
		if (crew === 'one' && !workedBy) {
			why = 'Pick who is working, or say both of you are.';
			return;
		}
		start({
			crew,
			worked_by: crew === 'team' ? null : workedBy,
			entity_id: entityId,
			site_id: siteId,
			service_id: serviceId,
			billable,
			note: note.trim() || null
		});
		void goto(resolve('/timesheet'));
	}
</script>

<Top
	title="Start a timer"
	sub="The clock starts now"
	back={resolve('/timesheet')}
	backLabel="Time"
/>

<div class="pad">
	<div class="rows form">
		<div class="fld">
			<label for="s-entity">Who pays</label>
			<select id="s-entity" class="inp" bind:value={entityId} onchange={() => (siteId = null)}>
				<option value={null}>Nobody — not billable</option>
				{#each data.entities as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
			</select>
		</div>

		<div class="fld">
			<label for="s-site">Where</label>
			<span class="inp-wrap">
				<select id="s-site" class="inp" bind:value={siteId} disabled={!entityId}>
					<option value={null}>{entityId ? 'Which site' : 'Choose who pays first'}</option>
					{#each sites as st (st.id)}<option value={st.id}>{st.label}</option>{/each}
				</select>
				{#if site?.rate_pct}<span class="hint">{Number(site.rate_pct).toFixed(3)}%</span>{/if}
			</span>
		</div>

		<div class="fld">
			<label for="s-service">What</label>
			<span class="inp-wrap">
				<select id="s-service" class="inp" bind:value={serviceId}>
					{#each data.services as sv (sv.id)}<option value={sv.id}>{sv.name}</option>{/each}
				</select>
				<span class="hint">
					{rate ? `${money(rate)}/${service?.unit === 'mile' ? 'mi' : 'h'}` : 'not priced'}
				</span>
			</span>
		</div>

		<div class="fld">
			<span class="lbl">Who is working</span>
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
				<button type="button" class:on={crew === 'team'} onclick={() => (crew = 'team')}>
					Both
				</button>
			</div>
		</div>

		<button type="button" class="tog" class:on={billable} onclick={() => (billable = !billable)}>
			<span class="sw"></span>
			<span>{billable ? 'Billable' : 'Not billable'}</span>
		</button>

		<div class="fld">
			<label for="s-note">Note — appears on the invoice</label>
			<input id="s-note" class="inp" placeholder="What is being done" bind:value={note} />
		</div>

		{#if why}<p class="why bad">{why}</p>{/if}

		<button class="btn pri blk" onclick={go}>Start the clock</button>

		<p class="aside">
			Nothing is written down until it stops, so this works with no reception and survives a reload.
			Already finished? <a href={resolve('/timesheet/manual')}>Enter it by hand</a>.
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
		color: var(--crit);
	}
	.aside {
		margin: 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
