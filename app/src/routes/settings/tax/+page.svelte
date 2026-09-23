<script lang="ts">
	import Top from '$lib/Top.svelte';
	import Setting from '$lib/Setting.svelte';
	import { dated } from '$lib/format';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const o = $derived(data.operator);
	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	].map((m, i) => ({ value: String(i + 1), label: m }));
</script>

<Top
	title="Tax"
	sub="Whether it applies, and under which rules"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>Rules</h2></div>
		<div class="rows inset">
			<Setting
				name="tax_rule_set"
				label="Tax rules"
				value={o?.tax_rule_set ?? 'none'}
				options={[
					{ value: 'none', label: 'None — nothing is taxed' },
					{ value: 'us_ca', label: 'United States · California' },
					{ value: 'flat_per_site', label: 'Flat rate per site' }
				]}
				hint="The rate itself comes from the areas a site draws"
			/>
			<div class="pair">
				<Setting
					name="tax_registration"
					label="Registration"
					value={o?.tax_registration}
					placeholder="Seller's permit"
				/>
				<Setting name="tax_agency" label="Agency" value={o?.tax_agency} placeholder="CDTFA" />
			</div>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Filing</h2></div>
		<div class="rows inset">
			<div class="pair">
				<Setting
					name="filing_basis"
					label="Filing basis"
					value={o?.filing_basis ?? ''}
					options={[
						{ value: '', label: 'Not set' },
						{ value: 'annual', label: 'Annual' },
						{ value: 'quarterly', label: 'Quarterly' },
						{ value: 'monthly', label: 'Monthly' }
					]}
				/>
				<Setting
					name="fiscal_year_end_month"
					label="Fiscal year ends"
					value={o?.fiscal_year_end_month ? String(o.fiscal_year_end_month) : ''}
					options={[{ value: '', label: 'Not set' }, ...MONTHS]}
					hint="On the last day of that month"
				/>
			</div>
			<Setting
				name="claims_tax_paid_purchases_resold"
				label="Claim tax-paid purchases resold"
				value={o?.claims_tax_paid_purchases_resold ? 'true' : 'false'}
				options={[
					{ value: 'true', label: 'Claim it — tax already paid comes off the measure' },
					{ value: 'false', label: 'Do not claim it' }
				]}
				hint="An election, so it is recorded rather than inferred"
			/>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h">
			<h2>Where a rate comes from</h2>
			<span class="sp"></span>
			<span class="chip">Nothing here is ours to set</span>
		</div>
		<div class="rows">
			<div class="rec" class:warn={Number(data.rates.stale) > 0}>
				<div class="rec-m">
					<div class="rec-t">CDTFA rate API</div>
					<div class="rec-s">
						Every site's rate is what CDTFA returned for its address — a site cannot exist without
						one. A refresh asks again and writes down the answer.
					</div>
					<div class="rec-c">
						{#if Number(data.rates.stale) > 0}
							<span class="chip warn">
								<span class="dot"></span>{data.rates.stale} to re-ask about
							</span>
						{:else}
							<span class="chip good"><span class="dot"></span>All asked within 90 days</span>
						{/if}
						{#if data.rates.oldest}
							<span class="chip">Oldest answer {dated(data.rates.oldest)}</span>
						{/if}
					</div>
				</div>
				<div class="rec-n">
					<span class="rec-v mut">{data.rates.sites}</span>
					<span class="rec-x">{Number(data.rates.sites) === 1 ? 'site' : 'sites'}</span>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
</style>
