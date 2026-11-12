<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { readProblem } from '#lib/json.ts';
	import { names } from '#lib/format.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * A client's Contacts: their people, each opening their own page, and who
	 * of them the invoices go to. Someone with Field reads them, to know whom
	 * to ask for, and changes nothing (#lib/access).
	 */
	let { data }: PageProps = $props();

	const c = $derived(data.client);
	const field = $derived(data.user?.access === 'field');
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
</script>

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
						<button type="button" class="ib" aria-label="Change who gets invoices" onclick={choose}
							><Octicon name="pencil" /></button
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

<style>
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
