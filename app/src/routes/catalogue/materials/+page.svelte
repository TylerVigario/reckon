<script lang="ts">
	import { fixed, percent, quantity } from '#lib/format.ts';
	import Top from '#lib/Top.svelte';
	import { unitPrice } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
</script>

<Top
	title="Materials"
	sub="Cost and tax stored apart"
	back={resolve('/catalogue')}
	backLabel="Catalogue"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h">
			<h2>Stock on hand</h2>
			<span class="sp"></span>
			{#if data.markup}
				<span class="chip">{percent(data.markup)} markup on the ex-tax cost</span>
			{/if}
		</div>
		<div class="rows">
			{#each data.materials as m (m.id)}
				{@const out = Number(m.on_hand) <= 0}
				<div class="rec" class:warn={out}>
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
							{quantity(m.on_hand)}{m.unit === 'foot' ? ' ft' : ''}
						</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m"><div class="rec-t"><span class="lt">Nothing stocked</span></div></div>
				</div>
			{/each}
		</div>
	</div>
</div>
