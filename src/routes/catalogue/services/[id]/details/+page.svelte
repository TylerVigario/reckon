<script lang="ts">
	import Detail from '#lib/Detail.svelte';
	import { increment } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { forInput } from '#lib/currency.ts';
	import { parseServiceField } from '#lib/service-fields.ts';
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';

	/**
	 * A service's Details tab: what it is, each changed in place (#lib/Detail)
	 * -- its name, what it is charged per, what an hour is billed to, its least
	 * charge, whether it is on the timer, whether it is taxed.
	 */
	let { data }: PageProps = $props();
	const s = $derived(data.service);
	const endpoint = $derived(`/api/services/${data.service.id}`);

	const YES_NO = [
		{ value: 'true', label: 'Yes' },
		{ value: 'false', label: 'No' }
	];
	const STEPS = [
		{ value: '', label: 'The exact time' },
		{ value: '1', label: 'The second' },
		{ value: '60', label: 'The minute' },
		{ value: '360', label: 'Six minutes' },
		{ value: '900', label: 'The quarter hour' },
		{ value: '1800', label: 'The half hour' },
		{ value: '3600', label: 'The hour' }
	];
	// A step somebody set outside this list still shows as what it is.
	const steps = $derived(
		s.bill_to_nearest_seconds === null ||
			STEPS.some((o) => o.value === String(s.bill_to_nearest_seconds))
			? STEPS
			: [
					...STEPS,
					{
						value: String(s.bill_to_nearest_seconds),
						label: increment(s.bill_to_nearest_seconds).replace(/^to the (nearest )?/, '')
					}
				]
	);
</script>

<section class="box" aria-labelledby="is-h">
	<div class="box-h"><h2 class="box-t" id="is-h">What it is</h2></div>
	<Detail
		name="name"
		label="Name"
		value={s.name}
		required
		{endpoint}
		validate={parseServiceField}
		onsaved={refreshAll}
	/>
	<Detail
		name="unit"
		label="Charged per"
		value={s.unit}
		options={[
			{ value: 'hour', label: 'Hour' },
			{ value: 'mile', label: 'Mile' },
			{ value: 'each', label: 'Each, a flat rate' }
		]}
		{endpoint}
		validate={parseServiceField}
		onsaved={refreshAll}
	/>
	{#if s.unit === 'hour'}
		<Detail
			name="bill_to_nearest_seconds"
			label="Billed to"
			value={s.bill_to_nearest_seconds === null ? '' : String(s.bill_to_nearest_seconds)}
			options={steps}
			hint="Pay is never rounded: it is counted as worked."
			{endpoint}
			validate={parseServiceField}
			onsaved={refreshAll}
		/>
	{/if}
	<Detail
		name="minimum_charge"
		label="Minimum charge"
		value={forInput(s.minimum_charge)}
		shown={s.minimum_charge ? money(s.minimum_charge) : ''}
		inputmode="decimal"
		hint="The least one entry bills, however short."
		{endpoint}
		validate={parseServiceField}
		onsaved={refreshAll}
	/>
	<Detail
		name="time_tracked"
		label="On the timer"
		value={String(s.time_tracked)}
		options={YES_NO}
		{endpoint}
		validate={parseServiceField}
		onsaved={refreshAll}
	/>
	<Detail
		name="taxable"
		label="Taxable"
		value={String(s.taxable)}
		options={YES_NO}
		{endpoint}
		validate={parseServiceField}
		onsaved={refreshAll}
	/>
</section>
