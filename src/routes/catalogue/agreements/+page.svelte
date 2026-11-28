<script lang="ts">
	import { allotted } from '#lib/format.ts';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { catalogueTabs } from '#lib/section-tabs.ts';
	import { money } from '#lib/money.svelte.ts';
	import { PERIOD_WORD } from '#lib/agreement-periods.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Agreements: what clients pay for by the period, as Primer boxes --
	 * running, then ended -- with a row each: the client and site, what it
	 * covers and how much of it its period under way has used, and what it
	 * charges. What the running ones charge, a total for each interval, heads
	 * the first. New agreement is the screen's action.
	 */
	let { data }: PageProps = $props();
</script>

<Top title="Catalogue" sub="What can go on a line" back={resolve('/more')} backLabel="More">
	{#snippet actions()}
		<a class="btn sm pri" href={resolve('/catalogue/agreements/new')}>New agreement</a>
	{/snippet}
</Top>

<div class="pad">
	<UnderlineNav label="Catalogue" items={catalogueTabs('agreements')} />

	{#each [{ key: 'running', head: 'Running', list: data.live }, { key: 'ended', head: 'Ended', list: data.ended }] as group (group.key)}
		{#if group.list.length || group.key === 'running'}
			<section class="box" aria-labelledby="{group.key}-h">
				<div class="box-h">
					<h2 class="box-t" id="{group.key}-h">{group.head}</h2>
					{#if group.key === 'running' && group.list.length}
						<span class="sub">
							{#each data.recurring as r, i (r.interval)}
								{i ? ' · ' : ''}<span class="v">{money(r.amount)}</span>
								a {PERIOD_WORD[r.interval]}
							{/each}
						</span>
					{:else}
						<span class="count">{group.list.length}</span>
					{/if}
				</div>
				{#each group.list as a (a.id)}
					<a class="box-row line" href={resolve('/catalogue/agreements/[id]', { id: a.id })}>
						<span class="what">
							<span class="n">{a.who} · {a.site ?? 'the whole client'}</span>
							{#each a.covers as c (c.service)}
								{@const of =
									c.allotment === 'unlimited' ? 'unlimited' : allotted(c.included, c.unit)}
								<span class="sub">
									{c.service} ·
									{c.used === null
										? `${of}${c.allotment === 'unlimited' ? '' : ` a ${PERIOD_WORD[a.interval]}`}`
										: `${allotted(c.used, c.unit)} used this ${PERIOD_WORD[a.interval]} of ${of}`}
								</span>
							{:else}
								<span class="sub">Covers no service yet: everything is billed</span>
							{/each}
						</span>
						{#if !a.ended && a.now.state === 'given'}
							<span class="lab good">This {PERIOD_WORD[a.interval]} given freely</span>
						{:else if !a.ended && a.now.state === 'uncharged'}
							<span class="lab">Not charged yet this {PERIOD_WORD[a.interval]}</span>
						{/if}
						<span class="end-fig">
							<span class="v">{money(a.price)}</span>
							<span class="sub">a {PERIOD_WORD[a.interval]}</span>
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
		color: var(--fgColor-muted);
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
		font-family: var(--fontStack-monospace);
		font-weight: 600;
		color: var(--fgColor-default);
	}
</style>
