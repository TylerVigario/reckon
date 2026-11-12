<script lang="ts">
	import { goto } from '$app/navigation';
	import Setting from '#lib/Setting.svelte';
	import { parseClientField } from '#lib/client-fields.ts';
	import { count, day } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const c = $derived(data.client);
	// The client's own terms, or empty to follow the house default, which lives
	// on Invoicing and is only named here.
	const termsHint = $derived(
		`Days from the invoice date to when it is due. Empty follows the house default of ${count(c.default_terms, 'day')}, set on`
	);
	// One version for the row, shared by every field on it: a save by any
	// field moves it, and the next field to save sends the new one.
	//
	// Seeded once and then advanced by saves -- but re-seeded whenever the
	// loader runs again, because a reload means the row was read afresh and
	// the version held here is the old one. Without that, anything that
	// invalidates the page (adding a contact, say) would leave every field
	// sending a version the row no longer has, and the next save would be
	// refused as stale by its own page.
	let version = $derived(c.version);
	const api = $derived(`/api/clients/${c.id}`);
</script>

<!-- Full's alone: someone with Field opens a client on Sites (#lib/access). -->
<div class="tiles">
	{#each data.agreements as ag (ag.id)}
		<a class="tile link" href={resolve('/catalogue/agreements/[id]', { id: ag.id })}>
			<span class="k">{ag.site ? `Retainer · ${ag.site}` : 'Retainer'}</span>
			<span class="v sm">{money(ag.price)}</span>
			<span class="s">
				{[
					`per ${ag.interval === 'monthly' ? 'month' : ag.interval}`,
					`this month ${[ag.given ? 'given freely' : null, ag.covers ?? 'covers no service']
						.filter(Boolean)
						.join(', ')}`
				].join(' · ')}
			</span>
		</a>
	{:else}
		<a class="tile link" href="{resolve('/catalogue/agreements/new')}?client={c.slug}">
			<span class="k">Retainer</span>
			<span class="v sm">None</span>
			<span class="s">Make an agreement ›</span>
		</a>
	{/each}
</div>

<div class="sec">
	<div class="sec-h"><h2>Billing</h2></div>
	<div class="rows inset">
		<Setting
			name="slug"
			label="In the URL"
			value={c.slug}
			endpoint={api}
			{version}
			onversion={(v) => (version = v)}
			validate={parseClientField}
			hint="Renaming the client leaves this alone, so a link somebody kept keeps working"
			onsaved={(slug) => goto(resolve('/clients/[id]', { id: slug }), { replaceState: true })}
			required
		/>
		<Setting
			name="terms_days"
			label="Terms"
			value={c.terms ?? ''}
			endpoint={api}
			{version}
			onversion={(v) => (version = v)}
			validate={parseClientField}
			inputmode="numeric"
			hint={termsHint}
			more={{ href: resolve('/settings/invoicing'), label: 'Invoicing' }}
		/>
		<Setting
			name="payment_method"
			label="Pays by"
			value={c.payment_method ?? ''}
			endpoint={api}
			{version}
			onversion={(v) => (version = v)}
			validate={parseClientField}
			options={[
				{ value: '', label: 'Not recorded' },
				{ value: 'cheque', label: 'Cheque' },
				{ value: 'card', label: 'Card' },
				{ value: 'transfer', label: 'Transfer' },
				{ value: 'cash', label: 'Cash' },
				{ value: 'other', label: 'Something else' }
			]}
			hint="How they usually settle, not how any one invoice was paid"
		/>
	</div>
	<div class="rows">
		<div class="rec">
			<div class="rec-m">
				<div class="rec-t">Unapplied credit</div>
				<div class="rec-s">Theirs to spend against the next invoice</div>
			</div>
			<div class="rec-n"><span class="rec-v mut">{money(c.credit)}</span></div>
		</div>
	</div>
</div>

<!-- Whether this client is taxed is its own. What it is taxed at is each site's. -->
<div class="sec">
	<div class="sec-h"><h2>Tax</h2></div>
	<div class="rows inset">
		<Setting
			name="tax_exempt"
			label="Exempt from sales tax"
			value={c.tax_exempt ? 'true' : 'false'}
			endpoint={api}
			{version}
			onversion={(v) => (version = v)}
			validate={parseClientField}
			options={[
				{ value: 'false', label: 'No, taxed as usual' },
				{ value: 'true', label: 'Yes, with a certificate on file' }
			]}
		/>
		<Setting
			name="exemption_certificate"
			label="Certificate"
			value={c.certificate ?? ''}
			endpoint={api}
			{version}
			onversion={(v) => (version = v)}
			validate={parseClientField}
			hint="CDTFA needs this to support an untaxed sale"
		/>
	</div>
</div>

{#if data.recent.length}
	<div class="sec">
		<div class="sec-h"><h2>Recent</h2></div>
		<div class="rows">
			{#each data.recent as i (i.id)}
				<a class="rec link" href={resolve('/invoices/[id]', { id: i.id })}>
					<div class="rec-m">
						<div class="rec-t">{i.number}</div>
						<div class="rec-s">{i.status === 'draft' ? 'Draft' : 'Sent'} {day(i.on)}</div>
					</div>
					<div class="rec-n"><span class="rec-v">{money(i.gross)}</span></div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{/each}
		</div>
	</div>
{/if}

<style>
	/* A tile that opens what it summarises. */
	.tile.link {
		color: inherit;
		text-decoration: none;
	}
</style>
