<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { resolve } from '$app/paths';
	import { day, dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { sum } from '#lib/decimal.ts';
	import { PAID_AS_ORDER, PAID_AS_WORDS } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';
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
	back={resolve('/reports/pay/[person]', { person: p.user_id })}
	backLabel={p.person.split(' ')[0]}
/>

<div class="pad">
	<div class="tiles">
		{#each parts as x, k (x.as)}
			<div class="tile">
				<span class="k"
					>{x.as === 'reimbursement' ? 'Reimbursed' : PAID_AS_WORDS[x.as].heading}</span
				>
				<span class="v" class:good={k === 0}>{money(x.total)}</span>
				<span class="s">{x.said}</span>
			</div>
		{/each}
	</div>

	{#each parts as x (x.as)}
		<div class="sec">
			<div class="sec-h">
				<h2>
					{#if x.as === 'reimbursement'}For the vehicle
						<span class="lt">· a reimbursement</span>{:else}{PAID_AS_WORDS[x.as].heading}{/if}
				</h2>
			</div>
			<div class="rows">
				{#each x.items as i (i.id)}
					<div class="rec" class:acc={i.corrects_id}>
						<div class="rec-m">
							{#if i.corrects_id}
								<div class="rec-t">A correction to {dated(i.corrects)}</div>
							{:else}
								<div class="rec-t">{i.place ?? 'Work'} · {day(i.day)}</div>
							{/if}
							<div class="rec-s">{i.said}</div>
						</div>
						<div class="rec-n"><span class="rec-v">{money(i.amount)}</span></div>
					</div>
				{/each}
				<div class="rec sub">
					<div class="rec-m">
						<div class="rec-t">
							{x.as === 'reimbursement' ? 'Reimbursed' : PAID_AS_WORDS[x.as].heading}
						</div>
					</div>
					<div class="rec-n"><span class="rec-v">{money(x.total)}</span></div>
				</div>
			</div>
		</div>
	{/each}

	<div class="rows">
		<div class="rec tot">
			<div class="rec-m">
				<div class="rec-t">Paid</div>
				<div class="rec-s">Recorded {day(p.recorded_on)} by {p.recorded_by}</div>
			</div>
			<div class="rec-n"><span class="rec-v">{money(p.total)}</span></div>
		</div>
	</div>

	{#if p.note}
		<div class="sec">
			<div class="sec-h"><h2>Note</h2></div>
			<div class="rows">
				<div class="rec"><div class="rec-m"><div class="rec-s">{p.note}</div></div></div>
			</div>
		</div>
	{/if}
	<p class="aside">
		A payment is not changed once it is recorded. A correction goes on the next payment, plus or
		minus, with why, against the part it corrects.
	</p>
</div>

<style>
	.sub .rec-t,
	.sub .rec-v {
		font-weight: 600;
	}
	.lt {
		font-weight: 400;
		color: var(--ink-3);
	}
	.sec + .rows {
		margin-top: 18px;
	}
	.aside {
		margin: 12px 0 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
