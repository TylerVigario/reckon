<script lang="ts">
	import { resolve } from '$app/paths';
	import { dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { PAID_AS_WORDS, type PaidAs } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';

	/**
	 * Paid, the second of someone's pay tabs (+layout): every payment made to
	 * them, newest first, each opening what it paid. One more every pay period,
	 * so it has a tab of its own rather than the foot of what is owed.
	 */
	let { data }: PageProps = $props();

	// "$56.00 wages, $22.57 reimbursed"
	const partsSaid = (ps: { paid_as: PaidAs; total: string }[]) =>
		ps.map((x) => `${money(x.total)} ${PAID_AS_WORDS[x.paid_as].money}`).join(', ');
</script>

<section class="box" aria-label="Payments">
	{#each data.payments as p (p.id)}
		<a class="box-row line" href={resolve('/reports/pay/payments/[id]', { id: p.id })}>
			<span class="what">
				<span class="n">{dated(p.paid_on)}</span>
				<span class="sub">
					{[p.how, partsSaid(p.parts), `${p.items} ${p.items === 1 ? 'item' : 'items'}`, p.note]
						.filter(Boolean)
						.join(' · ')}
				</span>
			</span>
			<span class="v">{money(p.total)}</span>
		</a>
	{:else}
		<p class="box-row muted">
			{data.user?.access === 'field'
				? 'Nothing paid yet. A payment to you shows here once someone with Full records it.'
				: 'Nothing paid yet. A payment shows here once it is recorded on Owed.'}
		</p>
	{/each}
</section>

<style>
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
		color: var(--fgColor-muted);
	}
	.v {
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
</style>
