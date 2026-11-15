<script lang="ts">
	import { Decimal } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import Segmented from '#lib/Segmented.svelte';
	import { page } from '$app/state';
	import { reportTabs } from '#lib/section-tabs.ts';
	import { pct, rateParts } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import Octicon from '#lib/Octicon.svelte';

	/**
	 * Schedule A for the filing year, seen two ways (#lib/Segmented): the
	 * return -- what was collected for somebody else, what is owed on it and
	 * what is still held, then what each district is owed -- and what to look
	 * at before filing it: rates CDTFA was last asked about long ago, and lines
	 * taxed at a rate other than their site's.
	 */
	let { data }: PageProps = $props();
	const checks = $derived(page.url.searchParams.get('view') === 'checks');
	// What there is to look at before filing, said wherever the year is.
	const toCheck = $derived(data.fy ? data.unchecked.length + data.overrides.length : 0);

	// What the client handed over, less what the return actually asks for. The
	// gap is the Reg 1701 credit -- tax already paid to the supplier on goods
	// that were then resold -- and showing the two figures without it side by
	// side reads as an error rather than a rule.
	const credit = $derived(
		data.fy ? Decimal.from(data.owed.charged).sub(data.due).toFixed(currencyPlaces()) : null
	);
	const stillHeld = $derived(
		data.fy ? Decimal.from(data.due).sub(data.owed.remitted).toFixed(currencyPlaces()) : null
	);

	const filing = (f: {
		period_start: string;
		period_end: string;
		filed_on: string | null;
		paid_on: string | null;
		reference: string | null;
	}) =>
		[
			`${f.period_start} to ${f.period_end}`,
			f.paid_on ? `paid ${f.paid_on}` : f.filed_on ? `filed ${f.filed_on}, not yet paid` : null,
			f.reference
		]
			.filter(Boolean)
			.join(' · ');

	// Who the money is owed to. Nothing is shown for a share of nothing -- most
	// of California has no county or city tax, and a row of zeroes reads as a
	// figure rather than an absence.
	const shares = (o: { state: string; district: string }) =>
		[`${money(o.state)} state`, Number(o.district) ? `${money(o.district)} district` : null]
			.filter(Boolean)
			.join(' · ');

	// Built here rather than in the markup: a template that interleaves text
	// with {#if} blocks loses the space between them.
	// The rate and what it is made of, because a return allocates by the parts
	// and not by the total.
	const rate = (d: {
		rate_pct: string | null;
		state_rate_pct: string | null;
		district_rate_pct: string | null;
	}) => `${pct(d.rate_pct)} — ${rateParts(d.state_rate_pct, d.district_rate_pct)}`;

	const basis = (d: { measure: string; deduction: string; sites: number }) =>
		[
			`Measure ${money(d.measure)}`,
			Number(d.deduction) > 0 ? `less deduction ${money(d.deduction)}` : null
		]
			.filter(Boolean)
			.join(' ') + ` · ${d.sites} ${d.sites === 1 ? 'site' : 'sites'}`;
</script>

<Top title="Reports" back={resolve('/more')} backLabel="More" />

