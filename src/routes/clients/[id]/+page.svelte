<script lang="ts">
	import { dated, day } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { PERIOD_WORD } from '#lib/agreement-periods.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * A client's Overview, Full's alone (#lib/access): each agreement running
	 * for them, the client's own or a site's, with what its period under way
	 * has used of what it covers (#lib/agreement-periods); their latest invoices; and the credit they have to spend
	 * against the next -- each a box of its own.
	 */
	let { data }: PageProps = $props();
	const c = $derived(data.client);
</script>

<section class="box" aria-labelledby="ret-h">
	<div class="box-h">
		<h2 class="box-t" id="ret-h">Retainers</h2>
		<a class="btn sm" href="{resolve('/catalogue/agreements/new')}?client={c.slug}">New agreement</a
		>
	</div>
	{#each data.agreements as ag (ag.id)}
		<a class="box-row" href={resolve('/catalogue/agreements/[id]', { id: ag.id })}>
			<span class="what">
				<span class="n">{ag.site ?? 'The whole client'}</span>
				<span class="sub"
					>{!ag.covers
						? 'Covers no service yet'
						: ag.started
							? `This ${PERIOD_WORD[ag.interval]}: ${ag.covers}`
							: `From ${dated(ag.starts_on)}: ${ag.covers}`}</span
				>
			</span>
			{#if ag.given}<span class="lab good">Given freely this {PERIOD_WORD[ag.interval]}</span>{/if}
			<span class="fig">
				<span class="v">{money(ag.price)}</span>
				<span class="sub">a {PERIOD_WORD[ag.interval]}</span>
			</span>
		</a>
	{:else}
		<p class="box-row muted">No agreement is running.</p>
	{/each}
</section>

<section class="box" aria-labelledby="inv-h">
	<div class="box-h"><h2 class="box-t" id="inv-h">Latest invoices</h2></div>
	{#each data.recent as i (i.id)}
		<a class="box-row" href={resolve('/invoices/[id]', { id: i.id })}>
			<span class="what">
				<span class="n">{i.number}</span>
				<span class="sub">{i.status === 'draft' ? 'Draft, begun' : 'Sent'} {day(i.on)}</span>
			</span>
			<span class="fig"><span class="v">{money(i.gross)}</span></span>
		</a>
	{:else}
		<p class="box-row muted">Never invoiced.</p>
	{/each}
</section>

<section class="box" aria-labelledby="credit-h">
	<div class="box-h"><h2 class="box-t" id="credit-h">Credit</h2></div>
	<div class="box-row">
		<span class="what">
			<span class="n">Unapplied credit</span>
			<span class="sub">Theirs to spend against the next invoice</span>
		</span>
		<span class="fig"
			><span class="v" class:muted={Number(c.credit) === 0}>{money(c.credit)}</span></span
		>
	</div>
</section>

<style>
	.box-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
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
		color: var(--fgColor-muted);
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
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.lab {
		flex: 0 0 auto;
	}
</style>
