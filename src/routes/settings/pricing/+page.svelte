<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import { parseField } from '#lib/settings-fields.ts';
	import type { PageProps } from './$types';

	/**
	 * What things sell at over what they cost, and what stock drawn on a line
	 * cost, each changed in place (#lib/Detail). A material or a service with a
	 * markup or a price of its own keeps it.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.operator);
	const again = () => refreshAll();
	// "25.00" reads as 25.
	const tidy = (v: unknown, or: string) => {
		if (v === null || v === undefined || v === '') return or;
		if (typeof v !== 'string' && typeof v !== 'number') return or;
		return String(v).replace(/\.?0+$/, '') || '0';
	};
	const markup = $derived(tidy(o?.default_markup_pct, '25'));
	const purchases = $derived(tidy(o?.purchase_markup_pct, '0'));
</script>

<Top
	title="Pricing"
	sub="What things sell at, and what stock cost"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<section class="box" aria-labelledby="markup-h">
		<div class="box-h"><h2 class="box-t" id="markup-h">Markup</h2></div>
		<Detail
			name="default_markup_pct"
			label="Default"
			value={markup}
			shown="{markup}% over what it cost"
			inputmode="decimal"
			endpoint="/api/settings"
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}A percentage. Every sellable item without its own sells at it.{/snippet}
		</Detail>
		<Detail
			name="purchase_markup_pct"
			label="On job purchases"
			value={purchases}
			shown={purchases === '0'
				? 'None: passed on as they cost'
				: `${purchases}% over what they cost`}
			inputmode="decimal"
			endpoint="/api/settings"
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}A percentage, on goods bought for a job and passed on. 0 passes them on as
				they cost.{/snippet}
		</Detail>
	</section>

	<section class="box" aria-labelledby="stock-h">
		<div class="box-h"><h2 class="box-t" id="stock-h">Stock</h2></div>
		<Detail
			name="stock_costing"
			label="Costed at"
			value={o?.stock_costing ?? 'average'}
			options={[
				{ value: 'average', label: 'The average of what is on the shelf' },
				{ value: 'oldest_first', label: 'The oldest first' }
			]}
			endpoint="/api/settings"
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}What a line drawn from stock cost. A change applies to what is drawn after
				it.{/snippet}
		</Detail>
	</section>
</div>
