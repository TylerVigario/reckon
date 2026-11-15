<script lang="ts">
	import { onMount } from 'svelte';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import Segmented from '#lib/Segmented.svelte';
	import { day, secondsAsHours, workedTimes, names } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { asChanged, changesByEntry, markOf } from '#lib/entry-changes.ts';
	import { waitingCount, type QueuedTimeChange } from '#lib/queue.ts';

	let { data }: PageProps = $props();

	// Changes made on this phone that the server cannot know yet: each entry is
	// shown as it is once changed, and says so.
	let changes = $state(new Map<string, QueuedTimeChange>());
	let waiting = $state(0);
	onMount(() => {
		void changesByEntry().then((m) => (changes = m));
		void waitingCount().then(
			(n) => (waiting = n),
			() => {}
		);
	});

	// The month asked for, kept as the scope changes.
	const month = $derived(page.url.searchParams.get('month'));
	const scoped = (who: 'everyone' | 'yours') => {
		const query = [
			month ? `month=${encodeURIComponent(month)}` : null,
			who === 'yours' ? 'who=yours' : null
		]
			.filter(Boolean)
			.join('&');
		return query ? resolve(`/timesheet/all?${query}`) : resolve('/timesheet/all');
	};

	const sub = $derived(
		data.offline
			? 'Yours, this week and last'
			: [
					data.totals?.month,
					secondsAsHours(Number(data.totals?.seconds ?? 0), 'whole'),
					Number(data.totals?.idle ?? 0) > 0
						? `${secondsAsHours(Number(data.totals.idle), 'glance')} non-billable`
						: null
				]
					.filter(Boolean)
					.join(' · ')
	);
</script>

<Top
	title={data.user?.access === 'field' ? 'All yours' : 'All entries'}
	{sub}
	back={resolve('/timesheet')}
	backLabel="Time"
/>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad primer">
	{#if data.who}
		<Segmented
			label="Whose entries"
			items={[
				{ href: scoped('everyone'), label: 'Everyone’s', current: data.who === 'everyone' },
				{ href: scoped('yours'), label: 'Yours', current: data.who === 'yours' }
			]}
		/>
	{/if}
	{#each data.weeks as w (w.week)}
		<section class="box" aria-labelledby="w-{w.week}">
			<div class="box-h"><h2 class="box-t" id="w-{w.week}">Week of {day(w.week)}</h2></div>
			{#each w.rows as row (row.id)}
				{@const q = changes.get(row.id)}
				{@const e = asChanged(row, q)}
				{@const mark = q ? markOf(q) : null}
				<a
					class="box-row line"
					class:gone={!e.billable || q?.change.act === 'remove'}
					href={resolve('/timesheet/[id]', { id: e.id })}
				>
					<span class="what">
						<span class="n">{e.site ?? e.entity ?? e.service}</span>
						<span class="sub">
							{[
								day(e.worked_on),
								e.started_at && e.ended_at && e.zone
									? workedTimes(e.started_at, e.ended_at, e.zone, personalZone())
									: null,
								e.crew === 'team' ? names(e.crew_names) : (e.worked_by ?? 'unassigned'),
								e.note ?? e.service
							]
								.filter(Boolean)
								.join(' · ')}
						</span>
						{#if mark || e.stale || e.crew === 'team' || !e.billable}
							<span class="labs">
								{#if e.crew === 'team'}<span class="lab">Team</span>{/if}
								{#if !e.billable}<span class="lab">Not billable</span>{/if}
								{#if e.stale}<span class="lab warn">Unbilled too long</span>{/if}
								{#if mark}<span class="lab {mark.tone}">{mark.text}</span>{/if}
							</span>
						{/if}
					</span>
					<span class="fig">
						{#if q}
							<span class="v mut">—</span>
						{:else if e.covered}
							<span class="sub">On retainer</span>
						{:else if e.value}
							<span class="v">{money(e.value)}</span>
						{:else}
							<span class="v mut">—</span>
						{/if}
						<span class="sub">
							{secondsAsHours(e.seconds)}{#if e.heads > 1}
								×{e.heads}{/if}
						</span>
					</span>
				</a>
			{/each}
		</section>
	{:else}
		<div class="box">
			<p class="blank-d none">
				{data.offline
					? 'Nothing of yours to change from this week or last.'
					: 'Nothing put down this month.'}
			</p>
		</div>
	{/each}
	{#if data.offline}
		<p class="note">Older entries, and everyone else’s, need a connection.</p>
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
	.v.mut,
	.gone .n,
	.gone .v {
		color: var(--fgColor-muted);
	}
	.none {
		padding: 16px;
	}
</style>
