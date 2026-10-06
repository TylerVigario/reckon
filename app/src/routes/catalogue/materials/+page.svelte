<script lang="ts">
	import { fixed, percent, quantity } from '#lib/format.ts';
	import Top from '#lib/Top.svelte';
	import { unitPrice } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	// The cost a markup is on: the shelf's average, or the oldest lot's (#lib/stock-draw).
	const basis = $derived(data.costing === 'average' ? 'average' : 'oldest');
</script>

<Top
	title="Materials"
	sub="Cost and tax stored apart"
	back={resolve('/catalogue')}
	backLabel="Catalogue"
>
	{#snippet actions()}
		<a class="btn sm pri" href={resolve('/catalogue/materials/receive')}>Receive stock</a>
	{/snippet}
</Top>

<div class="pad">
	<div class="sec">
		<div class="sec-h">
			<h2>Stock on hand</h2>
			<span class="sp"></span>
			{#if data.markup}
				<span class="chip">{percent(data.markup)} markup on the {basis} ex-tax cost</span>
			{/if}
		</div>
		<div class="rows">
			{#each data.materials as m (m.id)}
				{@const out = Number(m.on_hand) <= 0}
				<a
					class="rec link"
					class:warn={out}
					href={resolve('/catalogue/materials/[id]', { id: m.id })}
				>
					<div class="rec-m">
						<div class="rec-t">{m.name}</div>
						<div class="rec-s">
							{[m.brand, m.sku].filter(Boolean).join(' · ')}
							{#if m.ex_tax}
								<br />ex-tax {fixed(m.ex_tax, 4)} · tax paid {fixed(m.tax_paid, 4)}
							{/if}
						</div>
						{#if out}
							<div class="rec-c">
								<span class="chip warn"><span class="dot"></span>Out of stock</span>
							</div>
						{/if}
					</div>
					<div class="rec-n">
						<span class="rec-v">{unitPrice(m.price)}</span>
						<span class="rec-x">
							{quantity(m.on_hand)}
							{m.unit}
						</span>
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{:else}
				<div class="rec">
					<div class="rec-m"><div class="rec-t"><span class="lt">Nothing stocked</span></div></div>
				</div>
			{/each}
		</div>
	</div>
</div>
