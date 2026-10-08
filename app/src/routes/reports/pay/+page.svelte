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
	// What a person was last paid, or that they have not been.
	const lastOf = (p: {
		unknown: number;
		last: { paid_on: string; total: string; how: string } | null;
	}) =>
		[
			p.last
				? `Last paid ${day(p.last.paid_on)} · ${money(p.last.total)} · ${p.last.how.toLowerCase()}`
				: 'Nothing paid yet',
			p.unknown ? `${p.unknown} with no rule to pay ${p.unknown === 1 ? 'it' : 'them'}` : null
		]
			.filter(Boolean)
			.join(' · ');
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
	{#if data.people.length}
		<div class="sec">
			<div class="sec-h"><h2>Owed, and paid</h2></div>
			<div class="rows">
				{#each data.people as p (p.id)}
					<a
						class="rec link"
						class:warn={p.unknown > 0}
						href={resolve('/reports/pay/[person]', { person: p.id })}
					>
						<div class="rec-m">
							<div class="rec-t">
								{p.name}{#if p.role}&nbsp;<span class="lt">· {p.role}</span>{/if}
							</div>
							<div class="rec-s">{lastOf(p)}</div>
						</div>
						<div class="rec-n">
							<span class="rec-v" class:good={Number(p.owed) === 0 && !p.unknown}
								>{money(p.owed)}</span
							>
							<span class="rec-x">owed</span>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}
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
							{#if r.paid_by.length}
								<div class="rec-c">
									{#each r.paid_by as b (b.who + b.paid_on)}
										<span class="chip good"
											><span class="dot"></span>{b.who} paid {day(b.paid_on)}</span
										>
									{/each}
								</div>
							{/if}
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
							{#if r.paid_by.length}
								<div class="rec-c">
									{#each r.paid_by as b (b.who + b.paid_on)}
										<span class="chip good"
											><span class="dot"></span>{b.who} paid {day(b.paid_on)}</span
										>
									{/each}
								</div>
							{/if}
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
					<div class="rec-m">
						<div class="rec-t">Pay due</div>
						{#if Number(data.recorded) !== 0}
							<div class="rec-s">{money(data.recorded)} of it paid</div>
						{/if}
					</div>
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

<style>
	.lt {
		font-weight: 400;
		color: var(--ink-3);
	}
</style>
