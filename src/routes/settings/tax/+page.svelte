<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import { parseField } from '#lib/settings-fields.ts';
	import type { PageProps } from './$types';

	/**
	 * Whether tax applies and under which rules, and how the return is filed,
	 * each changed in place (#lib/Detail). The rate itself is no setting: each
	 * site's is CDTFA's, and the note under them says so.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.operator);
	const endpoint = '/api/settings';
	const again = () => refreshAll();
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

<div class="pad primer">
	<section class="box" aria-labelledby="rules-h">
		<div class="box-h"><h2 class="box-t" id="rules-h">Rules</h2></div>
		<Detail
			name="tax_rule_set"
			label="Tax rules"
			value={o?.tax_rule_set ?? 'none'}
			options={[
				{ value: 'none', label: 'None: nothing is taxed' },
				{ value: 'us_ca', label: 'United States · California' },
				{ value: 'flat_per_site', label: 'A flat rate for each site' }
			]}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="tax_registration"
			label="Registration"
			value={o?.tax_registration ?? null}
			placeholder="Seller's permit"
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="tax_agency"
			label="Agency"
			value={o?.tax_agency ?? null}
			placeholder="Who the return goes to"
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
	</section>

	<section class="box" aria-labelledby="filing-h">
		<div class="box-h"><h2 class="box-t" id="filing-h">Filing</h2></div>
		<Detail
			name="filing_basis"
			label="Filed"
			value={o?.filing_basis ?? ''}
			options={[
				{ value: '', label: 'Not set' },
				{ value: 'annual', label: 'Yearly' },
				{ value: 'quarterly', label: 'Quarterly' },
				{ value: 'monthly', label: 'Monthly' }
			]}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="fiscal_year_end_month"
			label="Year ends"
			value={o?.fiscal_year_end_month ? String(o.fiscal_year_end_month) : ''}
			options={[{ value: '', label: 'Not set' }, ...MONTHS]}
			shown={o?.fiscal_year_end_month
				? `The last day of ${MONTHS[o.fiscal_year_end_month - 1].label}`
				: 'Not set'}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="claims_tax_paid_purchases_resold"
			label="Tax-paid purchases resold"
			value={o?.claims_tax_paid_purchases_resold ? 'true' : 'false'}
			options={[
				{ value: 'true', label: 'Claimed: tax already paid comes off the measure' },
				{ value: 'false', label: 'Not claimed' }
			]}
			{endpoint}
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}An election, so it is recorded rather than worked out.{/snippet}
		</Detail>
	</section>

	<p class="note">
		No rate is set here. Every site’s rate is what CDTFA returned for its address, and a site cannot
		exist without one. Each site says when CDTFA was last asked, and asks again.
	</p>
</div>
