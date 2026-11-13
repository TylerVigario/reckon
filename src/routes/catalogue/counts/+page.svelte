<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * Every count, as a Primer box with a row each: the open one first, then
	 * newest -- the day, who, how many were counted and put right, and what
	 * that came to, written off or found.
	 */
	let { data }: PageProps = $props();
</script>

<Top
	title="Counts"
	sub="What was on the shelf"
	back={resolve('/catalogue/materials')}
	backLabel="Materials"
/>

<div class="pad primer">
	<section class="box" aria-labelledby="counts-h">
		<div class="box-h">
			<h2 class="box-t" id="counts-h">Counts</h2>
			<span class="count">{data.counts.length}</span>
		</div>
		{#each data.counts as c (c.id)}
			<a class="box-row line" href={resolve('/catalogue/counts/[id]', { id: c.id })}>
				<span class="what">
					<span class="n">{dated(c.counted_on)}</span>
					<span class="sub">
						{c.open
							? `Started by ${c.by} · ${c.counted} counted so far`
							: `Applied by ${c.applied_by} · ${c.counted} counted · ${c.differences} put right`}
					</span>
				</span>
				{#if c.open}
					<span class="lab acc">Open</span>
				{:else}
					<span class="v" class:off={Number(c.net) < 0}>{money(c.net)}</span>
				{/if}
			</a>
		{:else}
			<p class="box-row muted">Never counted. Count, on Materials, starts one.</p>
		{/each}
	</section>
</div>

<style>
	.box-row {
		margin: 0;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		box-sizing: border-box;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
	}
	.v.off {
		color: var(--crit);
	}
</style>
