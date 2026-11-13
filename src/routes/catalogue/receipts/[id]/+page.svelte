<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { dated, quantity } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { sum } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * A receipt or invoice, as Primer boxes: what was on it -- each item opening
	 * its material, with how much came in, what it cost, its share of the tax
	 * and how much is left -- then what it came to altogether, to set beside
	 * the paper, which is linked under it.
	 */
	let { data }: PageProps = $props();
	const r = $derived(data.receipt);
	const goods = $derived(sum(data.items.map((i) => i.ex_tax_cost)));
	const sub = $derived(
		[dated(r.received_on), r.reference, `paid by ${r.paid_by ?? 'the business'}`]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<Top
	title={r.supplier ?? 'A receipt'}
	{sub}
	back={resolve('/catalogue/receipts')}
	backLabel="Receipts"
/>

<div class="pad primer">
	<section class="box" aria-labelledby="items-h">
		<div class="box-h">
			<h2 class="box-t" id="items-h">What was on it</h2>
			<span class="count">{data.items.length}</span>
		</div>
		{#each data.items as i (i.id)}
			<a class="box-row line" href={resolve('/catalogue/materials/[id]', { id: i.material_id })}>
				<span class="what">
					<span class="n">{i.material}</span>
					<span class="sub">
						{quantity(i.qty_received)}
						{i.unit} for {money(i.ex_tax_cost)}, and {money(i.tax_paid)} tax
					</span>
				</span>
				<span class="fig">
					<span class="v">{quantity(i.qty_remaining)}</span>
					<span class="sub">{i.unit} left</span>
				</span>
			</a>
		{/each}
	</section>

	<section class="box" aria-labelledby="total-h">
		<div class="box-h"><h2 class="box-t" id="total-h">Altogether</h2></div>
		<div class="box-row kv">
			<span>Items, before tax</span><span class="v">{money(goods.toFixed(currencyPlaces()))}</span>
		</div>
		<div class="box-row kv"><span>Tax</span><span class="v">{money(r.tax_paid)}</span></div>
		<div class="box-row kv all">
			<span>Total</span><span class="v"
				>{money(goods.add(r.tax_paid).toFixed(currencyPlaces()))}</span
			>
		</div>
	</section>

	<p class="note">
		{#if r.has_file}
			<a href={resolve('/catalogue/receipts/[id]/file', { id: r.id })}
				>The {r.file_type === 'application/pdf'
					? 'invoice, as a PDF'
					: 'receipt, as photographed'}</a
			>. Its tax is split over what was on it by what each cost.
		{:else}
			No photo or file of it was kept. Its tax is split over what was on it by what each cost.
		{/if}
	</p>
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
	.kv {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.kv.all {
		font-weight: 600;
	}
</style>
