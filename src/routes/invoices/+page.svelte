<script lang="ts">
	import { onMount } from 'svelte';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { draftsHeld, linesHeld, waitingCount, type QueuedDraft } from '#lib/queue.ts';
	import { count, day } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { opens } from '#lib/access.ts';

	let { data }: PageProps = $props();

	const months = (d: number) => (d >= 60 ? count(Math.round(d / 30), 'month') : count(d, 'day'));

	const who = $derived(data.operator?.short_name || 'you');
	// Someone with Field adds lines to drafts, and starts and sends none (#lib/access).
	const field = $derived(data.user?.access === 'field');
	// The copy kept for no signal is the drafts alone (#lib/offline-copy).
	const sub = $derived(
		field || !data.totals
			? `${data.drafts.length} ${data.drafts.length === 1 ? 'draft' : 'drafts'} to add to`
			: `${money(data.totals.owed)} out · ${money(data.totals.drafted)} in draft`
	);

	// What is on this phone, waiting to send: drafts started here, lines by the
	// draft they are for -- its id, or the uuid it was started with on a phone
	// -- and everything for the banner. The server cannot know them yet.
	let onPhone = $state<Record<string, number>>({});
	let started = $state<QueuedDraft[]>([]);
	let waiting = $state(0);
	onMount(() => {
		void Promise.all([linesHeld(), draftsHeld(), waitingCount()]).then(
			([lines, drafts, count]) => {
				const by: Record<string, number> = {};
				for (const q of lines) by[q.line.invoice_id] = (by[q.line.invoice_id] ?? 0) + 1;
				onPhone = by;
				started = drafts;
				waiting = count;
			},
			() => {}
		);
	});
	const lines = (i: { id: string; client_uuid: string | null }) =>
		(onPhone[i.id] ?? 0) + (i.client_uuid ? (onPhone[i.client_uuid] ?? 0) : 0);
</script>

<Top title="Invoices" {sub}>
	{#snippet actions()}
		{#if !field}<a class="btn sm" href={resolve('/invoices/new')}>New draft</a>{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if !field && data.totals && data.totals.overdueCount > 0}
		<div class="state">
			<span class="lab crit">
				{money(data.totals.overdue)} overdue on {data.totals.overdueCount}
				{data.totals.overdueCount === 1 ? 'invoice' : 'invoices'}
			</span>
		</div>
	{/if}

	{#if data.drafts.length || started.length}
		<section class="box" aria-labelledby="drafts-h">
			<div class="box-h">
				<h2 class="box-t" id="drafts-h">Drafts</h2>
				{#if opens(data.user?.access, '/invoices/ready')}
					<a class="lk" href={resolve('/invoices/ready')}>All {data.drafts.length}</a>
				{/if}
			</div>
			{#each started as q (q.draft.client_uuid)}
				<a
					class="box-row line"
					href={resolve(`/invoices/on-phone?draft=${encodeURIComponent(q.draft.client_uuid)}`)}
				>
					<span class="what">
						<span class="n">New draft · {q.draft.who}</span>
						<span class="sub" class:bad={q.refused}>
							{q.refused
								? `Refused: ${q.refused.detail}`
								: 'Takes its number when it reaches the server'}
						</span>
						<span class="labs">
							<span class="lab acc">On this phone</span>
							{#if onPhone[q.draft.client_uuid]}
								<span class="lab"
									>{onPhone[q.draft.client_uuid]}
									{onPhone[q.draft.client_uuid] === 1 ? 'line' : 'lines'}</span
								>
							{/if}
						</span>
					</span>
				</a>
			{/each}
			{#each data.drafts as i (i.id)}
				<a class="box-row line" href={resolve('/invoices/[id]', { id: i.id })}>
					<span class="what">
						<span class="n">{i.number} · {i.who}</span>
						<span class="sub">{i.kinds ?? 'no lines yet'}</span>
						{#if lines(i)}
							<span class="labs"><span class="lab acc">{lines(i)} on this phone</span></span>
						{/if}
					</span>
					{#if i.gross !== null}<span class="v">{money(i.gross)}</span>{/if}
				</a>
			{/each}
		</section>
	{/if}

	{#if data.out.length}
		<section class="box" aria-labelledby="out-h">
			<div class="box-h"><h2 class="box-t" id="out-h">Out, unpaid</h2></div>
			{#each data.out as i (i.id)}
				<a class="box-row line" href={resolve('/invoices/[id]', { id: i.id })}>
					<span class="what">
						<span class="n">{i.number} · {i.who}</span>
						<span class="sub">Sent {day(i.sent_on)}{i.terms ? ` · net ${i.terms}` : ''}</span>
						{#if i.overdue && i.days_out}
							<span class="labs"><span class="lab crit">Overdue · {months(i.days_out)}</span></span>
						{/if}
					</span>
					<span class="fig">
						<span class="v">{money(i.owed)}</span>
						{#if i.owed !== i.gross}<span class="sub">of {money(i.gross)}</span>{/if}
					</span>
				</a>
			{/each}
			<div class="box-row line tot">
				<span class="what"><span class="n">Owed to {who}</span></span>
				<span class="v">{money(data.totals?.owed)}</span>
			</div>
		</section>
	{/if}

	{#if data.paid.length}
		<section class="box" aria-labelledby="paid-h">
			<div class="box-h"><h2 class="box-t" id="paid-h">Paid, recently</h2></div>
			{#each data.paid as i (i.id)}
				<a class="box-row line" href={resolve('/invoices/[id]', { id: i.id })}>
					<span class="what">
						<span class="n">{i.number} · {i.who}</span>
						<span class="sub">Paid {day(i.paid_on)}</span>
					</span>
					<span class="v muted">{money(i.gross)}</span>
				</a>
			{/each}
		</section>
	{/if}

	{#if data.offline && !field}
		<p class="note">
			What has gone out or been paid, and what any of it comes to, needs a connection.
		</p>
	{/if}
	{#if field}
		<p class="note">
			Add what was used on the job to its client's draft. Someone with Full starts a draft and sends
			it, and once it has gone out it leaves this list.
		</p>
	{:else if !data.offline && data.drafts.length === 0 && data.out.length === 0 && data.paid.length === 0}
		<p class="note">No invoices yet.</p>
	{/if}
</div>

<style>
	.state {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
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
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.sub.bad {
		color: var(--fgColor-danger);
	}
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}
	.v {
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.tot {
		background: var(--bgColor-muted);
	}
</style>
