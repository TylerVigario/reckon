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

<div class="sec">
	<div class="rows">
		{#each data.payments as p (p.id)}
			<a class="rec link" href={resolve('/reports/pay/payments/[id]', { id: p.id })}>
				<div class="rec-m">
					<div class="rec-t">{dated(p.paid_on)}</div>
					<div class="rec-s">
						{[p.how, partsSaid(p.parts), `${p.items} ${p.items === 1 ? 'item' : 'items'}`, p.note]
							.filter(Boolean)
							.join(' · ')}
					</div>
				</div>
				<div class="rec-n"><span class="rec-v">{money(p.total)}</span></div>
				<span class="arw" aria-hidden="true">›</span>
			</a>
		{:else}
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t"><span class="lt">Nothing paid yet</span></div>
					<div class="rec-s">
						{data.user?.access === 'field'
							? 'A payment to you shows here once someone with Full records it'
							: 'A payment shows here once it is recorded on Owed'}
					</div>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.lt {
		font-weight: 400;
		color: var(--ink-3);
	}
</style>
