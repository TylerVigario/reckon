<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { catalogueTabs } from '#lib/section-tabs.ts';
	import { dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * Receipts: every receipt or invoice stock came in on, newest first, as one
	 * Primer box with a row each -- from whom and its number, the day, who paid,
	 * how many items -- opening the receipt. Receive stock is the screen's one
	 * action.
	 */
	let { data }: PageProps = $props();
</script>

<Top title="Catalogue" sub="What can go on a line" back={resolve('/more')} backLabel="More">
	{#snippet actions()}
		<a class="btn sm pri" href={resolve('/catalogue/receipts/new')}>Receive stock</a>
	{/snippet}
</Top>

<div class="pad primer">
	<UnderlineNav label="Catalogue" items={catalogueTabs('receipts')} />

	<section class="box" aria-labelledby="receipts-h">
		<div class="box-h">
			<h2 class="box-t" id="receipts-h">Received</h2>
			<span class="count">{data.receipts.length}</span>
		</div>
		{#each data.receipts as r (r.id)}
			<a class="box-row line" href={resolve('/catalogue/receipts/[id]', { id: r.id })}>
				<span class="what">
					<span class="n"
						>{[r.supplier ?? 'A receipt', r.reference].filter(Boolean).join(' · ')}</span
					>
					<span class="sub">
						{dated(r.received_on)} · {r.items}
						{r.items === 1 ? 'item' : 'items'} · paid by {r.paid_by ?? 'the business'}
					</span>
				</span>
				<span class="v">{money(r.total)}</span>
			</a>
		{:else}
			<p class="box-row muted">Nothing received yet. Receive stock adds the first.</p>
		{/each}
	</section>
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
	.v {
		flex: 0 0 auto;
		font-family: var(--f-mono);
		font-weight: 600;
	}
</style>
