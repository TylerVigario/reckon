<script lang="ts">
	import { span } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';

	/** An agreement's Charged tab: each period it has charged, newest first, or given freely. */
	let { data }: PageProps = $props();
</script>

<section class="box" aria-labelledby="charged-h">
	<div class="box-h">
		<h2 class="box-t" id="charged-h">What it has charged</h2>
		<span class="count">{data.periods.length}</span>
	</div>
	{#each data.periods as p (p.id)}
		<div class="box-row line">
			<span class="n">{span(p.period_start, p.period_end)}</span>
			{#if p.given}<span class="lab good">Given freely</span>{/if}
			<span class="v" class:muted={p.given}>{money(p.amount)}</span>
		</div>
	{:else}
		<p class="box-row muted">Nothing charged yet. Charging a period from here is not built yet.</p>
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
		min-height: 52px;
		box-sizing: border-box;
	}
	.n {
		flex: 1 1 auto;
		font-weight: 600;
	}
	.lab {
		flex: 0 0 auto;
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
	}
</style>
