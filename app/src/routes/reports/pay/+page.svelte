<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { dated, day, hours, miles } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// The month is in the header, so a job's day does not repeat it. A rate's
	// start date can be any year, so it says which.

	// A team job names its crew, as the server lists them.
	const who = (j: { who: string | null }) => j.who ?? 'nobody recorded';

	// Jobs and trips in one list, a day at a time; a day's jobs before its trips.
	const days = $derived(
		[
			...data.jobs.map((j) => ({ kind: 'job' as const, ...j })),
			...data.trips.map((t) => ({ kind: 'trip' as const, ...t }))
		].sort((a, b) => a.worked_on.localeCompare(b.worked_on))
	);
	// A trip's miles pay whoever owns the vehicle, so that is who it names.
	const drove = (t: { vehicle: string | null; owner: string | null; miles: string }) =>
		[
			t.vehicle === null
				? 'No vehicle recorded'
				: t.owner
					? `${t.owner} · for the ${t.vehicle}`
					: `The business's ${t.vehicle}`,
			miles(t.miles)
		].join(' · ');
	// Built here rather than in the markup: a template that interleaves text
	// with {#if} blocks loses the space between them.
	const terms = (r: { billed: string; paid: string | null; since: string | null }) =>
		[
			`${money(r.billed)} billed`,
			r.paid === null ? 'no rule pays it' : `${money(r.paid)} paid`,
			r.since ? `since ${dated(r.since)}` : null
		]
			.filter(Boolean)
			.join(' · ');
</script>

<Top
	title="Pay"
	sub="{data.month.label} · resolved per job, per day"
	back={resolve('/reports')}
	backLabel="Reports"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>{data.month.label}</h2></div>
		<div class="rows">
			{#each days as r, i (r.worked_on + i)}
				{#if r.kind === 'job'}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{r.job} · {day(r.worked_on)}</div>
							<div class="rec-s">
								{who(r)} · {hours(r.hours)}{#if r.heads > 1}
									· {r.heads} on the job{/if}
							</div>
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(r.paid)}</span>
							<span class="rec-x">kept {money(r.kept)}</span>
						</div>
					</div>
				{:else}
					<div class="rec" class:warn={r.paid === null}>
						<div class="rec-m">
							<div class="rec-t">{r.job} · {day(r.worked_on)}</div>
							<div class="rec-s">{drove(r)}</div>
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(r.paid)}</span>
							<span class="rec-x">kept {money(r.kept)}</span>
						</div>
					</div>
				{/if}
			{/each}
			{#if !days.length}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing worked</span></div>
						<div class="rec-s">No billable hours or trips were recorded in {data.month.label}</div>
					</div>
				</div>
			{:else}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Pay due</div></div>
					<div class="rec-n">
						<span class="rec-v">{money(data.due)}</span>
						<span class="rec-x">kept {money(data.kept)}</span>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>An hour now</h2></div>
		<div class="rows">
			{#each data.rates as r (r.service_id + r.crew + r.who)}
				<div class="rec" class:warn={r.unpaid}>
					<div class="rec-m">
						<div class="rec-t">{r.service} · {r.who}</div>
						<div class="rec-s">{terms(r)}</div>
					</div>
					<div class="rec-n">
						<span class="rec-v" class:good={!r.unpaid && Number(r.kept) > 0}>{money(r.kept)}</span>
						<span class="rec-x">kept</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing priced by the hour</span></div>
						<div class="rec-s">An hour needs a price before it can say what it keeps</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
