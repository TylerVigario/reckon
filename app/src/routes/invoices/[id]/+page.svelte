<script lang="ts">
	import { Decimal } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import Top from '#lib/Top.svelte';
	import { clock, day, monthOf, pct, quantity, rateParts } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const i = $derived(data.invoice);
	const t = $derived(data.totals);

	// Reg 1701: the measure is what was sold taxable, less what was already
	// taxed when it was bought. What is left is the markup.
	const netTaxable = $derived(
		Decimal.from(t.taxable_measure).sub(t.resold).toFixed(currencyPlaces())
	);
	const dueOnReturn = $derived(t.due_on_return);

	// The rate and the two obligations inside it: a return allocates the
	// state's share and the district tax separately, so the invoice that
	// charged them says which is which.
	const made = (x: {
		rate_pct: string | null;
		state_rate_pct: string | null;
		district_rate_pct: string | null;
	}) => `${pct(x.rate_pct)} (${rateParts(x.state_rate_pct, x.district_rate_pct)})`;

	// The schema's own words for what a line is. A label that says "goods" over
	// a taxed labour line is the page asserting something the data did not.
	const KIND: Record<string, string> = {
		service: 'services',
		material: 'goods',
		recurring: 'the retainer',
		adjustment: 'adjustments',
		bought: 'goods',
		paid_for: 'expenses'
	};
	const listed = (kinds: string[]) => {
		const words = [...new Set(kinds.map((k) => KIND[k] ?? k))];
		if (words.length === 0) return '';
		if (words.length === 1) return words[0];
		return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
	};

	const period = $derived(i.period_start ? monthOf(i.period_start) : null);
	const sub = $derived([i.who, period].filter(Boolean).join(' · '));
	const title = $derived(i.status === 'draft' ? `Draft ${i.number}` : i.number);
</script>

<Top {title} {sub} back={resolve('/invoices')} backLabel="Invoices">
	{#snippet actions()}
		{#if i.status === 'draft'}
			<a class="btn sm" href={resolve('/invoices/[id]/add', { id: i.id })}>Add a line</a>
			<span class="btn pri sm">Send</span>
		{/if}
	{/snippet}
</Top>

<div class="pad">
	<div class="tiles">
		<div class="tile">
			<span class="k">Due</span>
			<span class="v">{money(t.due)}</span>
			<span class="s">{i.terms ? `Net ${i.terms}` : i.due_on ? day(i.due_on) : 'no terms set'}</span
			>
		</div>
		<div class="tile">
			<span class="k">Status</span>
			<span class="v sm {i.status === 'draft' ? 'warn' : 'good'}">
				{i.status === 'draft' ? 'Draft' : 'Sent'}
			</span>
			<span class="s">
				{i.status === 'draft'
					? `Assembled ${clock(i.assembled, personalZone())}`
					: `Sent ${day(i.sent_on)}`}
			</span>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Lines</h2></div>
		<div class="rows">
			{#each data.lines as l (l.id)}
				{#if l.trip_leg_id}
					<a class="rec link" href={resolve('/trips')}>
						<div class="rec-m">
							<div class="rec-t">{l.description}</div>
							{#if l.detail}<div class="rec-s">{l.detail}</div>{/if}
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(l.amount)}</span>
							<span class="rec-x">{quantity(l.qty)} × {quantity(l.unit_price)}</span>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{:else}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{l.description}</div>
							{#if l.detail}<div class="rec-s">{l.detail}{l.taxable ? ' · taxable' : ''}</div>{/if}
							{#if l.receipt}
								<div class="rec-s">
									<a href={resolve('/invoices/[id]/lines/[line]/receipt', { id: i.id, line: l.id })}
										>The receipt</a
									>
								</div>
							{/if}
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(l.amount)}</span>
							<span class="rec-x">
								{quantity(l.qty)}{l.unit ? ` ${l.unit}` : ''} × {quantity(l.unit_price)}
							</span>
						</div>
					</div>
				{/if}
			{/each}

			{#if Number(t.untaxed) > 0}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t lt">
							{listed(t.untaxed_kinds) || 'Untaxed'} — not taxable
						</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">{money(t.untaxed)}</span></div>
				</div>
			{/if}

			{#if Number(t.tax) > 0}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t lt">
							Sales tax{t.district ? ` · ${t.district} ${made(t)}` : ''}{listed(t.taxed_kinds)
								? ` on ${listed(t.taxed_kinds)}`
								: ''}
						</div>
						{#if data.lines.find((l) => l.taxable && l.where_from)}
							<div class="rec-s">
								From {data.lines.find((l) => l.taxable && l.where_from)?.where_from}, where the work
								happened
							</div>
						{/if}
					</div>
					<div class="rec-n"><span class="rec-v mut">{money(t.tax)}</span></div>
				</div>
			{/if}

			<div class="rec tot">
				<div class="rec-m"><div class="rec-t">Due</div></div>
				<div class="rec-n"><span class="rec-v">{money(t.due)}</span></div>
			</div>
		</div>
	</div>

	{#if Number(t.taxable_measure) > 0}
		<div class="sec">
			<div class="sec-h"><h2>What this does to the return</h2></div>
			<div class="rows">
				<div class="rec">
					<div class="rec-m"><div class="rec-t">Taxable measure</div></div>
					<div class="rec-n"><span class="rec-v">{money(t.taxable_measure)}</span></div>
				</div>
				{#if Number(t.resold) > 0}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">Less tax-paid purchases resold</div>
							<div class="rec-s">The ex-tax cost, stored on the line</div>
						</div>
						<div class="rec-n"><span class="rec-v">−{money(t.resold)}</span></div>
					</div>
				{/if}
				<div class="rec">
					<div class="rec-m"><div class="rec-t">Net taxable — the markup</div></div>
					<div class="rec-n"><span class="rec-v">{money(netTaxable)}</span></div>
				</div>
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Due on the return</div></div>
					<div class="rec-n"><span class="rec-v">{money(dueOnReturn)}</span></div>
				</div>
			</div>
		</div>
	{/if}
</div>
