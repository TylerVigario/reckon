<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import Segmented from '#lib/Segmented.svelte';
	import { page } from '$app/state';
	import { reportTabs } from '#lib/section-tabs.ts';
	import { dated, day, hours, miles } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { PAID_AS_WORDS, type PaidAs } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Pay, the first of the reports, seen one of three ways (#lib/Segmented):
	 * by person, what each is owed, grouped by what their pay is; by job, last
	 * month's jobs and trips, what each paid out and what the business kept;
	 * and by hour, what an hour of each service bills and pays each person now.
	 */
	let { data }: PageProps = $props();
	const by = $derived(
		(['job', 'hour'] as const).find((b) => b === page.url.searchParams.get('by')) ?? 'person'
	);
	const view = (b: 'person' | 'job' | 'hour') =>
		b === 'person' ? resolve('/reports/pay') : resolve(`/reports/pay?by=${b}`);

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
	// People by what their role says their pay is, each heading where it is
	// reported (0027); a role that has not said comes last, to be put right.
	const groups = $derived(
		(['guaranteed_payment', 'wages', 'fee', null] as const)
			.map((as) => ({ as, people: data.people.filter((p) => p.pays_as === as) }))
			.filter((g) => g.people.length)
	);
	// The role's own name, where the heading does not already say it.
	const roleOf = (p: { role: string | null; pays_as: PaidAs | null }) =>
		p.role && p.role !== (p.pays_as && PAID_AS_WORDS[p.pays_as].role) ? p.role : null;
	// "$170.25 for work · $24.95 for the vehicle", where a vehicle is owed for.
	const split = (p: { owed_work: string; owed_vehicle: string }) =>
		Number(p.owed_vehicle) !== 0
			? `${money(p.owed_work)} for work · ${money(p.owed_vehicle)} for the vehicle`
			: null;
	// The month's pay by what it is, and what of it payments recorded.
	const dueSaid = $derived(
		[
			...data.due_as.map(
				(d) => `${money(d.amount)} ${d.paid_as ? PAID_AS_WORDS[d.paid_as].money : 'not said'}`
			),
			Number(data.recorded) !== 0 ? `${money(data.recorded)} of it paid` : null
		]
			.filter(Boolean)
			.join(' · ')
	);
	// What a person was last paid, or that they have not been.
	const lastOf = (p: { last: { paid_on: string; total: string; how: string } | null }) =>
		[
			p.last
				? `Last paid ${day(p.last.paid_on)} · ${money(p.last.total)} · ${p.last.how.toLowerCase()}`
				: 'Nothing paid yet'
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

{#snippet paidBy(list: { who: string; paid_on: string }[])}
	{#each list as b (b.who + b.paid_on)}
		<span class="lab good">{b.who} paid {day(b.paid_on)}</span>
	{/each}
{/snippet}

<Top title="Reports" back={resolve('/more')} backLabel="More" />

<div class="pad">
	<UnderlineNav label="Reports" items={reportTabs('pay', data.scheduleA)} />
	<Segmented
		label="Pay, seen"
		items={[
			{ href: view('person'), label: 'By person', current: by === 'person' },
			{ href: view('job'), label: 'By job', current: by === 'job' },
			{ href: view('hour'), label: 'By hour', current: by === 'hour' }
		]}
	/>

	{#if by === 'person'}
		{#each groups as g (g.as)}
			<section class="box" aria-labelledby="g-{g.as ?? 'none'}">
				<div class="box-h">
					<h2 class="box-t" id="g-{g.as ?? 'none'}">
						{g.as ? PAID_AS_WORDS[g.as].people : 'Paid as not said'}
					</h2>
					{#if g.as}<span class="sub">{PAID_AS_WORDS[g.as].money}</span>{/if}
				</div>
				{#each g.people as p (p.id)}
					{@const also = split(p)}
					<a class="box-row line" href={resolve('/reports/pay/[person]', { person: p.id })}>
						<span class="what">
							<span class="n">{p.name}</span>
							{#if roleOf(p)}<span class="sub">{roleOf(p)}</span>{/if}
							{#if !p.pays_as}
								<span class="sub warn">
									{p.role
										? `${p.role} does not say what it is paid as`
										: 'Holds no role, so nothing says what they are paid as'}
								</span>
							{/if}
							{#if also}<span class="sub">{also}</span>{/if}
							<span class="sub">{lastOf(p)}</span>
						</span>
						{#if p.unknown > 0}<span class="lab warn">{p.unknown} with no rule</span>{/if}
						<span class="fig">
							<span class="v">{money(p.owed)}</span>
							<span class="sub">owed</span>
						</span>
					</a>
				{/each}
			</section>
		{:else}
			<p class="note">Nobody is owed anything.</p>
		{/each}
	{:else if by === 'job'}
		<section class="box" aria-labelledby="month-h">
			<div class="box-h">
				<h2 class="box-t" id="month-h">{data.month.label}</h2>
				<span class="sub">paid · kept</span>
			</div>
			{#each days as r, i (r.worked_on + i)}
				<div class="box-row line">
					<span class="what">
						<span class="n">{r.job} · {day(r.worked_on)}</span>
						{#if r.kind === 'job'}
							<span class="sub"
								>{[who(r), hours(r.hours), r.heads > 1 ? `${r.heads} on the job` : null]
									.filter(Boolean)
									.join(' · ')}</span
							>
						{:else}
							<span class="sub">{drove(r)}</span>
						{/if}
						{#if r.paid_by.length}<span class="labs">{@render paidBy(r.paid_by)}</span>{/if}
					</span>
					{#if r.kind === 'trip' && r.paid === null}<span class="lab warn">No rule pays it</span
						>{/if}
					<span class="fig">
						<span class="v">{money(r.paid)}</span>
						<span class="sub">kept {money(r.kept)}</span>
					</span>
				</div>
			{:else}
				<p class="box-row muted">
					Nothing worked: no billable hours or trips were recorded in {data.month.label}.
				</p>
			{/each}
			{#if days.length}
				<div class="box-row line tot">
					<span class="what">
						<span class="n">Pay due</span>
						{#if dueSaid}<span class="sub">{dueSaid}</span>{/if}
					</span>
					<span class="fig">
						<span class="v">{money(data.due)}</span>
						<span class="sub">kept {money(data.kept)}</span>
					</span>
				</div>
			{/if}
		</section>
	{:else}
		<section class="box" aria-labelledby="hour-h">
			<div class="box-h">
				<h2 class="box-t" id="hour-h">An hour now</h2>
				<span class="sub">kept</span>
			</div>
			{#each data.rates as r (r.service_id + r.crew + r.who)}
				<div class="box-row line">
					<span class="what">
						<span class="n">{r.service} · {r.who}</span>
						<span class="sub">{terms(r)}</span>
					</span>
					{#if r.unpaid}<span class="lab warn">No rule pays it</span>{/if}
					<span class="fig"><span class="v">{money(r.kept)}</span></span>
				</div>
			{:else}
				<p class="box-row muted">
					Nothing priced by the hour: an hour needs a price before it can say what it keeps.
				</p>
			{/each}
		</section>
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
	.sub.warn {
		color: var(--fgColor-attention);
	}
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.lab {
		flex: 0 0 auto;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.tot {
		background: var(--bgColor-muted);
	}
</style>
