<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { resolve } from '$app/paths';
	import { day, dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { sum } from '#lib/decimal.ts';
	import { PAID_AS_ORDER, PAID_AS_WORDS } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';
	/**
	 * A payment, as recorded, which stands: a box for each part of it -- wages,
	 * fees, a reimbursement -- its items and what the part came to, then when
	 * it was paid, how, by whom it was recorded, and its note.
	 */
	let { data }: PageProps = $props();
	const p = $derived(data.payment);
	const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
	// The payment by what each part paid (0027), in the order they are reported.
	const parts = $derived(
		PAID_AS_ORDER.map((as) => ({ as, items: p.items.filter((i) => i.paid_as === as) }))
			.filter((x) => x.items.length)
			.map((x) => {
				const work = x.items.filter((i) => !i.corrects_id).length;
				const role = PAID_AS_WORDS[x.as].role;
				return {
					...x,
					total: sum(x.items.map((i) => i.amount)).toString(),
					// "for 4 items, as a Partner", "for 1 trip", "a correction"
					said: work
						? x.as === 'reimbursement'
							? `for ${work} ${work === 1 ? 'trip' : 'trips'}`
							: `for ${work} ${work === 1 ? 'item' : 'items'}${role ? `, as ${an(role)}` : ''}`
						: 'a correction'
				};
			})
	);
</script>

<Top
	title="Paid {p.person}"
	sub="{dated(p.paid_on)} · {p.how.toLowerCase()}"
	back={resolve('/reports/pay/[person]/paid', { person: p.user_id })}
	backLabel={p.person.split(' ')[0]}
/>

<div class="pad">
	{#each parts as x (x.as)}
		<section class="box" aria-labelledby="part-{x.as}">
			<div class="box-h">
				<h2 class="box-t" id="part-{x.as}">
					{x.as === 'reimbursement' ? 'For the vehicle' : PAID_AS_WORDS[x.as].heading}
				</h2>
				<span class="sub">{x.said}</span>
			</div>
			{#each x.items as i (i.id)}
				<div class="box-row line">
					<span class="what">
						{#if i.corrects_id}
							<span class="n">A correction to {dated(i.corrects)}</span>
						{:else}
							<span class="n">{i.place ?? 'Work'} · {day(i.day)}</span>
						{/if}
						<span class="sub">{i.said}</span>
					</span>
					{#if i.corrects_id}<span class="lab acc">Correction</span>{/if}
					<span class="v">{money(i.amount)}</span>
				</div>
			{/each}
			<div class="box-row line tot">
				<span class="what"
					><span class="n"
						>{x.as === 'reimbursement' ? 'Reimbursed' : PAID_AS_WORDS[x.as].heading}</span
					></span
				>
				<span class="v">{money(x.total)}</span>
			</div>
		</section>
	{/each}

	<section class="box" aria-labelledby="paid-h">
		<div class="box-h"><h2 class="box-t" id="paid-h">Payment</h2></div>
		<div class="box-row kv">
			<span class="kv-l">Paid</span>
			<span class="kv-v"><span class="paid">{money(p.total)}</span></span>
		</div>
		<div class="box-row kv">
			<span class="kv-l">Recorded</span>
			<span class="kv-v"><span>{day(p.recorded_on)} by {p.recorded_by}</span></span>
		</div>
		{#if p.note}
			<div class="box-row kv">
				<span class="kv-l">Note</span>
				<span class="kv-v"><span>{p.note}</span></span>
			</div>
		{/if}
	</section>

	<p class="note">
		A payment is not changed once it is recorded. A correction goes on the next payment, plus or
		minus, with why, against the part it corrects.
	</p>
</div>

<style>
	.line {
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
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.lab {
		flex: 0 0 auto;
	}
	.v {
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: 600;
		color: var(--fgColor-default);
	}
	.tot {
		background: var(--bgColor-muted);
	}
	.paid {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
		color: var(--fgColor-default);
	}
</style>
