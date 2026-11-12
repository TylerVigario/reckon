<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { CONTACT_FIELDS } from '#lib/contact-fields.ts';
	import { parseAll } from '#lib/field-rules.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';

	/**
	 * Adding a contact to a client, as Team adds a person: a Primer form, each
	 * label above its field, the one that must be filled in marked with an
	 * asterisk, and Add contact at the bottom with Cancel beside it. They can
	 * be who the client's invoices go to from the start; with nobody yet, that
	 * is ticked already. Adding them goes back to the client's
	 * Contacts, where they are listed.
	 */
	let { data }: PageProps = $props();
	const back = $derived(resolve('/clients/[id]/contacts', { id: data.client.slug }));

	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let note = $state('');
	let bills = $state(untrack(() => data.bills === null));
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});
	let problem = $state('');

	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (saving) return;
		const fields = { name, email, phone, note };
		errors = parseAll(CONTACT_FIELDS, fields).errors;
		problem = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`/api/clients/${data.client.slug}/contacts`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...fields, is_primary: bills })
		}).catch(() => null);
		if (!r?.ok) {
			saving = false;
			const p = r ? await readProblem(r) : null;
			if (p?.errors) errors = p.errors;
			else problem = p ? (p.detail ?? 'They weren’t added.') : 'Not added — no connection.';
			return;
		}
		await goto(back);
	}
</script>

{#snippet wrong(key: string)}
	{#if errors[key]}
		<p class="fc-e" id="n-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<Top title="Add contact" {back} backLabel={data.client.name} />

<div class="pad primer">
	<form class="box" onsubmit={add} novalidate>
		<div class="box-row form">
			<div class="fc">
				<label class="fc-l" for="n-name">Name<span aria-hidden="true"> *</span></label>
				<input
					id="n-name"
					class="ti"
					autocomplete="off"
					required
					bind:value={name}
					aria-invalid={errors.name ? 'true' : undefined}
					aria-describedby={errors.name ? 'n-name-e' : undefined}
				/>
				{@render wrong('name')}
			</div>
			<div class="fc">
				<label class="fc-l" for="n-email">Email</label>
				<input
					id="n-email"
					class="ti"
					type="email"
					autocomplete="off"
					bind:value={email}
					aria-invalid={errors.email ? 'true' : undefined}
					aria-describedby={errors.email ? 'n-email-e' : undefined}
				/>
				{@render wrong('email')}
			</div>
			<div class="fc">
				<label class="fc-l" for="n-phone">Phone</label>
				<input
					id="n-phone"
					class="ti"
					type="tel"
					autocomplete="off"
					bind:value={phone}
					aria-invalid={errors.phone ? 'true' : undefined}
					aria-describedby={errors.phone ? 'n-phone-e' : undefined}
				/>
				{@render wrong('phone')}
			</div>
			<div class="fc">
				<label class="fc-l" for="n-note">Note</label>
				<input
					id="n-note"
					class="ti"
					autocomplete="off"
					bind:value={note}
					aria-invalid={errors.note ? 'true' : undefined}
					aria-describedby={errors.note ? 'n-note-e' : 'n-note-c'}
				/>
				{#if errors.note}
					{@render wrong('note')}
				{:else}
					<p class="fc-c" id="n-note-c">What they do, or when to call.</p>
				{/if}
			</div>
			<label class="rad">
				<input type="checkbox" bind:checked={bills} />
				<span>
					<span class="rad-t">Send {data.client.name}’s invoices to them</span>
					<span class="rad-c">
						{data.bills ? `Instead of ${data.bills}.` : 'Nobody gets them yet.'}
					</span>
				</span>
			</label>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" disabled={saving}
				>{saving ? 'Adding…' : 'Add contact'}</button
			>
			<a class="btn" href={back}>Cancel</a>
			{#if problem}
				<p class="fc-e"><Octicon name="alert" />{problem}</p>
			{/if}
		</div>
	</form>
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fc,
	.rad {
		max-width: 440px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--surface-2);
	}
</style>
