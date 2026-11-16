<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { servicesHeld, type ServiceEntry } from '#lib/queue.ts';
	import { pricesAdded, servicesAdded } from '#lib/services-held.ts';
	import { goto } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import WorkFields from '#lib/WorkFields.svelte';
	import { focusFirstInvalid, workErrors } from '#lib/work-fields.ts';
	import { start } from '#lib/timers.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// A service added on this phone and not yet sent can be timed at once
	// (#lib/services-held); the entry waits for it.
	let held = $state<ServiceEntry[]>([]);
	onMount(() => {
		void servicesHeld().then(
			(rows) => (held = rows.filter((q) => !q.refused).map((q) => q.service)),
			() => {}
		);
	});
	const services = $derived(
		servicesAdded(data.services, held, (s) => ({
			id: s.client_uuid,
			name: s.fields.name,
			unit: s.fields.unit as (typeof data.services)[number]['unit'],
			bill_to_nearest_seconds: s.fields.unit === 'hour' ? 60 : null
		}))
	);
	const prices = $derived(pricesAdded(data.prices, held, data.people.length));

	// Someone with Field puts down only work they are on (#lib/access): their
	// own, or a team's with them on it.
	const field = untrack(() => data.user?.access === 'field');

	/**
	 * Starts a timer. It does not ask how long anything took.
	 *
	 * Being asked how long the work you have not done yet will take is
	 * nonsense, so this is not the manual entry form: capturing time as it
	 * happens is the one thing this app exists for.
	 *
	 * The clock starts NOW and nothing is written down yet. A running timer
	 * lives in this browser precisely so it survives a jobsite with no
	 * reception and a reload; the entry is made when it stops.
	 */
	let entityId = $state<string | null>(null);
	let siteId = $state<string | null>(null);
	// The same rule the manual form uses, for the same reason: a clock measures
	// hours, so it opens on a priced service billed by the hour. Alphabetical
	// order could open on a service with no price, which nothing can be billed
	// under, or on a per-mile one, which starts a clock on driving. untrack:
	// these seed the form once, and a later load must not change a pick.
	let serviceId = $state<string | null>(
		untrack(() => {
			const priced = (s: { id: string }) => data.prices.some((p) => p.service_id === s.id);
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
	let workedBy = $state<string | null>(untrack(() => data.me ?? data.people[0]?.id ?? null));
	// Who is on a team: everyone holding a role, unless some are unticked.
	let crewIds = $state<string[]>(untrack(() => data.people.map((p) => p.id)));
	let billable = $state(true);
	let note = $state('');
	let errors = $state<Record<string, string>>({});
	let form = $state<HTMLFormElement | null>(null);

	async function go(e: SubmitEvent) {
		e.preventDefault();
		errors = workErrors(
			{ entityId, siteId, serviceId, crew, workedBy, crewIds, billable, note },
			true
		);
		if (Object.keys(errors).length) {
			await tick();
			focusFirstInvalid(form);
			return;
		}
		start({
			crew,
			worked_by: crew === 'team' ? null : workedBy,
			...(crew === 'team' ? { crew_ids: [...crewIds] } : {}),
			entity_id: entityId,
			site_id: siteId,
			service_id: serviceId!,
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

<div class="pad primer">
	<form class="box form" novalidate onsubmit={go} bind:this={form}>
		<div class="box-row fields">
			<WorkFields
				choices={{ ...data, services, prices }}
				{field}
				now
				id="s"
				{errors}
				bind:entityId
				bind:siteId
				bind:serviceId
				bind:crew
				bind:workedBy
				bind:crewIds
				bind:billable
				bind:note
			/>
		</div>
		<div class="box-row keep">
			<button class="btn pri">Start the clock</button>
			<a class="btn" href={resolve('/timesheet')}>Cancel</a>
		</div>
	</form>
	<p class="note">
		Nothing is written down until it stops, so it works with no signal and survives a reload.
		Already finished? <a href={resolve('/timesheet/manual')}>Add past work</a>.
	</p>
</div>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fields > :global(*) {
		max-width: 480px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--bgColor-muted);
	}
</style>
