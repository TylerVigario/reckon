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
	<div class="primer"><UnderlineNav label="Reports" items={reportTabs('non-billable')} /></div>

	<div class="sec">
		<div class="sec-h">
			<h2>{data.month.label}</h2>
			<span class="sp"></span>
			<span class="chip">{hours(data.given.hours, 'glance')}</span>
		</div>
		<div class="rows">
			{#each data.given.rows as g (g.service)}
				<div class="rec">
					<div class="rec-m"><div class="rec-t">{g.service}</div></div>
					<div class="rec-n">
						<span class="rec-v mut">{money(g.worth)}</span>
						<span class="rec-x">{hours(g.hours)}</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing given away</span></div>
						<div class="rec-s">Every hour worked in {data.month.label} went on an invoice</div>
					</div>
				</div>
			{/each}
			{#if data.given.rows.length}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">What the business cost itself</div></div>
					<div class="rec-n">
						<span class="rec-v">{money(data.given.worth)}</span>
						<span class="rec-x">{hours(data.given.hours)}</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
