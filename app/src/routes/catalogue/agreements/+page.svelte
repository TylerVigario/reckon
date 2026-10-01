<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hrs = (v: string | null | undefined) => (v ? `${Number(v).toFixed(2)} h` : '—');
	const PERIOD: Record<string, string> = {
		weekly: 'week',
		monthly: 'month',
		quarterly: 'quarter',
		annually: 'year'
	};
	const per = (i: string) =>
		i === 'monthly' ? '/mo' : i === 'annually' ? '/yr' : i === 'quarterly' ? '/qtr' : '/wk';
</script>

<Top
	title="Agreements"
	sub="{money(data.recurring)} a month"
	back={resolve('/catalogue')}
	backLabel="Catalogue"
>
	{#snippet actions()}
		<a class="btn sm pri" href={resolve('/catalogue/agreements/new')}>New agreement</a>
	{/snippet}
</Top>

<div class="pad">
	{#each [{ head: '', list: data.live }, { head: 'Ended', list: data.ended }] as group (group.head)}
		{#if group.list.length}
			<div class="sec">
				{#if group.head}<div class="sec-h"><h2>{group.head}</h2></div>{/if}
				<div class="rows">
					{#each group.list as a (a.id)}
						<a
							class="rec link"
							class:gone={a.ended}
							href={resolve('/catalogue/agreements/[id]', { id: a.id })}
						>
							<div class="rec-m">
								<div class="rec-t">
									{a.who}&nbsp;<span class="lt">· {a.site ?? 'the whole client'}</span>
								</div>
								{#each a.covers as c (c.service)}
									<div class="rec-s">
										{c.service} · {hrs(c.used)} used this month of {c.allotment === 'unlimited'
											? 'unlimited'
											: hrs(c.hours)}
									</div>
								{:else}
									<div class="rec-s">Covers no service yet — everything is billed</div>
								{/each}
								{#if !a.ended}
									<div class="rec-c">
										{#if a.now.state === 'given'}
											<span class="chip good"
												>this {PERIOD[a.interval] ?? 'period'} given freely</span
											>
										{:else if a.now.state === 'uncharged'}
											<span class="chip">this {PERIOD[a.interval] ?? 'period'} not charged yet</span
											>
										{/if}
									</div>
								{/if}
							</div>
							<div class="rec-n">
								<span class="rec-v">{money(a.price)}</span>
								<span class="rec-x">{per(a.interval)}</span>
							</div>
							<span class="arw" aria-hidden="true">›</span>
						</a>
					{/each}
					{#if !group.head}
						<div class="rec tot">
							<div class="rec-m"><div class="rec-t">Recurring revenue</div></div>
							<div class="rec-n">
								<span class="rec-v">{money(data.recurring)}</span><span class="rec-x">/mo</span>
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{/each}

	{#if data.live.length === 0 && data.ended.length === 0}
		<p class="none">No agreements yet.</p>
	{/if}
</div>
