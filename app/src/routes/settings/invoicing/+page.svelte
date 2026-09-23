<script lang="ts">
	import Top from '$lib/Top.svelte';
	import Setting from '$lib/Setting.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const o = $derived(data.operator);
</script>

<Top
	title="Invoicing"
	sub="Numbering, terms and delivery"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>Numbering</h2></div>
		<div class="rows inset">
			<div class="pair">
				<Setting
					name="invoice_number_format"
					label="Format"
					value={o?.invoice_number_format ?? '0000000'}
					hint="A zero is where the number goes"
				/>
				<Setting
					name="next_invoice_number"
					label="Next number"
					value={o?.next_invoice_number ?? 1}
					inputmode="numeric"
					hint={Number(data.issued) > 0 ? `${data.issued} has gone out` : 'nothing issued yet'}
				/>
			</div>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Defaults</h2></div>
		<div class="rows inset">
			<div class="pair">
				<Setting
					name="default_terms_days"
					label="Payment terms"
					value={o?.default_terms_days ?? 14}
					inputmode="numeric"
					hint="Overridable per client"
				/>
				<Setting
					name="ageing_alert_days"
					label="Ageing alert"
					value={o?.ageing_alert_days ?? 21}
					inputmode="numeric"
					hint="Unbilled work older than this is raised"
				/>
			</div>
			<Setting
				name="auto_send"
				label="Auto-send"
				value={o?.auto_send ? 'true' : 'false'}
				options={[
					{ value: 'false', label: 'Drafts are built and wait for a person' },
					{ value: 'true', label: 'Send as soon as a draft is built' }
				]}
			/>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>What the client receives</h2></div>
		<div class="rows inset">
			<Setting
				name="email_attaches_pdf"
				label="Attach the PDF to the email"
				value={o?.email_attaches_pdf ? 'true' : 'false'}
				options={[
					{ value: 'true', label: 'Attached, so it can be read and filed' },
					{ value: 'false', label: 'Linked only' }
				]}
			/>
			<Setting
				name="email_includes_payment_link"
				label="Include a payment link"
				value={o?.email_includes_payment_link ? 'true' : 'false'}
				options={[
					{ value: 'true', label: 'Include one' },
					{ value: 'false', label: 'Leave it out' }
				]}
			/>
			<Setting
				name="invoice_footer"
				label="Footer — printed on every invoice"
				value={o?.invoice_footer}
				placeholder="Cheques payable to…"
			/>
		</div>
	</div>
</div>

<style>
</style>
