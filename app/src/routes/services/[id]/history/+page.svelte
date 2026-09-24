<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { dated } from '$lib/format';
	import { PAYS_FOR, paysWhat } from '$lib/pay-words';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const per = (u: string) => (u === 'mile' ? '/mi' : u === 'hour' ? '/hr' : ' each');

	/** The period a row was, is, or will be in force. */
	const span = (r: { state: string; effective_from: string; until: string | null }) =>
		r.state === 'scheduled'
			? `Takes over ${dated(r.effective_from)}`
			: r.state === 'current'
				? `Since ${dated(r.effective_from)} · in force`
				: `${dated(r.effective_from)} – ${r.until ? dated(r.until) : 'now'}`;
</script>

<Top
	title="History"
	sub="Every price and pay rule {data.service.name} has had"
	trail={[
		{ href: resolve('/services'), label: 'Services' },
		{ href: resolve('/services/[id]', { id: data.service.id }), label: data.service.name }
	]}
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>What the client paid</h2></div>
		<div class="rows">
			{#each data.prices as p (p.id)}
				<div class="rec" class:gone={p.state === 'superseded'} class:acc={p.state === 'scheduled'}>
					<div class="rec-m">
						<div class="rec-t">{p.client ?? 'Every client'}</div>
						<div class="rec-s">
							{span(p)}{Number(p.additional_rate) > 0
								? ` · +${money(p.additional_rate)} for each additional person`
								: ''}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{money(p.rate)}</span>
						<span class="rec-x">{per(data.service.unit)}</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m"><div class="rec-t"><span class="lt">Never priced</span></div></div>
				</div>
			{/each}
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Who was paid, and how</h2></div>
		<div class="rows">
			{#each data.rules as r (r.id)}
				{@const w = paysWhat(r, money)}
				<div class="rec" class:gone={r.state === 'superseded'} class:acc={r.state === 'scheduled'}>
					<div class="rec-m">
						<div class="rec-t">{r.payee}&nbsp;<span class="lt">· {PAYS_FOR[r.pays_for]}</span></div>
						<div class="rec-s">{r.client ?? 'Every client'} · {span(r)}</div>
					</div>
					<div class="rec-n">
						<span class="rec-v" class:mut={r.method === 'nothing'}>{w.v}</span>
						{#if w.x}<span class="rec-x">{w.x}</span>{/if}
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">No pay rule, ever</span></div>
					</div>
				</div>
			{/each}
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t"><span class="lt">A superseded row still counts</span></div>
					<div class="rec-s">
						Work is priced and paid by the rows in force on the day it was done, so a line from
						before a change keeps the figure it was worth then.
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
