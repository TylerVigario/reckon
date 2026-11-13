<script lang="ts">
	import Detail from '#lib/Detail.svelte';
	import { dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { forInput } from '#lib/currency.ts';
	import { parseAgreementField } from '#lib/agreement-fields.ts';
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';

	/**
	 * An agreement's Terms tab: what it charges, how often, on which day, from
	 * when, what happens to a part period at its end, and whom it was agreed
	 * with -- each changed in place (#lib/Detail).
	 */
	let { data }: PageProps = $props();
	const a = $derived(data.agreement);
	const endpoint = $derived(`/api/agreements/${data.agreement.id}`);
	const INTERVALS = [
		{ value: 'weekly', label: 'Week' },
		{ value: 'monthly', label: 'Month' },
		{ value: 'quarterly', label: 'Quarter' },
		{ value: 'annually', label: 'Year' }
	];
	const PRORATIONS = [
		{ value: 'daily', label: 'Charge the days it ran' },
		{ value: 'none', label: 'Charge the whole period' }
	];
</script>

<section class="box" aria-labelledby="terms-h">
	<div class="box-h"><h2 class="box-t" id="terms-h">What it charges</h2></div>
	<Detail
		name="price"
		label="Price"
		value={forInput(a.price)}
		shown={money(a.price)}
		inputmode="decimal"
		required
		{endpoint}
		validate={parseAgreementField}
		onsaved={refreshAll}
	/>
	<Detail
		name="billing_interval"
		label="Every"
		value={a.billing_interval}
		options={INTERVALS}
		{endpoint}
		validate={parseAgreementField}
		onsaved={refreshAll}
	/>
	<Detail
		name="billing_anchor_day"
		label="Charged on day"
		value={String(a.billing_anchor_day)}
		inputmode="numeric"
		hint="Of each period. A 31st charges on the last day of a shorter month."
		{endpoint}
		validate={parseAgreementField}
		onsaved={refreshAll}
	/>
	<Detail
		name="starts_on"
		label="Starts"
		type="date"
		value={a.starts_on}
		shown={dated(a.starts_on)}
		{endpoint}
		validate={parseAgreementField}
		onsaved={refreshAll}
	/>
	<Detail
		name="final_period_proration"
		label="If it ends part way through a period"
		value={a.final_period_proration}
		options={PRORATIONS}
		{endpoint}
		validate={parseAgreementField}
		onsaved={refreshAll}
	/>
	<Detail
		name="contact_id"
		label="Agreed with"
		value={a.contact_id ?? ''}
		options={[
			{ value: '', label: 'Nobody in particular' },
			...data.contacts.map((c) => ({ value: c.id, label: c.name }))
		]}
		{endpoint}
		validate={parseAgreementField}
		onsaved={refreshAll}
	/>
</section>
