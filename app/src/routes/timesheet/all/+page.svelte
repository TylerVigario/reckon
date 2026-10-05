<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { day, secondsAsHours, workedTimes } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const sub = $derived(
		[
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

<Top title="All entries" {sub} back={resolve('/timesheet')} backLabel="Time" />

<div class="pad">
	{#each data.weeks as w (w.week)}
		<div class="sec">
			<div class="sec-h"><h2>Week of {day(w.week)}</h2></div>
			<div class="rows">
				{#each w.rows as e (e.id)}
					<div class="rec" class:gone={!e.billable} class:warn={e.stale}>
						<div class="rec-m">
							<div class="rec-t">
								{e.site ?? e.entity ?? e.service}
								{#if e.crew === 'team' || !e.billable}
									<span class="lt">· {e.crew === 'team' ? 'team' : 'non-billable'}</span>
								{/if}
							</div>
							<div class="rec-s">
								{day(e.worked_on)}{#if e.started_at && e.ended_at && e.zone}
									· {workedTimes(e.started_at, e.ended_at, e.zone, personalZone())}{/if}
								· {e.crew === 'team' ? 'the team' : (e.worked_by ?? 'unassigned')}
								· {e.note ?? e.service}
							</div>
						</div>
						<div class="rec-n">
							{#if e.covered}
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
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<p class="none">Nothing captured this month.</p>
	{/each}
</div>
