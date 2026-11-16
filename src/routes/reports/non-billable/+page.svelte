<script lang="ts">
	import { hours } from '#lib/format.ts';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { reportTabs } from '#lib/section-tabs.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * What the business cost itself last month: each service's hours worked
	 * and not charged for, at what they would have billed (#lib/server/reports
	 * nonBillable). Time given on purpose is still a cost, shown so that giving
	 * it stays a choice somebody can see.
	 */
	let { data }: PageProps = $props();
</script>

<Top title="Reports" back={resolve('/more')} backLabel="More" />

<div class="pad">
	<UnderlineNav label="Reports" items={reportTabs('non-billable')} />

	<section class="box" aria-labelledby="given-h">
		<div class="box-h">
			<h2 class="box-t" id="given-h">{data.month.label}</h2>
			<span class="count">{hours(data.given.hours, 'glance')}</span>
		</div>
		{#each data.given.rows as g (g.service)}
			<div class="box-row line">
				<span class="what"><span class="n">{g.service}</span></span>
				<span class="fig">
					<span class="v muted">{money(g.worth)}</span>
					<span class="sub">{hours(g.hours)}</span>
				</span>
			</div>
		{:else}
			<p class="box-row muted">
				Nothing given away: every hour worked in {data.month.label} went on an invoice.
			</p>
		{/each}
		{#if data.given.rows.length}
			<div class="box-row line tot">
				<span class="what"><span class="n">What the business cost itself</span></span>
				<span class="fig">
					<span class="v">{money(data.given.worth)}</span>
					<span class="sub">{hours(data.given.hours)}</span>
				</span>
			</div>
		{/if}
	</section>
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
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
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
