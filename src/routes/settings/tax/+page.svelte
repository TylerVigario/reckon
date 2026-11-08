<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
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
				<Setting
					name="tax_agency"
					label="Agency"
					value={o?.tax_agency}
					placeholder="Who the return goes to"
				/>
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
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">CDTFA rate API</div>
					<div class="rec-s">
						Every site's rate is what CDTFA returned for its address — a site cannot exist without
						one. Each site's page says when CDTFA was last asked, and asks again.
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
</style>
