<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { day } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const months = (d: number) => (d >= 60 ? `${Math.round(d / 30)} months` : `${d} days`);

	const who = $derived(data.operator?.short_name || 'you');
	const sub = $derived(`${money(data.totals.owed)} out · ${money(data.totals.drafted)} in draft`);
</script>

<Top title="Invoices" {sub}>
	{#snippet actions()}
		<span class="btn sm">New</span>
	{/snippet}
</Top>

<div class="pad">
	<div class="tiles">
		<div class="tile">
			<span class="k">Owed</span>
			<span class="v">{money(data.totals.owed)}</span>
			<span class="s">{data.out.length} out</span>
		</div>
		<div class="tile">
			<span class="k">Overdue</span>
			<span class="v sm" class:crit={data.totals.overdueCount > 0}>
				{money(data.totals.overdue)}
			</span>
			<span class="s">
				{data.totals.overdueCount}
				{data.totals.overdueCount === 1 ? 'invoice' : 'invoices'}
			</span>
		</div>
	</div>

	{#if data.drafts.length}
		<div class="sec">
			<div class="sec-h">
				<h2>Drafts</h2>
				<a class="seeall" href={resolve('/invoices/ready')}>All {data.drafts.length}</a>
			</div>
			<div class="rows">
				{#each data.drafts as i (i.id)}
					<a class="rec link" href={resolve('/invoices/[id]', { id: i.id })}>
						<div class="rec-m">
							<div class="rec-t">{i.number} · {i.who}</div>
							<div class="rec-s">{i.kinds ?? 'no lines yet'}</div>
							<div class="rec-c">
								<span class="chip warn"><span class="dot"></span>Not sent</span>
							</div>
						</div>
						<div class="rec-n"><span class="rec-v">{money(i.gross)}</span></div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.out.length}
		<div class="sec">
			<div class="sec-h"><h2>Out, unpaid</h2></div>
			<div class="rows">
				{#each data.out as i (i.id)}
					<a class="rec link" class:crit={i.overdue} href={resolve('/invoices/[id]', { id: i.id })}>
						<div class="rec-m">
							<div class="rec-t">{i.number} · {i.who}</div>
							<div class="rec-s">
								Sent {day(i.sent_on)}{#if i.terms}
									· Net {i.terms}{/if}
							</div>
							{#if i.overdue && i.days_out}
								<div class="rec-c">
									<span class="chip crit"><span class="dot"></span>{months(i.days_out)}</span>
								</div>
							{/if}
						</div>
						<div class="rec-n"><span class="rec-v">{money(i.gross)}</span></div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{/each}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Owed to {who}</div></div>
					<div class="rec-n"><span class="rec-v">{money(data.totals.owed)}</span></div>
				</div>
			</div>
		</div>
	{/if}

	{#if data.paid.length}
		<div class="sec">
			<div class="sec-h"><h2>Paid, recently</h2></div>
			<div class="rows">
				{#each data.paid as i (i.id)}
					<a class="rec link" href={resolve('/invoices/[id]', { id: i.id })}>
						<div class="rec-m">
							<div class="rec-t">{i.number} · {i.who}</div>
							<div class="rec-s">Paid {day(i.paid_on)}</div>
						</div>
						<div class="rec-n"><span class="rec-v mut">{money(i.gross)}</span></div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.drafts.length === 0 && data.out.length === 0 && data.paid.length === 0}
		<p class="none">No invoices yet.</p>
	{/if}
</div>
