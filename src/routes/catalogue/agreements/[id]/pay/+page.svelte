<script lang="ts">
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { paysWhat } from '#lib/pay-words.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * An agreement's Pay tab: who is paid differently for this client, rule by
	 * rule, each opening its service's Pay tab, where it is changed.
	 */
	let { data }: PageProps = $props();
	const FOR: Record<string, string> = {
		time: 'for their time',
		covered_time: 'for covered time',
		vehicle: 'for their vehicle'
	};
	const pays = (r: { pays_for: string; method: string; amount: string | null }) => {
		const w = paysWhat(r, { money, unitPrice });
		return w.x ? `${w.v} ${w.x}` : w.v;
	};
</script>

<section class="box" aria-labelledby="pay-h">
	<div class="box-h">
		<h2 class="box-t" id="pay-h">Paid differently for {data.agreement.client}</h2>
	</div>
	{#each data.rules as r (r.id)}
		<a class="box-row line" href={resolve('/catalogue/services/[id]/pay', { id: r.service_id })}>
			<span class="what">
				<span class="n">{r.payee} · {FOR[r.pays_for]}</span>
				<span class="sub">{r.service} · {pays(r)}</span>
			</span>
		</a>
	{:else}
		<p class="box-row muted">Every service pays here as it does for any client.</p>
	{/each}
</section>

<style>
	.box-row {
		margin: 0;
	}
	.line {
		min-height: 56px;
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
</style>
