<script lang="ts">
	import { sumMoney } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import { onMount } from 'svelte';
	import Top from '#lib/Top.svelte';
	import { running, type Running } from '#lib/timers.ts';
	import { count, dayRange, elapsed, fullDay } from '#lib/format.ts';
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

<div class="pad">
	<div class="tiles">
		<div class="tile">
			<span class="k">Owed to {who}</span>
			<span class="v">{money(data.totals?.owed)}</span>
			<span class="s">{data.totals?.owed_count ?? 0} invoices out</span>
		</div>
		<div class="tile">
			<span class="k">Ready to send</span>
			<span class="v">{money(data.totals?.drafts)}</span>
			<span class="s">{data.totals?.draft_count ?? 0} drafts, none sent</span>
		</div>
		<div class="tile">
			<span class="k">Running</span>
			{#if live}
				<span class="v sm">{clock(live)}</span>
				<span class="s">
					{label || 'timing'}{#if timers.length > 1}
						· {timers.length - 1} more{/if}
				</span>
			{:else}
				<span class="v sm mut">—</span>
				<span class="s">Nothing running</span>
			{/if}
		</div>
		<div class="tile">
			<span class="k">Sales tax held</span>
			<span class="v sm">{money(data.totals?.tax_held)}</span>
			<span class="s">Collected, not yet handed over</span>
		</div>
	</div>

	{#if data.decisions.length}
		<div class="sec">
			<div class="sec-h"><h2>Needs a decision</h2></div>
			<div class="rows">
				{#each data.decisions as d (`${d.kind}:${d.title}`)}
					<div class="rec" class:crit={d.kind === 'invoice'} class:warn={d.kind === 'district'}>
						<div class="rec-m">
							<div class="rec-t">{d.title}</div>
							<div class="rec-s">{d.detail}</div>
							<div class="rec-c">
								<span class="chip {d.kind === 'invoice' ? 'crit' : 'warn'}">
									<span class="dot"></span>{d.chip}
								</span>
							</div>
						</div>
						<div class="rec-n">
							{#if d.amount}<span class="rec-v">{money(d.amount)}</span>
							{:else}<span class="rec-v mut">—</span>{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="duo">
		<div class="sec">
			<div class="sec-h">
				<h2>Ready to send</h2>
				<a class="seeall" href={resolve('/invoices/ready')}>All {data.totals?.draft_count ?? 0}</a>
			</div>
			<div class="rows">
				{#each data.drafts as d (d.id)}
					<a class="rec link" href={resolve('/invoices')}>
						<div class="rec-m">
							<div class="rec-t">{d.who}</div>
							<div class="rec-s">Draft {d.number}</div>
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(d.gross)}</span>
							<span class="rec-x">{d.lines} {Number(d.lines) === 1 ? 'line' : 'lines'}</span>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{:else}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t"><span class="lt">Nothing drafted</span></div>
							<div class="rec-s">Work becomes a draft when it is put on an invoice</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="sec">
			<div class="sec-h">
				<h2>Unbilled work, by age</h2>
				<a class="seeall" href={resolve('/unbilled')}>All</a>
			</div>
			<div class="rows">
				{#each AGES as b (b.key)}
					{@const row = byBucket[b.key]}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{dayRange(b.from, b.to)}</div>
							<div class="rec-s">
								{#if row}
									{row.n}
									{Number(row.n) === 1 ? 'entry' : 'entries'}{#if row.oldest}, oldest {count(
											Number(row.oldest),
											'day'
										)}{/if}
								{:else}
									Nothing, and it should stay that way
								{/if}
							</div>
						</div>
						<div class="rec-n">
							{#if row}
								<span class="rec-v {b.tone}">{money(row.worth)}</span>
							{:else}
								<span class="rec-v mut">{money(0)}</span>
							{/if}
						</div>
					</div>
				{/each}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Worked, not yet billed</div></div>
					<div class="rec-n"><span class="rec-v">{money(unbilled)}</span></div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* What each age of unbilled work is worth, coloured by how urgent the age is.
	   Classes, not a style attribute, which the content security policy refuses. */
	.rec-v.good {
		color: var(--good);
	}
	.rec-v.warn {
		color: var(--warn);
	}
	.rec-v.crit {
		color: var(--crit);
	}
</style>
