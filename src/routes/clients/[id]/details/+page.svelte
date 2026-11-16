<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Detail from '#lib/Detail.svelte';
	import { parseClientField } from '#lib/client-fields.ts';
	import { count } from '#lib/format.ts';
	import type { PageProps } from './$types';

	/**
	 * A client's Details, each changed in place (#lib/Detail): their address in
	 * the app, how long they have to pay and how they usually do, and whether
	 * they are taxed. Each save says the version of the client this screen read,
	 * so one somebody saved since is not written over unseen.
	 *
	 * Their own terms, or none to follow the house default, which lives on
	 * Invoicing and is only named here.
	 */
	let { data }: PageProps = $props();
	const c = $derived(data.details);
	const endpoint = $derived(`/api/clients/${c.id}`);
	const again = () => refreshAll();
	const YES_NO = [
		{ value: 'false', label: 'No, taxed as usual' },
		{ value: 'true', label: 'Yes, with a certificate on file' }
	];
	const PAYS_BY = [
		{ value: '', label: 'Not recorded' },
		{ value: 'cheque', label: 'Cheque' },
		{ value: 'card', label: 'Card' },
		{ value: 'transfer', label: 'Transfer' },
		{ value: 'cash', label: 'Cash' },
		{ value: 'other', label: 'Something else' }
	];
</script>

<section class="box" aria-labelledby="who-h">
	<div class="box-h"><h2 class="box-t" id="who-h">Who they are</h2></div>
	<Detail
		name="slug"
		label="In the URL"
		value={c.slug}
		required
		{endpoint}
		ifMatch={c.version}
		onconflict={again}
		validate={parseClientField}
		onsaved={(slug) => goto(resolve('/clients/[id]/details', { id: slug }), { replace: true })}
	>
		{#snippet caption()}
			Their screens’ address. A link somebody kept stops working once it changes.
		{/snippet}
	</Detail>
</section>

<section class="box" aria-labelledby="pay-h">
	<div class="box-h"><h2 class="box-t" id="pay-h">How they pay</h2></div>
	<Detail
		name="terms_days"
		label="Terms"
		value={c.terms === null ? '' : String(c.terms)}
		shown={c.terms === null
			? `The house default of ${count(c.default_terms, 'day')}`
			: count(c.terms, 'day')}
		inputmode="numeric"
		{endpoint}
		ifMatch={c.version}
		onconflict={again}
		validate={parseClientField}
		onsaved={again}
	>
		{#snippet caption()}
			Days from the invoice date to when it is due. Empty follows the house default, set on
			<a href={resolve('/settings/invoicing')}>Invoicing</a>.
		{/snippet}
	</Detail>
	<Detail
		name="payment_method"
		label="Pays by"
		value={c.payment_method ?? ''}
		options={PAYS_BY}
		{endpoint}
		ifMatch={c.version}
		onconflict={again}
		validate={parseClientField}
		onsaved={again}
	>
		{#snippet caption()}How they usually settle, not how any one invoice was paid.{/snippet}
	</Detail>
</section>

<!-- Whether this client is taxed is its own. What it is taxed at is each site's. -->
<section class="box" aria-labelledby="tax-h">
	<div class="box-h"><h2 class="box-t" id="tax-h">Sales tax</h2></div>
	<Detail
		name="tax_exempt"
		label="Exempt"
		value={c.tax_exempt ? 'true' : 'false'}
		options={YES_NO}
		{endpoint}
		ifMatch={c.version}
		onconflict={again}
		validate={parseClientField}
		onsaved={again}
	>
		{#snippet caption()}Exempt only with a certificate recorded below.{/snippet}
	</Detail>
	<Detail
		name="exemption_certificate"
		label="Certificate"
		value={c.certificate}
		{endpoint}
		ifMatch={c.version}
		onconflict={again}
		validate={parseClientField}
		onsaved={again}
	>
		{#snippet caption()}CDTFA needs this to support an untaxed sale.{/snippet}
	</Detail>
</section>
