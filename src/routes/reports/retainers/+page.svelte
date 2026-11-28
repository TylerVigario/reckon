<script lang="ts">
	import { allotted, hours, percent, periodSaid } from '#lib/format.ts';
	import { PERIOD_WORD } from '#lib/agreement-periods.ts';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import Segmented from '#lib/Segmented.svelte';
	import { reportTabs } from '#lib/section-tabs.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Each retainer over a period of its own, the one under way or the one just
	 * closed (#lib/Segmented): what it charged, what of what it covers was
	 * used, who answered it and what they were paid for it, and what was kept.
	 */
	let { data }: PageProps = $props();

	/** Usage, read against what the allotment allows, as its service is counted. */
	const usage = (m: (typeof data.rows)[number]['services'][number]) => {
		const of = (v: string | null) => allotted(v, m.unit);
		return m.allotment === 'unlimited'
			? `${of(m.used)} used of unlimited`
			: m.allotment === 'capped'
				? `${of(m.used)} used of ${of(m.cap)} · ${of(m.left)} left`
				: `${of(m.used)} used, nothing included`;
	};
</script>

<Top title="Reports" back={resolve('/more')} backLabel="More" />

<div class="pad">
	<UnderlineNav label="Reports" items={reportTabs('retainers', data)} />
	<Segmented
		label="Which period"
		items={[
			{ href: resolve('/reports/retainers'), label: 'This period', current: !data.last },
			{
				href: resolve('/reports/retainers?period=last'),
				label: 'Last period',
				current: data.last
			}
		]}
	/>

	<section class="box" aria-labelledby="period-h">
		<div class="box-h">
			<h2 class="box-t" id="period-h">{data.last ? 'Just closed' : 'Under way'}</h2>
			<span class="sub">charged · paid out</span>
		</div>
		{#each data.rows as r (r.agreement_id)}
			{@const word = PERIOD_WORD[r.interval]}
			<div class="box-row line">
				<span class="what">
					<span class="n">{r.client} · {r.site ?? 'the whole client'}</span>
					<span class="sub">{periodSaid(r.period)}{data.last ? '' : ', so far'}</span>
					{#each r.services as m (m.service)}
						<span class="sub">{m.service} · {usage(m)}</span>
					{:else}
						<span class="sub">The agreement names no service to meter</span>
					{/each}
					{#each r.responders as who (who.person)}
						<span class="sub">
							{who.person} · {hours(who.hours, 'allotted')}, {percent(who.share)} of the covered time
							·
							{who.paid === null
								? `pay not known until the ${word} is charged`
								: `${money(who.paid)} for it`}
						</span>
					{/each}
					{#if r.retainer.state === 'given' || r.retainer.state === 'uncharged' || r.services.some((m) => m.allotment === 'unlimited')}
						<span class="labs">
							{#if r.services.some((m) => m.allotment === 'unlimited')}
								<span class="lab acc">Unlimited</span>
							{/if}
							{#if r.retainer.state === 'given'}
								<span class="lab good">Given freely · {money(r.retainer.charge)} a {word}</span>
							{:else if r.retainer.state === 'uncharged'}
								<span class="lab warn">Not charged yet</span>
							{/if}
						</span>
					{/if}
				</span>
				<span class="fig">
					<span class="v" class:muted={Number(r.charged) === 0}>{money(r.charged)}</span>
					<span class="sub">
						{#if r.paid === null}
							pay not known yet
						{:else if Number(r.paid) > 0}
							{money(r.paid)} paid out
						{:else}
							all kept
						{/if}
					</span>
				</span>
			</div>
		{:else}
			<p class="box-row muted">
				{data.last
					? 'Nothing to meter: no retainer has a period just closed.'
					: 'Nothing to meter: no retainer is running.'}
			</p>
		{/each}
		{#if data.rows.length}
			<div class="box-row line tot">
				<span class="what"><span class="n">Retainers</span></span>
				<span class="fig">
					<span class="v">{money(data.charged)}</span>
					<span class="sub">
						{data.kept === null ? 'what is kept is not known yet' : `${money(data.kept)} kept`}
					</span>
				</span>
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
		overflow-wrap: anywhere;
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
		text-align: right;
	}
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.tot {
		background: var(--bgColor-muted);
	}
</style>
