<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { dated } from '#lib/format.ts';
	import { PAYS_FOR, paysWhat } from '#lib/pay-words.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Every price and pay rule a service has had, as Primer boxes: scheduled,
	 * in force, or superseded, each with the days it covered.
	 */
	let { data }: PageProps = $props();

	const per = (u: string) => (u === 'mile' ? 'a mile' : u === 'hour' ? 'an hour' : 'each');
	const STATE = {
		scheduled: { label: 'Scheduled', tone: 'acc' },
		current: { label: 'In force', tone: 'good' },
		superseded: { label: 'Superseded', tone: '' }
	} as const;

	/** The period a row was, is, or will be in force. */
	const span = (r: { state: string; effective_from: string; until: string | null }) =>
		r.state === 'scheduled'
			? `Takes over ${dated(r.effective_from)}`
			: r.state === 'current'
				? `Since ${dated(r.effective_from)}`
				: `${dated(r.effective_from)} – ${r.until ? dated(r.until) : 'now'}`;
</script>

<Top
	title="History"
	sub="Every price and pay rule {data.service.name} has had"
	trail={[
		{ href: resolve('/catalogue/services'), label: 'Services' },
		{ href: resolve('/catalogue/services/[id]', { id: data.service.id }), label: data.service.name }
	]}
/>

<div class="pad primer">
	<section class="box" aria-labelledby="paid-h">
		<div class="box-h">
			<h2 class="box-t" id="paid-h">What the client paid</h2>
			<span class="count">{data.prices.length}</span>
		</div>
		{#each data.prices as p (p.id)}
			{@const st = STATE[p.state]}
			<div class="box-row line" class:past={p.state === 'superseded'}>
				<span class="what">
					<span class="n">{p.client ?? 'Every client'}</span>
					<span class="sub">
						{span(p)}{Number(p.additional_rate) > 0
							? ` · +${unitPrice(p.additional_rate)} for each additional person`
							: ''}
					</span>
				</span>
				{#if st}<span class="lab {st.tone}">{st.label}</span>{/if}
				<span class="end-fig">
					<span class="v">{unitPrice(p.rate)}</span>
					<span class="sub">{per(data.service.unit)}</span>
				</span>
			</div>
		{:else}
			<p class="box-row muted">Never priced.</p>
		{/each}
	</section>

	<section class="box" aria-labelledby="rules-h">
		<div class="box-h">
			<h2 class="box-t" id="rules-h">Who was paid, and how</h2>
			<span class="count">{data.rules.length}</span>
		</div>
		{#each data.rules as r (r.id)}
			{@const w = paysWhat(r, { money, unitPrice })}
			{@const st = STATE[r.state]}
			<div class="box-row line" class:past={r.state === 'superseded'}>
				<span class="what">
					<span class="n">{r.payee} · {PAYS_FOR[r.pays_for]}</span>
					<span class="sub">{r.client ?? 'Every client'} · {span(r)}</span>
				</span>
				{#if st}<span class="lab {st.tone}">{st.label}</span>{/if}
				<span class="end-fig">
					<span class="v" class:muted={r.method === 'nothing'}>{w.v}</span>
					{#if w.x}<span class="sub">{w.x}</span>{/if}
				</span>
			</div>
		{:else}
			<p class="box-row muted">No pay rule, ever.</p>
		{/each}
	</section>

	<p class="note">
		A superseded row still counts. Work is priced and paid by the rows in force on the day it was
		done, so a line from before a change keeps the figure it was worth then.
	</p>
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
	.line.past .n,
	.line.past .v {
		color: var(--ink-3);
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
	.end-fig {
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
