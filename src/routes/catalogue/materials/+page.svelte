<script lang="ts">
	import { dated, percent, quantity } from '#lib/format.ts';
	import Octicon from '#lib/Octicon.svelte';
	import { readProblem } from '#lib/json.ts';
	import { goto } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { catalogueTabs } from '#lib/section-tabs.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Materials: what is on the shelf, as a Primer box with a row each -- what
	 * it is, what one costs and sells at, how much is left -- each row opening
	 * its own page, and those retired in a box of their own under it. Count
	 * and Receive stock are its actions; a count being counted says so, with
	 * how far it has got, and when stock was last counted is said under the
	 * list, with every count. The
	 * markup and costing every price here is worked out by are the business's,
	 * set on Business, and said under the list with a link there.
	 */
	let { data }: PageProps = $props();
	// The cost a markup is on: the shelf's average, or the oldest lot's (#lib/stock-draw).
	const basis = $derived(data.costing === 'average' ? 'average' : 'oldest');
	/** "a ft", but "each" for what is counted each. */
	const per = (unit: string) => (unit === 'each' ? 'each' : `a ${unit}`);
	const offered = $derived(data.materials.filter((m) => m.active));
	// Count opens the count being counted, or starts one.
	let starting = $state(false);
	let failed = $state('');
	async function count() {
		starting = true;
		failed = '';
		const r = await fetch('/api/counts', { method: 'POST' }).catch(() => null);
		starting = false;
		if (!r?.ok) {
			failed = r
				? ((await readProblem(r)).detail ?? 'It did not start.')
				: 'Not started — no connection.';
			return;
		}
		const { id } = (await r.json()) as { id: string };
		await goto(resolve('/catalogue/counts/[id]', { id }));
	}
	const retired = $derived(data.materials.filter((m) => !m.active));
</script>

{#snippet row(m: (typeof data.materials)[number])}
	{@const out = m.active && Number(m.on_hand) <= 0}
	<a class="box-row" href={resolve('/catalogue/materials/[id]', { id: m.id })}>
		<span class="what">
			<span class="n">{m.name}</span>
			{#if m.brand || m.sku}<span class="sub">{[m.brand, m.sku].filter(Boolean).join(' · ')}</span
				>{/if}
			{#if m.ex_tax}
				<span class="sub">
					Costs {unitPrice(m.ex_tax)}
					{per(m.unit)}, and {unitPrice(m.tax_paid)} tax
				</span>
			{/if}
		</span>
		{#if out}<span class="lab warn">Out of stock</span>{/if}
		<span class="fig">
			<span class="v">{unitPrice(m.price)}</span>
			<span class="sub">{quantity(m.on_hand)} {m.unit} left</span>
		</span>
	</a>
{/snippet}

<Top title="Catalogue" sub="What can go on a line" back={resolve('/more')} backLabel="More">
	{#snippet actions()}
		<button type="button" class="btn sm" onclick={count} disabled={starting}>Count</button>
		<a class="btn sm pri" href={resolve('/catalogue/receipts/new')}>Receive stock</a>
	{/snippet}
</Top>

<div class="pad primer">
	<UnderlineNav label="Catalogue" items={catalogueTabs('materials')} />

	{#if data.open}
		<div class="banner" role="status">
			<Octicon name="info" />
			<div class="banner-m">
				<p class="banner-t">A count is open</p>
				<p class="banner-d">
					{data.open.counted} counted so far.
					<a href={resolve('/catalogue/counts/[id]', { id: data.open.id })}>Carry on counting</a>
				</p>
			</div>
		</div>
	{/if}
	{#if failed}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{failed}</p></div>
		</div>
	{/if}

	<section class="box" aria-labelledby="stock-h">
		<div class="box-h">
			<h2 class="box-t" id="stock-h">Stock on hand</h2>
			<span class="count">{offered.length}</span>
		</div>
		{#each offered as m (m.id)}
			{@render row(m)}
		{:else}
			<p class="box-row muted">Nothing stocked yet. Receive stock adds the first.</p>
		{/each}
	</section>

	{#if retired.length}
		<section class="box" aria-labelledby="retired-h">
			<div class="box-h">
				<h2 class="box-t" id="retired-h">Retired</h2>
				<span class="count">{retired.length}</span>
			</div>
			{#each retired as m (m.id)}
				{@render row(m)}
			{/each}
		</section>
	{/if}

	<p class="note">
		{data.lastCounted ? `Last counted ${dated(data.lastCounted)}.` : 'Never counted.'}
		<a href={resolve('/catalogue/counts')}>Every count</a>
	</p>

	{#if data.markup}
		<p class="note">
			Each sells at {percent(data.markup)} over the {basis} cost before tax, unless it has a markup or
			a price of its own. The markup and how stock is costed are set on
			<a href={resolve('/settings/business')}>Business</a>.
		</p>
	{/if}
</div>

<style>
	.box-row {
		min-height: 64px;
		box-sizing: border-box;
		margin: 0;
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
	.fig {
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
	}
	.lab {
		flex: 0 0 auto;
	}
</style>
