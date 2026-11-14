<script lang="ts">
	import { dated, quantity } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * A material's Stock tab: every lot of it, newest first, as a Primer box
	 * with a row each -- when and from whom, how much for what, who paid, and
	 * how much of it is left -- each opening the receipt it came on, or, for
	 * stock that was found, its Adjustments.
	 */
	let { data }: PageProps = $props();
	const m = $derived(data.material);
</script>

<section class="box" aria-labelledby="lots-h">
	<div class="box-h">
		<h2 class="box-t" id="lots-h">Received</h2>
		<span class="count">{data.lots.length}</span>
	</div>
	{#each data.lots as l (l.id)}
		<a
			class="box-row lot"
			href={l.receipt_id
				? resolve('/catalogue/receipts/[id]', { id: l.receipt_id })
				: resolve('/catalogue/materials/[id]/adjustments', { id: m.id })}
		>
			<span class="what">
				<span class="n"
					>{dated(l.received_on)}{l.receipt_id
						? `${l.supplier ? ` · ${l.supplier}` : ''}${l.reference ? ` · ${l.reference}` : ''}`
						: ' · found'}</span
				>
				<span class="sub">
					{quantity(l.qty_received)}
					{m.unit}{l.ex_tax_cost !== null
						? ` for ${money(l.ex_tax_cost)}, and ${money(l.tax_paid ?? '0')} tax${
								l.receipt_id ? ` · paid by ${l.paid_by ?? 'the business'}` : ''
							}`
						: ''}
				</span>
			</span>
			{#if !l.receipt_id}<span class="lab acc">Found</span>{/if}
			<span class="fig">
				<span class="v">{quantity(l.qty_remaining)}</span>
				<span class="sub">{m.unit} left</span>
			</span>
		</a>
	{:else}
		<p class="box-row muted">Nothing received yet.</p>
	{/each}
</section>

<style>
	.box-row {
		min-height: 64px;
		box-sizing: border-box;
		margin: 0;
	}
	.lot {
		display: flex;
		align-items: center;
		gap: 12px;
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
</style>
