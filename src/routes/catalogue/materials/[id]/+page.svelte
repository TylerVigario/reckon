<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { dated, quantity } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * One material, and every lot of it received, as a Primer box with a row
	 * each: when and from whom, how much for what, who paid, the receipt, and
	 * how much of it is left. Receive stock, into this one, is the screen's
	 * action.
	 */
	let { data }: PageProps = $props();
	const m = $derived(data.material);
</script>

<Top
	title={m.name}
	sub={[m.brand, m.sku, `Counted in ${m.unit}`].filter(Boolean).join(' · ')}
	back={resolve('/catalogue/materials')}
	backLabel="Materials"
>
	{#snippet actions()}
		<a class="btn sm pri" href={resolve(`/catalogue/materials/receive?material=${m.id}`)}
			>Receive stock</a
		>
	{/snippet}
</Top>

<div class="pad primer">
	<section class="box" aria-labelledby="lots-h">
		<div class="box-h">
			<h2 class="box-t" id="lots-h">Received</h2>
			<span class="count">{data.lots.length}</span>
		</div>
		{#each data.lots as l (l.id)}
			<div class="box-row lot">
				<span class="what">
					<span class="n">{dated(l.received_on)}{l.supplier ? ` · ${l.supplier}` : ''}</span>
					<span class="sub">
						{quantity(l.qty_received)}
						{m.unit} for {money(l.ex_tax_cost)}, and {money(l.tax_paid)} tax · paid by {l.paid_by ??
							'the business'}
					</span>
					{#if l.receipt}
						<a
							class="lk sub"
							href={resolve('/catalogue/materials/[id]/lots/[lot]/receipt', {
								id: m.id,
								lot: l.id
							})}>The receipt</a
						>
					{/if}
				</span>
				<span class="fig">
					<span class="v">{quantity(l.qty_remaining)}</span>
					<span class="sub">{m.unit} left</span>
				</span>
			</div>
		{:else}
			<p class="box-row muted">Nothing received yet.</p>
		{/each}
	</section>
</div>

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
	a.lk.sub {
		color: var(--accent);
		align-self: flex-start;
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
