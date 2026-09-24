<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { day } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hours = (m: number) => (m / 60).toFixed(4);

	const sub = $derived(
		[
			data.totals?.month,
			`${Math.round(Number(data.totals?.minutes ?? 0) / 60)} h`,
			Number(data.totals?.idle ?? 0) > 0
				? `${(Number(data.totals.idle) / 60).toFixed(1)} h non-billable`
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
									<span class="lt">· {e.crew === 'team' ? 'both' : 'non-billable'}</span>
								{/if}
							</div>
							<div class="rec-s">
								{day(e.worked_on)} · {e.crew === 'team'
									? 'both of you'
									: (e.worked_by ?? 'unassigned')}
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
								{hours(e.minutes)} h{#if e.heads > 1}
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
