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

<div class="pad">
	{#if data.who}
		<div class="primer">
			<Segmented
				label="Whose entries"
				items={[
					{ href: scoped('everyone'), label: 'Everyone’s', current: data.who === 'everyone' },
					{ href: scoped('yours'), label: 'Yours', current: data.who === 'yours' }
				]}
			/>
		</div>
	{/if}
	{#each data.weeks as w (w.week)}
		<div class="sec">
			<div class="sec-h"><h2>Week of {day(w.week)}</h2></div>
			<div class="rows">
				{#each w.rows as row (row.id)}
					{@const q = changes.get(row.id)}
					{@const e = asChanged(row, q)}
					{@const mark = q ? markOf(q) : null}
					<a
						class="rec link"
						class:gone={!e.billable || q?.change.act === 'remove'}
						class:warn={e.stale}
						href={resolve('/timesheet/[id]', { id: e.id })}
					>
						<div class="rec-m">
							<div class="rec-t">
								{e.site ?? e.entity ?? e.service}
								{#if e.crew === 'team' || !e.billable}
									<span class="lt">· {e.crew === 'team' ? 'team' : 'non-billable'}</span>
								{/if}
							</div>
							<div class="rec-s">
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
							</div>
							{#if mark}
								<span class="chip {mark.tone}"><span class="dot"></span>{mark.text}</span>
							{/if}
						</div>
						<div class="rec-n">
							{#if q}
								<span class="rec-v mut">—</span>
							{:else if e.covered}
								<span class="rec-v mut">retainer</span>
							{:else if e.value}
								<span class="rec-v">{money(e.value)}</span>
							{:else}
								<span class="rec-v mut">—</span>
							{/if}
							<span class="rec-x">
								{secondsAsHours(e.seconds)}{#if e.heads > 1}
									×{e.heads}{/if}
							</span>
						</div>
					</a>
				{/each}
			</div>
		</div>
	{:else}
		<p class="none">
			{data.offline
				? 'Nothing of yours to change from this week or last.'
				: 'Nothing captured this month.'}
		</p>
	{/each}
	{#if data.offline}
		<p class="none">Older entries, and everyone else’s, need a connection.</p>
	{/if}
</div>
