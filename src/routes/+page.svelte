<script lang="ts">
	import { sumMoney } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import { onMount } from 'svelte';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { running, type Running } from '#lib/timers.ts';
	import {
		count,
		dated,
		dayRange,
		elapsed,
		fullDay,
		names as listed,
		secondsAsHours
	} from '#lib/format.ts';
	import { AGES, type Age } from '#lib/ageing.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// "Owed to KFS" -- the operator's own short name,
	// because the figure is owed TO a business and the reader may not be its
	// owner. Falling back to "you" rather than to a long trading name, which
	// would wrap the tile label onto three lines.
	const who = $derived(data.operator?.short_name || 'you');

	// The three bands always show, in order, whether or not anything is in
	// them: "nothing older than a month" is the figure worth seeing.
	type Bucket = { bucket: Age; n: string; worth: string; oldest: string | null };
	const byBucket = $derived(
		Object.fromEntries((data.ageing as Bucket[]).map((a) => [a.bucket, a])) as Record<
			string,
			Bucket | undefined
		>
	);
	const unbilled = $derived(
		sumMoney(
			data.ageing.map((a: { worth: string }) => a.worth),
			currencyPlaces()
		)
	);

	// The timer is the browser's own: it survives a refresh because it is
	// written down here, not because the server was told about it. So it is
	// read on mount rather than loaded, and nothing renders it server-side.
	let timers = $state<Running[]>([]);
	let now = $state(Date.now());
	onMount(() => {
		timers = running();
		const t = setInterval(() => {
			now = Date.now();
			timers = running();
		}, 1000);
		return () => clearInterval(t);
	});
	const live = $derived(timers[0]);
	const label = $derived(
		live
			? [data.names.entity[live.entity_id ?? ''], data.names.service[live.service_id]]
					.filter(Boolean)
					.join(' · ')
			: ''
	);
	const clock = (t: Running) => {
		const s = Math.max(0, Math.floor((now - t.started_at) / 1000));
		return elapsed(s);
	};
</script>

<Top title="Today" sub={fullDay(data.today)}>
	{#snippet actions()}
		<a class="btn pri sm" href={resolve('/timesheet/start')}>Start</a>
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} />

