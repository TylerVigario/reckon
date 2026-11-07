<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import Setting from '#lib/Setting.svelte';
	import { readProblem } from '#lib/json.ts';
	import { parseClientField } from '#lib/client-fields.ts';
	import { count, day, daysAgo, miles, names, pct, rateParts } from '#lib/format.ts';
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
	// Someone with Field reads where a client is, and nothing they owe (#lib/access).
	const field = $derived(data.user?.access === 'field');
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

	// Who the invoices go to: one of the client's people, picked in a dialog
	// as GitHub changes a default branch. Their details are on their own page.
	const bills = $derived(data.contacts.find((p) => p.bills) ?? null);
	let picking = $state(false);
	let pick = $state('');
	let working = $state(false);
	let pickError = $state('');
	function choose() {
		pick = bills?.id ?? '';
		pickError = '';
		picking = true;
	}
	async function billTo() {
		if (!pick || pick === bills?.id) return void (picking = false);
		working = true;
		const r = await fetch(`${api}/contacts`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ contact_id: pick, is_primary: true })
		}).catch(() => null);
		working = false;
		if (!r?.ok) {
			const problem = r ? await readProblem(r) : null;
			pickError = problem
				? (problem.detail ?? 'That didn’t change.')
				: 'Not changed — no connection.';
			return;
		}
		picking = false;
		await refreshAll();
	}

	// An area's line: how many of this client's places sit in it, and when
	// CDTFA last said so.
	const levy = (l: {
		sites: string;
		priced_on: string | null;
		state_rate_pct: string;
		district_rate_pct: string;
	}) =>
		[
			rateParts(l.state_rate_pct, l.district_rate_pct),
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
	// working in Tuolumne and Sacramento has two answers, and printing one would be
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
	<!-- What a client owes, has agreed to and is billed by are Full's (#lib/access). -->
	{#if !field}
		<div class="tiles">
			<div class="tile">
				<span class="k">Owed</span>
				<span class="v">{money(c.owed)}</span>
				<span class="s">{c.out} {Number(c.out) === 1 ? 'invoice' : 'invoices'} out</span>
			</div>
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
	{/if}

	<div class="primer">
		<section class="box" aria-labelledby="contacts-h">
			<div class="box-h">
				<h2 class="box-t" id="contacts-h">Contacts</h2>
				{#if !field && data.contacts.length}
					<a class="btn sm" href={resolve('/clients/[id]/contacts/new', { id: c.slug })}
						>Add contact</a
					>
				{/if}
			</div>
			{#if data.contacts.length}
				{#if !field}
					<div class="box-row kv">
						<span class="kv-l">Invoices go to</span>
						<span class="kv-v">
							{#if bills}
								<span>{bills.name}</span>
								<span class="sub">{bills.email ?? 'No email yet'}</span>
							{:else}
								<span>Nobody yet</span>
								<span class="sub">An invoice has no one to go to.</span>
							{/if}
						</span>
						<span class="end">
							<button
								type="button"
								class="ib"
								aria-label="Change who gets invoices"
								onclick={choose}><Octicon name="pencil" /></button
							>
						</span>
					</div>
				{/if}
				{#each data.contacts as p (p.id)}
					<a class="box-row" href={resolve('/clients/contacts/[id]', { id: p.id })}>
						<span class="who">
							<span class="n">{p.name}</span>
							<span class="sub">{[p.email, p.phone].filter(Boolean).join(' · ')}</span>
						</span>
						{#if p.sites.length}<span class="at">At {names(p.sites)}</span>{/if}
					</a>
				{/each}
			{:else}
				<div class="box-row blank">
					<p class="blank-t">No contacts yet</p>
					{#if !field}
						<p class="muted">Add someone to send this client’s invoices to.</p>
						<a class="btn pri sm" href={resolve('/clients/[id]/contacts/new', { id: c.slug })}
							>Add contact</a
						>
					{/if}
				</div>
			{/if}
		</section>

		{#if !field}
			<Dialog
				open={picking}
				title="Who gets {c.name}’s invoices?"
				go="Update"
				going="Updating…"
				{working}
				ongo={billTo}
				onclose={() => (picking = false)}
			>
				<fieldset class="fc">
					<legend class="fc-l">Invoices go to</legend>
					{#each data.contacts as p (p.id)}
						<label class="rad">
							<input type="radio" name="bills" value={p.id} bind:group={pick} />
							<span>
								<span class="rad-t">{p.name}</span>
								<span class="rad-c">{p.email ?? 'No email yet. Add one on their page.'}</span>
							</span>
						</label>
					{/each}
				</fieldset>
				{#if pickError}
					<p class="fc-e"><Octicon name="alert" />{pickError}</p>
				{/if}
			</Dialog>
		{/if}
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
								<span class="dot"></span>{data.sites.unchecked} priced over {daysAgo(90)}
							</span>
						</div>
					{/if}
				</div>
				<div class="rec-n">
					<span class="rec-v mut">{data.sites.n}</span>
					{#if data.sites.miles}
						<span class="rec-x">up to {miles(data.sites.miles, 'distance')}</span>
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
		{#if !field}
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
		{/if}
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

<style>
	/* A tile that opens what it summarises. */
	.tile.link {
		color: inherit;
		text-decoration: none;
	}

	/* Contacts, drawn to Primer (#lib/primer.css) ahead of the rest of the page. */
	.box-row {
		min-height: 56px;
		box-sizing: border-box;
	}
	.kv {
		display: grid;
		grid-template-columns: minmax(0, 30%) minmax(0, 1fr) auto;
		align-items: center;
		gap: 4px 16px;
	}
	.kv-l,
	.n {
		font-weight: 600;
	}
	.kv-v,
	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.kv-v {
		color: var(--ink-2);
	}
	.who {
		flex: 1 1 auto;
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
	.at {
		flex: 0 1 auto;
		color: var(--ink-2);
		text-align: right;
	}
	.end {
		display: flex;
		justify-content: flex-end;
		min-width: 32px;
	}
	.blank {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 32px 16px;
		text-align: center;
	}
	.blank-t {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}
	.blank .muted {
		margin: 0;
	}
	/* Label above value on a phone, the pencil beside both. */
	@media (max-width: 543px) {
		.kv {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.kv-l {
			grid-column: 1;
			grid-row: 1;
		}
		.kv-v {
			grid-column: 1;
			grid-row: 2;
		}
		.end {
			grid-column: 2;
			grid-row: 1 / span 2;
		}
	}
</style>
