<script lang="ts">
	import { dated, quantity } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { sum } from '#lib/decimal.ts';
	import { REASON_WORDS } from '#lib/adjust-fields.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * A material's Adjustments tab: each time its stock was put right, by hand
	 * or by a count, newest first, as a Primer box with a row each -- the day,
	 * why, who, the note -- and how much went off or on, at what it was worth.
	 * A count's opens the count.
	 */
	let { data }: PageProps = $props();
	const m = $derived(data.material);
</script>

<section class="box" aria-labelledby="adj-h">
	<div class="box-h">
		<h2 class="box-t" id="adj-h">Put right</h2>
		<span class="count">{data.adjustments.length}</span>
	</div>
	{#snippet row(a: (typeof data.adjustments)[number])}
		<span class="what">
			<span class="n">{REASON_WORDS[a.reason]}</span>
			<span class="sub">{dated(a.made_on)} · {a.by}{a.note ? ` · ${a.note}` : ''}</span>
		</span>
		<span class="fig">
			<span class="v" class:off={a.way === 'off'}
				>{a.way === 'off' ? '−' : '+'}{quantity(a.qty)} {m.unit}</span
			>
			<span class="sub">{money(sum([a.ex_tax_cost, a.tax_paid]).toString())}</span>
		</span>
	{/snippet}
	{#each data.adjustments as a (a.id)}
		{#if a.count_id}
			<a class="box-row line" href={resolve('/catalogue/counts/[id]', { id: a.count_id })}
				>{@render row(a)}</a
			>
		{:else}
			<div class="box-row line">{@render row(a)}</div>
		{/if}
	{:else}
		<p class="box-row muted">Never adjusted. Adjust takes some off the shelf or puts some on.</p>
	{/each}
</section>

<style>
	.box-row {
		margin: 0;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
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
	.v.off {
		color: var(--crit);
	}
</style>
