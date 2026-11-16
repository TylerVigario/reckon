<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import { parseField } from '#lib/settings-fields.ts';
	import { count } from '#lib/format.ts';
	import type { PageProps } from './$types';

	/**
	 * How invoices are numbered, when they fall due, and how they reach a
	 * client, each changed in place (#lib/Detail). How they reach a client is
	 * kept, and nothing reads it yet: the box says so.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.operator);
	const endpoint = '/api/settings';
	const again = () => refreshAll();
	const days = (n: number | null | undefined, or: number) => count(n ?? or, 'day');
</script>

<Top
	title="Invoicing"
	sub="Numbering, terms and delivery"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<section class="box" aria-labelledby="num-h">
		<div class="box-h"><h2 class="box-t" id="num-h">Numbering</h2></div>
		<Detail
			name="invoice_number_format"
			label="Format"
			value={o?.invoice_number_format ?? 'INV-0000'}
			{endpoint}
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}A zero is where the number goes.{/snippet}
		</Detail>
		<Detail
			name="next_invoice_number"
			label="Next number"
			value={String(o?.next_invoice_number ?? 1)}
			hint={Number(data.issued) > 0 ? `${data.issued} is the highest used` : 'None used yet'}
			inputmode="numeric"
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
	</section>

	<section class="box" aria-labelledby="terms-h">
		<div class="box-h"><h2 class="box-t" id="terms-h">Terms</h2></div>
		<Detail
			name="default_terms_days"
			label="Payment terms"
			value={String(o?.default_terms_days ?? 30)}
			shown={days(o?.default_terms_days, 30)}
			inputmode="numeric"
			{endpoint}
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}Days from the invoice date to when it is due. A client can have its own.{/snippet}
		</Detail>
		<Detail
			name="ageing_alert_days"
			label="Ageing alert"
			value={String(o?.ageing_alert_days ?? 30)}
			shown={days(o?.ageing_alert_days, 30)}
			inputmode="numeric"
			{endpoint}
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}Days. Unbilled work older than this is raised.{/snippet}
		</Detail>
	</section>

	<section class="box" aria-labelledby="send-h">
		<div class="box-h">
			<h2 class="box-t" id="send-h">Delivery</h2>
			<span class="lab">Not in use yet</span>
		</div>
		<Detail
			name="auto_send"
			label="Sending"
			value={o?.auto_send ? 'true' : 'false'}
			options={[
				{ value: 'false', label: 'Drafts wait for a person' },
				{ value: 'true', label: 'Sent as soon as a draft is built' }
			]}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="email_attaches_pdf"
			label="The PDF"
			value={o?.email_attaches_pdf ? 'true' : 'false'}
			options={[
				{ value: 'true', label: 'Attached, to be read and filed' },
				{ value: 'false', label: 'Linked only' }
			]}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="email_includes_payment_link"
			label="Payment link"
			value={o?.email_includes_payment_link ? 'true' : 'false'}
			options={[
				{ value: 'true', label: 'Included' },
				{ value: 'false', label: 'Left out' }
			]}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="invoice_footer"
			label="Footer"
			value={o?.invoice_footer ?? null}
			placeholder="Cheques payable to…"
			{endpoint}
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}At the foot of a printed invoice.{/snippet}
		</Detail>
	</section>
</div>
