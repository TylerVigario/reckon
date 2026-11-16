<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { count, day, daysAgo, pct } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// The two lines under a row's title: who it goes to with what tax and why,
	// then what it is made of. An absent part is dropped rather than shown empty
	// -- a row reading "· · period close" says less than one reading "period
	// close", and an empty first line leaves a hole above the second.
	const lines = (d: {
		contact: string | null;
		area: string | null;
		rate_pct: string | null;
		period_end: string | null;
		made_of: string | null;
	}) => {
		const who = [
			d.contact,
			d.rate_pct && Number(d.rate_pct) > 0
				? `${d.area ? d.area + ' ' : ''}${pct(d.rate_pct)}`
				: null,
			d.period_end ? 'period close' : null
		]
			.filter(Boolean)
			.join(' · ');
		const made = d.made_of ? d.made_of.charAt(0).toUpperCase() + d.made_of.slice(1) : '';
		return [who, made].filter(Boolean);
	};

	const sub = $derived(
		`${data.drafts.length} ${data.drafts.length === 1 ? 'draft' : 'drafts'} · ${money(data.total)}`
	);
</script>

<Top title="Ready to send" {sub} back={resolve('/')} backLabel="Today" />

<div class="pad">
	<section class="box" aria-labelledby="built-h">
		<div class="box-h">
			<h2 class="box-t" id="built-h">Built, none sent</h2>
			<span class="sub">reviewed and sent, never by itself</span>
		</div>
		{#each data.drafts as d (d.id)}
			<a class="box-row line" href={resolve('/invoices/[id]', { id: d.id })}>
				<span class="what">
					<span class="n">{d.number} · {d.who}</span>
					{#each lines(d) as l, i (i)}<span class="sub">{l}</span>{/each}
					{#if d.aged}
						<span class="labs"
							><span class="lab warn"
								>Worked {day(d.oldest_worked_on)}{d.days_waiting === null
									? ''
									: `, ${daysAgo(d.days_waiting)}`}</span
							></span
						>
					{/if}
				</span>
				<span class="fig">
					<span class="v">{money(d.gross)}</span>
					<span class="sub">{d.lines} {Number(d.lines) === 1 ? 'line' : 'lines'}</span>
				</span>
			</a>
		{:else}
			<p class="box-row muted">
				Nothing drafted. Nothing builds drafts yet. Work unbilled for more than {count(
					data.alertDays,
					'day'
				)} is flagged on Unbilled.
			</p>
		{/each}
		{#if data.drafts.length}
			<div class="box-row line tot">
				<span class="what"
					><span class="n"
						>{data.drafts.length}
						{data.drafts.length === 1 ? 'draft' : 'drafts'}</span
					></span
				>
				<span class="v">{money(data.total)}</span>
			</div>
		{/if}
	</section>
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
