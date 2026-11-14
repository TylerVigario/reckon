<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { readProblem } from '#lib/json.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * Who to ask for at a site, the one who answers first heading them, each
	 * opening their own page. Added in a dialog -- somebody the client already
	 * has, or somebody new -- and the first one added answers first; each one's
	 * menu makes them answer first or takes them off this site, leaving them
	 * the client's. Someone with Field reads them, and changes nothing
	 * (#lib/access).
	 */
	let { data }: PageProps = $props();
	const s = $derived(data.site);
	const field = $derived(data.user?.access === 'field');
	const api = $derived(`/api/clients/${s.client_slug}/sites/${s.slug}/contacts`);

	let adding = $state(false);
	let picked = $state('');
	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let saying = $state('');
	let working = $state(false);
	let failed = $state('');

	function add() {
		picked = '';
		name = email = phone = saying = '';
		adding = true;
	}
	async function attach() {
		saying = '';
		const first = data.contacts.length === 0;
		const body = picked
			? { contact_id: picked, is_primary: first }
			: { name, email: email || null, phone: phone || null, is_primary: first };
		working = true;
		const r = await fetch(api, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => null);
		working = false;
		if (!r?.ok) {
			const b = r ? await readProblem(r) : null;
			saying = !b
				? 'Not added — no connection.'
				: (b.errors?.name ?? b.errors?.contact_id ?? b.detail ?? b.title ?? 'That did not save.');
			return;
		}
		adding = false;
		await refreshAll();
	}
	/** Answers first, or off this site: said where it did not happen. */
	async function change(method: 'POST' | 'DELETE', body: Record<string, unknown>) {
		failed = '';
		const r = await fetch(api, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => null);
		if (!r?.ok) {
			const b = r ? await readProblem(r) : null;
			failed = b ? (b.detail ?? 'That didn’t change.') : 'Not changed — no connection.';
		}
		await refreshAll();
	}
</script>

{#if failed}
	<div class="banner crit" role="alert">
		<Octicon name="alert" />
		<div class="banner-m"><p class="banner-t">{failed}</p></div>
	</div>
{/if}

<section class="box" aria-labelledby="ask-h">
	<div class="box-h">
		<h2 class="box-t" id="ask-h">Who to ask for</h2>
		{#if !field}<button type="button" class="btn sm" onclick={add}>Add</button>{/if}
	</div>
	{#each data.contacts as p (p.id)}
		<div class="box-row">
			<span class="who">
				<a class="n lk" href={resolve('/clients/contacts/[id]', { id: p.id })}>{p.name}</a>
				<span class="sub">{[p.email, p.phone].filter(Boolean).join(' · ') || 'No details yet'}</span
				>
			</span>
			{#if p.is_primary}<span class="lab acc">Answers first</span>{/if}
			{#if !field}
				<ActionMenu
					label="Actions for {p.name}"
					items={[
						...(p.is_primary
							? []
							: [
									{
										label: 'Answers first',
										onselect: () => void change('POST', { contact_id: p.id, is_primary: true })
									}
								]),
						{
							label: 'Take off this site',
							onselect: () => void change('DELETE', { contact_id: p.id })
						}
					]}
				/>
			{/if}
		</div>
	{:else}
		<div class="box-row blank">
			<p class="blank-t">Nobody named</p>
			<p class="muted">
				Turning up means asking for whoever is about, and the client’s own contact answers instead.
			</p>
		</div>
	{/each}
</section>

{#if !field}
	<Dialog
		open={adding}
		title="Who to ask for at {s.label}"
		go="Add"
		going="Adding…"
		{working}
		ongo={attach}
		onclose={() => (adding = false)}
	>
		<div class="form">
			{#if data.elsewhere.length}
				<div class="fc">
					<label class="fc-l" for="ask-who">Who</label>
					<select id="ask-who" class="ti" bind:value={picked}>
						<option value="">Somebody new</option>
						{#each data.elsewhere as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
					<p class="fc-c">Somebody {s.client} already has, or somebody new.</p>
				</div>
			{/if}
			{#if !picked}
				<div class="fc">
					<label class="fc-l" for="ask-name">Name<span aria-hidden="true"> *</span></label>
					<input id="ask-name" class="ti" autocomplete="off" required bind:value={name} />
				</div>
				<div class="fc">
					<label class="fc-l" for="ask-email">Email</label>
					<input id="ask-email" class="ti" type="email" autocomplete="off" bind:value={email} />
				</div>
				<div class="fc">
					<label class="fc-l" for="ask-phone">Phone</label>
					<input id="ask-phone" class="ti" type="tel" autocomplete="off" bind:value={phone} />
				</div>
			{/if}
			{#if data.contacts.length === 0}
				<p class="note">The first one added answers first.</p>
			{/if}
			{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
		</div>
	</Dialog>
{/if}

<style>
	.box-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.who {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.lab {
		flex: 0 0 auto;
	}
	/* Primer's Blankslate, in the box. */
	.blank {
		flex-direction: column;
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
	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
