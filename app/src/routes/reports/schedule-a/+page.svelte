<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { pct } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// What the client handed over, less what the return actually asks for. The
	// gap is the Reg 1701 credit -- tax already paid to the supplier on goods
	// that were then resold -- and showing the two figures without it side by
	// side reads as an error rather than a rule.
	const credit = $derived(Number(data.owed.charged) - Number(data.due));
	const stillHeld = $derived(Number(data.due) - Number(data.owed.remitted));

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
	}) =>
		Number(d.district_rate_pct) > 0
			? `${pct(d.rate_pct)} — ${Number(d.state_rate_pct).toFixed(3)} state + ${Number(
					d.district_rate_pct
				).toFixed(3)} district`
			: `${pct(d.rate_pct)} — all state, no district`;

	const basis = (d: {
		lines: number;
		measure: string;
		deduction: string;
		rate_pct: string | null;
		state_rate_pct: string | null;
		district_rate_pct: string | null;
		sites: number;
	}) => {
		const where = `${d.sites} ${d.sites === 1 ? 'site' : 'sites'}`;
		return d.lines
			? [
					`Measure ${money(d.measure)}`,
					Number(d.deduction) > 0 ? `less deduction ${money(d.deduction)}` : null
				]
					.filter(Boolean)
					.join(' ') + ` · ${where}`
			: `No goods this period · ${where}`;
	};
</script>

<Top
	title="Schedule A"
	sub="Measure and deduction by district"
	back={resolve('/reports')}
	backLabel="Reports"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h">
			<h2>{data.fy.label}</h2>
			<span class="sp"></span>
			<div class="sec">
				<div class="sec-h">
					<h2>What is owed</h2>
					<span class="sp"></span>
					<span class="chip">Collected for somebody else</span>
				</div>
				<div class="rows">
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">Collected from clients</div>
							<div class="rec-s">{shares(data.owed)}</div>
							{#if data.owed.estimated_lines}
								<div class="rec-c">
									<span class="chip warn">
										<span class="dot"></span>{data.owed.estimated_lines} line{data.owed
											.estimated_lines === 1
											? ''
											: 's'} split by the earliest rate on record
									</span>
								</div>
							{/if}
						</div>
						<div class="rec-n"><span class="rec-v">{money(data.owed.charged)}</span></div>
					</div>
					{#if credit > 0.004}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-t">Tax already paid on goods resold</div>
								<div class="rec-s">
									Reg 1701: it came off the measure above, so it is not owed twice
								</div>
							</div>
							<div class="rec-n"><span class="rec-v mut">−{money(credit)}</span></div>
						</div>
					{/if}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">Owed on the return</div>
							<div class="rec-s">The figure the districts above come to</div>
						</div>
						<div class="rec-n"><span class="rec-v">{money(data.due)}</span></div>
					</div>
					{#each data.owed.filings as f (f.id)}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-t">Handed to CDTFA</div>
								<div class="rec-s">{filing(f)}</div>
							</div>
							<div class="rec-n"><span class="rec-v mut">−{money(f.amount)}</span></div>
						</div>
					{:else}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-t"><span class="lt">Nothing handed over yet</span></div>
								<div class="rec-s">No return recorded as filed for this year</div>
							</div>
							<div class="rec-n"><span class="rec-v mut">{money(0)}</span></div>
						</div>
					{/each}
					<div class="rec tot" class:warn={stillHeld > 0.004}>
						<div class="rec-m">
							<div class="rec-t">Still held</div>
							<div class="rec-s">Not the business's money to spend</div>
						</div>
						<div class="rec-n"><span class="rec-v">{money(stillHeld)}</span></div>
					</div>
				</div>
			</div>

			{#if data.unchecked.length}
				<span class="chip warn">
					<span class="dot"></span>{data.unchecked.length} rate{data.unchecked.length === 1
						? ''
						: 's'} over 90 days old
				</span>
			{:else}
				<span class="chip good"><span class="dot"></span>Every rate asked for recently</span>
			{/if}
		</div>
		<div class="rows">
			{#each data.districts as d (d.area + d.rate_pct)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{d.area}</div>
						<div class="rec-s">{rate(d)}</div>
						<div class="rec-s">{basis(d)}</div>
					</div>
					<div class="rec-n">
						<span class="rec-v" class:mut={!d.lines}>{money(d.tax)}</span>
						{#if d.lines}<span class="rec-x">net {money(d.net)}</span>{/if}
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">No districts</span></div>
						<div class="rec-s">No site draws a levy, so there is nothing to allocate</div>
					</div>
				</div>
			{/each}
			{#if data.districts.length}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Tax due</div></div>
					<div class="rec-n"><span class="rec-v">{money(data.due)}</span></div>
				</div>
			{/if}
		</div>
	</div>

	{#if data.unchecked.length}
		<div class="sec">
			<div class="sec-h">
				<h2>Rates worth re-asking about</h2>
				<span class="sp"></span>
				<span class="chip warn"><span class="dot"></span>Over 90 days old</span>
			</div>
			<div class="rows">
				{#each data.unchecked as u (u.client + u.site)}
					<a class="rec link warn" href={resolve('/clients')}>
						<div class="rec-m">
							<div class="rec-t">{u.site}</div>
							<div class="rec-s">{u.client} · {u.why}</div>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<div class="sec">
		<div class="sec-h">
			<h2>Lines at an overridden rate</h2>
			<span class="sp"></span>
			{#if data.overrides.length}
				<span class="chip warn"><span class="dot"></span>{data.overrides.length} this period</span>
			{:else}
				<span class="chip good"><span class="dot"></span>None this period</span>
			{/if}
		</div>
		<div class="rows">
			{#each data.overrides as o, i (o.invoice + i)}
				<div class="rec warn">
					<div class="rec-m">
						<div class="rec-t">{o.invoice} · {o.description}</div>
						<div class="rec-s">{o.reason ?? 'No reason recorded'}</div>
					</div>
					<div class="rec-n"><span class="rec-v">{Number(o.rate_pct).toFixed(3)}%</span></div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">Nothing overridden</div>
						<div class="rec-s">Every taxed line took its rate from the site it was worked at</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">0</span></div>
				</div>
			{/each}
		</div>
	</div>
</div>
