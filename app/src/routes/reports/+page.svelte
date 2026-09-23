<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const sub = $derived(data.fy ? `${data.fy.label} · ${data.fy.spans}` : 'Filing year not set');
</script>

<Top title="Reports" {sub} back={resolve('/more')} backLabel="More" />

<div class="pad">
	<div class="sec">
		<div class="rows">
			{#if data.scheduleA}
				<a class="rec link" href={resolve('/reports/schedule-a')}>
					<div class="rec-m">
						<div class="rec-t">Schedule A</div>
						<div class="rec-s">Measure and deduction by district, each at its own rate</div>
						<div class="rec-c">
							{#if data.scheduleA.unchecked}
								<span class="chip warn">
									<span class="dot"></span>{data.scheduleA.unchecked} rate{data.scheduleA
										.unchecked === 1
										? ''
										: 's'} over 90 days old
								</span>
							{:else}
								<span class="chip good"><span class="dot"></span>Every rate recently asked for</span
								>
							{/if}
						</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">{money(data.scheduleA.due)}</span></div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{:else}
				<a class="rec link warn" href={resolve('/settings/tax')}>
					<div class="rec-m">
						<div class="rec-t">Schedule A</div>
						<div class="rec-s">
							Needs the month the filing year ends in, which is a setting nobody has made
						</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">—</span></div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{/if}

			<a class="rec link" href={resolve('/reports/partner-pay')}>
				<div class="rec-m">
					<div class="rec-t">Partner pay</div>
					<div class="rec-s">Guaranteed payments, resolved per job per day</div>
				</div>
				<div class="rec-n"><span class="rec-v mut">{money(data.pay.due)}</span></div>
				<span class="arw" aria-hidden="true">›</span>
			</a>

			<a class="rec link" href={resolve('/reports/remote')}>
				<div class="rec-m">
					<div class="rec-t">Remote meter</div>
					<div class="rec-s">What the retainer covered, and what it was worth</div>
				</div>
				<div class="rec-n"><span class="rec-v mut">{money(data.meter.charged)}</span></div>
				<span class="arw" aria-hidden="true">›</span>
			</a>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h">
			<h2>Non-billable — {data.month.label}</h2>
			<span class="sp"></span>
			<span class="chip">{Number(data.given.hours).toFixed(1)} h</span>
		</div>
		<div class="rows">
			{#each data.given.rows as g (g.service)}
				<div class="rec">
					<div class="rec-m"><div class="rec-t">{g.service}</div></div>
					<div class="rec-n">
						<span class="rec-v mut">{money(g.worth)}</span>
						<span class="rec-x">{Number(g.hours).toFixed(4)} h</span>
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
						<span class="rec-x">{Number(data.given.hours).toFixed(4)} h</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
