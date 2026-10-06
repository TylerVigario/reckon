<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { dated, quantity } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const m = $derived(data.material);
</script>

<Top
	title={m.name}
	sub={[m.brand, m.sku].filter(Boolean).join(' · ') || `Counted in ${m.unit}`}
	back={resolve('/catalogue/materials')}
	backLabel="Materials"
>
	{#snippet actions()}
		<a class="btn sm pri" href={`${resolve('/catalogue/materials/receive')}?material=${m.id}`}
			>Receive stock</a
		>
	{/snippet}
</Top>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>Received</h2></div>
		<div class="rows">
			{#each data.lots as l (l.id)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">
							{dated(l.received_on)}{#if l.supplier}<span class="lt"> · {l.supplier}</span>{/if}
						</div>
						<div class="rec-s">
							{quantity(l.qty_received)}
							{m.unit} for {money(l.ex_tax_cost)}, and {money(l.tax_paid)} tax · paid by {l.paid_by ??
								'the business'}
						</div>
						{#if l.receipt}
							<div class="rec-s">
								<a
									href={resolve('/catalogue/materials/[id]/lots/[lot]/receipt', {
										id: m.id,
										lot: l.id
									})}>The receipt</a
								>
							</div>
						{/if}
					</div>
					<div class="rec-n">
						<span class="rec-v">{quantity(l.qty_remaining)}</span>
						<span class="rec-x">{m.unit} left</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing received yet</span></div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
