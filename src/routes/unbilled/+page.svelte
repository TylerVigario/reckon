<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Segmented from '#lib/Segmented.svelte';
	import { page } from '$app/state';
	import { count, day, hours, miles, names } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	// What is to be billed, or what was counted and not billed (#lib/Segmented).
	const given = $derived(page.url.searchParams.get('view') === 'given');

	// Who was there: the person a one-person entry names, or a team entry's crew.
	const worked = (crew: string, by: string | null, crewNames: string[] = []) =>
		crew === 'team' ? names(crewNames) : (by ?? 'nobody recorded');

	type Row = {
		key: string;
		href: string | null;
		title: string;
		aside: string;
		detail: string;
		worth: string | null;
		measure: string;
		days: number;
	};

	// Time and mileage in one list, oldest first, because age is the only thing
	// that decides which to chase and it does not care which kind it is.
	const rows = $derived<Row[]>(
		[
			...data.work.map((w) => ({
				key: `t${w.id}`,
				href: null,
				title: w.who,
				aside: w.service,
				detail: [
					worked(w.crew, w.worked_by, w.crew_names),
					day(w.worked_on),
					w.site ?? 'no address on file'
				]
					.filter(Boolean)
					.join(' · '),
				worth: w.worth,
				measure: `${hours(w.hours)}${w.heads > 1 ? ` ×${w.heads}` : ''}`,
				days: w.days
			})),
			...data.mileage.map((m) => ({
				key: `m${m.travelled_on}`,
				href: '/trips',
				title: 'Mileage',
				aside: `${m.trips} ${m.trips === 1 ? 'trip' : 'trips'}`,
				detail: [day(m.travelled_on), m.places ? `legs assigned across ${m.places}` : null]
					.filter(Boolean)
					.join(' · '),
				worth: m.worth,
				measure: miles(m.miles),
				days: m.days
			}))
		].sort((a, b) => b.days - a.days)
	);

	const sub = $derived(`${money(data.total)} worked, not yet sent`);
</script>

<Top title="Unbilled work" {sub} back={resolve('/')} backLabel="Today" />

<div class="pad primer">
	{#if data.given.length}
		<Segmented
			label="Unbilled work, seen"
			items={[
				{ href: resolve('/unbilled'), label: 'To bill', current: !given },
				{ href: resolve('/unbilled?view=given'), label: 'Not billable', current: given }
			]}
		/>
	{/if}

	{#if !given || !data.given.length}
		<section class="box" aria-labelledby="bill-h">
			<div class="box-h">
				<h2 class="box-t" id="bill-h">To bill, oldest first</h2>
				{#if data.overdue}
					<span class="lab warn">{data.overdue} past {count(data.alertDays, 'day')}</span>
				{:else}
					<span class="lab">Nothing past {count(data.alertDays, 'day')}</span>
				{/if}
			</div>
			{#each rows as r (r.key)}
				<svelte:element this={r.href ? 'a' : 'div'} class="box-row line" href={r.href}>
					<span class="what">
						<span class="n">{r.title}{r.aside ? ` · ${r.aside}` : ''}</span>
						<span class="sub">{r.detail}</span>
						{#if r.days > data.alertDays}
							<span class="labs"
								><span class="lab warn">Past {count(data.alertDays, 'day')}</span></span
							>
						{/if}
					</span>
					<span class="fig">
						<span class="v">{money(r.worth)}</span>
						<span class="sub">{r.measure} · {count(r.days, 'day', 'narrow')}</span>
					</span>
				</svelte:element>
			{:else}
				<p class="box-row muted">Nothing waiting: everything worked has been put on an invoice.</p>
			{/each}
			{#if rows.length}
				<div class="box-row line tot">
					<span class="what"><span class="n">Worked, not yet billed</span></span>
					<span class="v">{money(data.total)}</span>
				</div>
			{/if}
		</section>
	{:else}
		<section class="box" aria-labelledby="given-h">
			<div class="box-h"><h2 class="box-t" id="given-h">Not billable, and counted anyway</h2></div>
			{#each data.given as g (g.id)}
				<div class="box-row line">
					<span class="what">
						<span class="n">{g.service}{g.who ? ` · ${g.who}` : ''}</span>
						<span class="sub">
							{[worked('one', g.worked_by), day(g.worked_on), g.site].filter(Boolean).join(' · ')}
						</span>
					</span>
					<span class="fig">
						<span class="v muted">—</span>
						<span class="sub">{hours(g.hours)}</span>
					</span>
				</div>
			{/each}
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
		color: inherit;
		text-decoration: none;
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
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.tot {
		background: var(--bgColor-muted);
	}
</style>