<div class="pad primer">
	<UnderlineNav label="Reports" items={reportTabs('schedule-a')} />

	{#if !data.fy}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t">Schedule A needs the filing year</p>
				<p class="banner-d">
					Set the month the filing year ends in, on <a href={resolve('/settings/tax')}>Tax</a>.
				</p>
			</div>
		</div>
	{:else}
		<Segmented
			label="Schedule A, seen"
			items={[
				{ href: resolve('/reports/schedule-a'), label: 'The return', current: !checks },
				{
					href: resolve('/reports/schedule-a?view=checks'),
					label: toCheck ? `Before filing · ${toCheck}` : 'Before filing',
					current: checks
				}
			]}
		/>

		{#if !checks}
			<section class="box" aria-labelledby="owed-h">
				<div class="box-h">
					<h2 class="box-t" id="owed-h">What {data.fy.label} owes</h2>
					<span class="sub">collected for somebody else</span>
				</div>
				<div class="box-row line">
					<span class="what">
						<span class="n">Collected from clients</span>
						<span class="sub">{shares(data.owed)}</span>
						{#if data.owed.estimated_lines}
							<span class="labs"
								><span class="lab warn"
									>{data.owed.estimated_lines} line{data.owed.estimated_lines === 1 ? '' : 's'} split
									by the earliest rate on record</span
								></span
							>
						{/if}
					</span>
					<span class="v">{money(data.owed.charged)}</span>
				</div>
				{#if Number(credit) > 0}
					<div class="box-row line">
						<span class="what">
							<span class="n">Tax already paid on goods resold</span>
							<span class="sub">Reg 1701: it came off the measure, so it is not owed twice</span>
						</span>
						<span class="v muted">−{money(credit)}</span>
					</div>
				{/if}
				<div class="box-row line">
					<span class="what">
						<span class="n">Owed on the return</span>
						<span class="sub">What the districts come to</span>
					</span>
					<span class="v">{money(data.due)}</span>
				</div>
				{#each data.owed.filings as f (f.id)}
					<div class="box-row line">
						<span class="what">
							<span class="n">Handed to CDTFA</span>
							<span class="sub">{filing(f)}</span>
						</span>
						<span class="v muted">−{money(f.amount)}</span>
					</div>
				{:else}
					<div class="box-row line">
						<span class="what">
							<span class="n">Nothing handed over yet</span>
							<span class="sub">No return recorded as filed for this year</span>
						</span>
						<span class="v muted">{money(0)}</span>
					</div>
				{/each}
				<div class="box-row line tot">
					<span class="what">
						<span class="n">Still held</span>
						<span class="sub">Not the business’s money to spend</span>
					</span>
					<span class="v">{money(stillHeld)}</span>
				</div>
			</section>

			<section class="box" aria-labelledby="dist-h">
				<div class="box-h"><h2 class="box-t" id="dist-h">By district</h2></div>
				{#each data.districts as d (d.area + d.rate_pct)}
					<div class="box-row line">
						<span class="what">
							<span class="n">{d.area}</span>
							<span class="sub">{rate(d)}</span>
							<span class="sub">{basis(d)}</span>
						</span>
						<span class="fig">
							<span class="v">{money(d.tax)}</span>
							<span class="sub">net {money(d.net)}</span>
						</span>
					</div>
				{:else}
					<p class="box-row muted">
						No districts: nothing sent this year was taxed, so there is nothing to allocate.
					</p>
				{/each}
			</section>
		{:else}
			<section class="box" aria-labelledby="rates-h">
				<div class="box-h">
					<h2 class="box-t" id="rates-h">Rates worth asking again</h2>
					{#if data.unchecked.length}
						<span class="lab warn">Over 90 days old</span>
					{:else}
						<span class="lab good">All recent</span>
					{/if}
				</div>
				{#each data.unchecked as u (u.client + u.site)}
					<a class="box-row line" href={resolve('/clients/[id]/sites/[site]/tax', u.at)}>
						<span class="what">
							<span class="n">{u.site}</span>
							<span class="sub">{u.client} · {u.why}</span>
						</span>
					</a>
				{:else}
					<p class="box-row muted">Every site’s rate was asked for in the last 90 days.</p>
				{/each}
			</section>

			<section class="box" aria-labelledby="over-h">
				<div class="box-h">
					<h2 class="box-t" id="over-h">Lines at an overridden rate</h2>
					{#if data.overrides.length}
						<span class="lab warn">{data.overrides.length} this year</span>
					{:else}
						<span class="lab good">None</span>
					{/if}
				</div>
				{#each data.overrides as o, i (o.invoice + i)}
					<div class="box-row line">
						<span class="what">
							<span class="n">{o.invoice} · {o.description}</span>
							<span class="sub">{o.reason ?? 'No reason recorded'}</span>
						</span>
						<span class="v">{pct(o.rate_pct)}</span>
					</div>
				{:else}
					<p class="box-row muted">
						Nothing overridden: every taxed line took its rate from the site it was worked at.
					</p>
				{/each}
			</section>
		{/if}
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
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.lab {
		flex: 0 0 auto;
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
