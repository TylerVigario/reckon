<script lang="ts">
	import { hours } from '#lib/format.ts';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { catalogueTabs } from '#lib/section-tabs.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Agreements: what clients pay for by the period, as Primer boxes --
	 * running, then ended -- with a row each: the client and site, what it
	 * covers and how much of it this month has used, and what it charges. What
	 * all the running ones bring in a month heads the first. New agreement is
	 * the screen's action.
	 */
	let { data }: PageProps = $props();

	const hrs = (v: string | null | undefined) => hours(v, 'allotted');
	const PERIOD: Record<string, string> = {
		weekly: 'week',
		monthly: 'month',
		quarterly: 'quarter',
		annually: 'year'
	};
	const per = (i: string) => `a ${PERIOD[i] ?? 'period'}`;
</script>

<Top title="Catalogue" sub="What can go on a line" back={resolve('/more')} backLabel="More">
	{#snippet actions()}
		<a class="btn sm pri" href={resolve('/catalogue/agreements/new')}>New agreement</a>
	{/snippet}
</Top>

<div class="pad primer">
	<UnderlineNav label="Catalogue" items={catalogueTabs('agreements')} />

	{#each [{ key: 'running', head: 'Running', list: data.live }, { key: 'ended', head: 'Ended', list: data.ended }] as group (group.key)}
		{#if group.list.length || group.key === 'running'}
			<section class="box" aria-labelledby="{group.key}-h">
				<div class="box-h">
					<h2 class="box-t" id="{group.key}-h">{group.head}</h2>
					{#if group.key === 'running' && group.list.length}
						<span class="sub"><span class="v">{money(data.recurring)}</span> a month</span>
					{:else}
						<span class="count">{group.list.length}</span>
					{/if}
				</div>
				{#each group.list as a (a.id)}
					<a class="box-row line" href={resolve('/catalogue/agreements/[id]', { id: a.id })}>
						<span class="what">
							<span class="n">{a.who} · {a.site ?? 'the whole client'}</span>
							{#each a.covers as c (c.service)}
								<span class="sub">
									{c.service} · {hrs(c.used)} used this month of {c.allotment === 'unlimited'
										? 'unlimited'
										: hrs(c.hours)}
								</span>
							{:else}
								<span class="sub">Covers no service yet: everything is billed</span>
							{/each}
						</span>
						{#if !a.ended && a.now.state === 'given'}
							<span class="lab good">This {PERIOD[a.interval] ?? 'period'} given freely</span>
						{:else if !a.ended && a.now.state === 'uncharged'}
							<span class="lab">Not charged yet this {PERIOD[a.interval] ?? 'period'}</span>
						{/if}
						<span class="end-fig">
							<span class="v">{money(a.price)}</span>
							<span class="sub">{per(a.interval)}</span>
						</span>
					</a>
				{:else}
					<p class="box-row muted">No agreements yet. New agreement adds the first.</p>
				{/each}
			</section>
		{/if}
	{/each}
</div>

<style>
	.box-row {
		margin: 0;
	}
	.line {
		min-height: 64px;
		box-sizing: border-box;
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
		color: var(--ink-3);
	}
	.lab {
		flex: 0 0 auto;
	}
	.end-fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
		color: var(--ink);
	}
</style>