<!-- What is running, which opens Time. -->
{#snippet runningRow()}
	<a class="box-row line" href={resolve('/timesheet')}>
		<span class="what">
			<span class="n">Running</span>
			<span class="sub"
				>{live
					? `${label || 'Timing'}${timers.length > 1 ? `, and ${timers.length - 1} more` : ''}`
					: 'Nothing running'}</span
			>
		</span>
		<span class="fig"><span class="v" class:mut={!live}>{live ? clock(live) : '—'}</span></span>
	</a>
{/snippet}

<div class="pad">
	{#if data.mine}
		{@const m = data.mine}
		<!-- Someone with Field, or anyone with no signal: their own day, and
		     nothing of the business's figures. -->
		<section class="box" aria-label="At a glance">
			{@render runningRow()}
			<a class="box-row line" href={resolve('/timesheet/all')}>
				<span class="what">
					<span class="n">Your time</span>
					<span class="sub">This month</span>
				</span>
				<span class="fig"><span class="v">{secondsAsHours(m.monthSeconds, 'whole')}</span></span>
			</a>
			{#if m.pay && data.user}
				<a class="box-row line" href={resolve('/reports/pay/[person]', { person: data.user.id })}>
					<span class="what">
						<span class="n">Owed to you</span>
						<span class="sub"
							>{m.pay.last_paid ? `Last paid ${dated(m.pay.last_paid)}` : 'Nothing paid yet'}</span
						>
					</span>
					{#if m.pay.unpriced}<span class="lab warn">Some unpriced</span>{/if}
					<span class="fig"><span class="v">{money(m.pay.owed)}</span></span>
				</a>
			{/if}
		</section>

		<section class="box" aria-labelledby="work-h">
			<div class="box-h">
				<h2 class="box-t" id="work-h">Your work today</h2>
				<a class="lk" href={resolve('/timesheet')}>Time</a>
			</div>
			{#each m.work as w (w.id)}
				<a class="box-row line" href={resolve('/timesheet/[id]', { id: w.id })}>
					<span class="what">
						<span class="n">{w.site ?? w.entity ?? 'No client'}</span>
						<span class="sub"
							>{w.crew === 'team' ? listed(w.crew_names) : (w.worked_by ?? '')} · {w.service}</span
						>
					</span>
					{#if w.crew === 'team'}<span class="lab">Team</span>{/if}
					<span class="fig"><span class="v">{elapsed(w.seconds, false)}</span></span>
				</a>
			{:else}
				<div class="box-row">
					<p class="sub none">
						Nothing yet today: a timer, or Add past work for work already done.
					</p>
				</div>
			{/each}
		</section>

		<section class="box" aria-labelledby="drafts-h">
			<div class="box-h">
				<h2 class="box-t" id="drafts-h">Drafts to add to</h2>
				<a class="lk" href={resolve('/invoices')}>Invoices</a>
			</div>
			{#each data.drafts as d (d.id)}
				<a class="box-row line" href={resolve('/invoices/[id]', { id: d.id })}>
					<span class="what">
						<span class="n">{d.who}</span>
						<span class="sub">Draft {d.number}</span>
					</span>
				</a>
			{:else}
				<div class="box-row">
					<p class="sub none">
						{data.user?.access === 'field'
							? 'No drafts. Someone with Full starts one for a client.'
							: 'No drafts. New draft, on Invoices, starts one for a client.'}
					</p>
				</div>
			{/each}
		</section>
		{#if data.offline}
			<p class="note">
				{data.user?.access === 'field'
					? 'What you are owed needs a connection.'
					: 'What is owed, ready to send and not yet billed needs a connection.'}
			</p>
		{/if}
	{:else}
		<section class="box" aria-label="At a glance">
			<a class="box-row line" href={resolve('/invoices')}>
				<span class="what">
					<span class="n">Owed to {who}</span>
					<span class="sub"
						>{data.totals?.owed_count ?? 0}
						{Number(data.totals?.owed_count) === 1 ? 'invoice' : 'invoices'} out</span
					>
				</span>
				<span class="fig"><span class="v">{money(data.totals?.owed)}</span></span>
			</a>
			{@render runningRow()}
			<a class="box-row line" href={resolve('/reports/sales-tax')}>
				<span class="what">
					<span class="n">Sales tax held</span>
					<span class="sub">Collected, not yet handed over</span>
				</span>
				<span class="fig"><span class="v">{money(data.totals?.tax_held)}</span></span>
			</a>
		</section>

		{#if data.decisions.length}
			<section class="box" aria-labelledby="decide-h">
				<div class="box-h">
					<h2 class="box-t" id="decide-h">Needs a decision</h2>
					<span class="count">{data.decisions.length}</span>
				</div>
				{#each data.decisions as d (`${d.kind}:${d.title}`)}
					{#snippet decision()}
						<span class="what">
							<span class="n">{d.title}</span>
							<span class="sub">{d.detail}</span>
							<span class="labs"
								><span class="lab {d.kind === 'invoice' ? 'crit' : 'warn'}">{d.chip}</span></span
							>
						</span>
						{#if d.amount}<span class="fig"><span class="v">{money(d.amount)}</span></span>{/if}
					{/snippet}
					<!-- An overdue invoice opens itself; an old rate opens its site, where
					     CDTFA is asked again, or its typed area, where it is confirmed. -->
					{#if d.invoice}
						<a class="box-row line" href={resolve('/invoices/[id]', { id: d.invoice })}
							>{@render decision()}</a
						>
					{:else if d.area}
						<a class="box-row line" href={resolve('/settings/tax/[state]/[area]', d.area)}
							>{@render decision()}</a
						>
					{:else if d.site}
						<a class="box-row line" href={resolve('/clients/[id]/sites/[site]', d.site)}
							>{@render decision()}</a
						>
					{:else}
						<div class="box-row line">{@render decision()}</div>
					{/if}
				{/each}
			</section>
		{/if}

		<section class="box" aria-labelledby="ready-h">
			<div class="box-h">
				<h2 class="box-t" id="ready-h">Ready to send</h2>
				<a class="lk" href={resolve('/invoices/ready')}>All {data.totals?.draft_count ?? 0}</a>
			</div>
			{#each data.drafts as d (d.id)}
				<a class="box-row line" href={resolve('/invoices/[id]', { id: d.id })}>
					<span class="what">
						<span class="n">{d.who}</span>
						<span class="sub"
							>Draft {d.number} · {d.lines} {Number(d.lines) === 1 ? 'line' : 'lines'}</span
						>
					</span>
					<span class="fig"><span class="v">{money(d.gross)}</span></span>
				</a>
			{:else}
				<div class="box-row">
					<p class="sub none">
						Nothing drafted. Work becomes a draft when it is put on an invoice.
					</p>
				</div>
			{/each}
			<!-- The newest few are listed; all of them come to this. -->
			{#if Number(data.totals?.draft_count) > data.drafts.length}
				<a class="box-row line tot" href={resolve('/invoices/ready')}>
					<span class="what">
						<span class="n">All {data.totals?.draft_count} drafts</span>
						<span class="sub">None sent</span>
					</span>
					<span class="fig"><span class="v">{money(data.totals?.drafts)}</span></span>
				</a>
			{/if}
		</section>

		<section class="box" aria-labelledby="age-h">
			<div class="box-h">
				<h2 class="box-t" id="age-h">Unbilled work, by age</h2>
				<a class="lk" href={resolve('/unbilled')}>Unbilled</a>
			</div>
			{#each AGES as b (b.key)}
				{@const row = byBucket[b.key]}
				<div class="box-row line">
					<span class="what">
						<span class="n">{dayRange(b.from, b.to)}</span>
						<span class="sub">
							{#if row}
								{row.n}
								{Number(row.n) === 1 ? 'entry' : 'entries'}{#if row.oldest}, oldest {count(
										Number(row.oldest),
										'day'
									)}{/if}
							{:else}
								Nothing, and it should stay that way
							{/if}
						</span>
					</span>
					<span class="fig">
						{#if row}
							<span class="v {b.tone}">{money(row.worth)}</span>
						{:else}
							<span class="v mut">{money(0)}</span>
						{/if}
					</span>
				</div>
			{/each}
			<div class="box-row line tot">
				<span class="what"><span class="n">Worked, not yet billed</span></span>
				<span class="fig"><span class="v">{money(unbilled)}</span></span>
			</div>
		</section>
	{/if}
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
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.none {
		margin: 0;
		font-size: inherit;
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
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	/* What each age of unbilled work is worth, coloured by how urgent the age is. */
	.v.mut {
		color: var(--fgColor-muted);
	}
	.v.good {
		color: var(--fgColor-success);
	}
	.v.warn {
		color: var(--fgColor-attention);
	}
	.v.crit {
		color: var(--fgColor-danger);
	}
	.tot {
		background: var(--bgColor-muted);
	}
</style>
