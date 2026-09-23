<script lang="ts">
	import { goto } from '$app/navigation';
	import Top from '$lib/Top.svelte';
	import Setting from '$lib/Setting.svelte';
	import { parseClientField } from '$lib/client-fields';
	import { day, pct } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const c = $derived(data.client);
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

	// An area's line: how many of this client's places sit in it, and when
	// CDTFA last said so.
	const levy = (l: {
		sites: string;
		priced_on: string | null;
		state_rate_pct: string;
		district_rate_pct: string;
	}) =>
		[
			Number(l.district_rate_pct) > 0
				? `${Number(l.state_rate_pct).toFixed(3)}% state + ${Number(l.district_rate_pct).toFixed(
						3
					)}% district`
				: `${Number(l.state_rate_pct).toFixed(3)}% state, no district`,
			`${l.sites} ${Number(l.sites) === 1 ? 'site' : 'sites'}`,
			`priced ${day(l.priced_on)}`
		].join(' · ');

	const where = $derived(
		data.sites.n === 0
			? 'Nowhere recorded, so no rate resolves and no mileage can be computed'
			: `${data.sites.n} ${data.sites.n === 1 ? 'place' : 'places'}${
					data.sites.towns ? ` · ${data.sites.towns}` : ''
				}`
	);

	// One area to be taxed in, name it. Several, say how many -- a client
	// working in Kings and Tulare has two answers, and printing one would be
	// this screen inventing a fact.
	const sub = $derived(
		[
			c.contact,
			data.levies.length === 0
				? null
				: data.levies.length === 1
					? [data.levies[0].name, pct(data.levies[0].rate_pct)].filter(Boolean).join(' ')
					: `${data.levies.length} levies`
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<Top title={c.name} {sub} back={resolve('/clients')} backLabel="Entities" />

<div class="pad">
	<div class="tiles">
		<div class="tile">
			<span class="k">Owed</span>
			<span class="v">{money(c.owed)}</span>
			<span class="s">{c.out} {Number(c.out) === 1 ? 'invoice' : 'invoices'} out</span>
		</div>
		{#if data.agreement}
			<div class="tile">
				<span class="k">Retainer</span>
				<span class="v sm">{money(data.agreement.price)}</span>
				<span class="s">
					per {data.agreement.interval === 'monthly' ? 'month' : data.agreement.interval},
					{data.agreement.allotment === 'unlimited'
						? 'unlimited'
						: `${Number(data.agreement.hours).toFixed(0)} h`}
				</span>
			</div>
		{/if}
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
				hint="Days from the invoice date to when it is due. Empty uses the house default."
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
					<div class="rec-t">Invoices go to</div>
					<div class="rec-s">
						{c.contact ?? 'Nobody named — an invoice has no one to send it to'}
					</div>
				</div>
				<div class="rec-n">
					<span class="rec-v mut">{c.contact ? '' : '—'}</span>
				</div>
			</div>
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">Unapplied credit</div>
					<div class="rec-s">Theirs to spend against the next invoice</div>
				</div>
				<div class="rec-n"><span class="rec-v mut">{money(c.credit)}</span></div>
			</div>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Where</h2></div>
		<div class="rows">
			<a
				class="rec link"
				class:warn={data.sites.unchecked > 0}
				href={resolve('/clients/[id]/sites', { id: c.slug })}
			>
				<div class="rec-m">
					<div class="rec-t">Sites</div>
					<div class="rec-s">{where}</div>
					{#if data.sites.unchecked}
						<div class="rec-c">
							<span class="chip warn">
								<span class="dot"></span>{data.sites.unchecked} priced over 90 days ago
							</span>
						</div>
					{/if}
				</div>
				<div class="rec-n">
					<span class="rec-v mut">{data.sites.n}</span>
					{#if data.sites.miles}
						<span class="rec-x">up to {Number(data.sites.miles).toFixed(0)} mi</span>
					{/if}
				</div>
				<span class="arw" aria-hidden="true">›</span>
			</a>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h">
			<h2>Tax</h2>
			<span class="sp"></span>
			<span class="chip">From CDTFA, per address</span>
			{#if c.rules === 'us_ca'}<span class="chip">US · CA rules</span>{/if}
		</div>
		<div class="rows">
			{#each data.levies as l (l.name)}
				<div class="rec" class:warn={l.stale}>
					<div class="rec-m">
						<div class="rec-t">{l.name}</div>
						<div class="rec-s">{levy(l)}</div>
					</div>
					<div class="rec-n">
						{#if l.rate_pct}
							<span class="rec-v">{pct(l.rate_pct)}</span>
						{:else}
							<span class="rec-v mut">—</span>
						{/if}
					</div>
				</div>
			{:else}
				<div class="rec warn">
					<div class="rec-m">
						<div class="rec-t">Charged at</div>
						<div class="rec-s">No site on file, so there is no address to price</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">—</span></div>
				</div>
			{/each}
		</div>
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
</div>
