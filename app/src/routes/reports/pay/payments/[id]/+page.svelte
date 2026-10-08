<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { resolve } from '$app/paths';
	import { day, dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const p = $derived(data.payment);
	const count = $derived(p.items.filter((i) => !i.corrects_id).length);
</script>

<Top
	title="Paid {p.person}"
	sub="{dated(p.paid_on)} · {p.how.toLowerCase()}"
	back={resolve('/reports/pay/[person]', { person: p.user_id })}
	backLabel={p.person.split(' ')[0]}
/>

<div class="pad">
	<div class="tiles">
		<div class="tile">
			<span class="k">Paid</span>
			<span class="v good">{money(p.total)}</span>
			<span class="s">for {count} {count === 1 ? 'item' : 'items'}</span>
		</div>
		<div class="tile">
			<span class="k">Recorded</span>
			<span class="v sm">{day(p.recorded_on)}</span>
			<span class="s">by {p.recorded_by}</span>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>What it covered</h2></div>
		<div class="rows">
			{#each p.items as i (i.id)}
				<div class="rec" class:acc={i.corrects_id}>
					<div class="rec-m">
						{#if i.corrects_id}
							<div class="rec-t">A correction to {dated(i.corrects)}</div>
						{:else}
							<div class="rec-t">{i.place ?? 'Work'} · {day(i.day)}</div>
						{/if}
						<div class="rec-s">{i.said}</div>
					</div>
					<div class="rec-n"><span class="rec-v">{money(i.amount)}</span></div>
				</div>
			{/each}
			<div class="rec tot">
				<div class="rec-m"><div class="rec-t">Paid</div></div>
				<div class="rec-n"><span class="rec-v">{money(p.total)}</span></div>
			</div>
		</div>
	</div>

	{#if p.note}
		<div class="sec">
			<div class="sec-h"><h2>Note</h2></div>
			<div class="rows">
				<div class="rec"><div class="rec-m"><div class="rec-s">{p.note}</div></div></div>
			</div>
		</div>
	{/if}
	<p class="aside">
		A payment is not changed once it is recorded. A correction goes on the next payment, plus or
		minus, with why.
	</p>
</div>

<style>
	.aside {
		margin: 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
