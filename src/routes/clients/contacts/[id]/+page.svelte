<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import { parseContactField } from '#lib/contact-fields.ts';
	import { names } from '#lib/format.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { clientOpens } from '#lib/section-tabs.ts';
	import type { PageProps } from './$types';

	/**
	 * One contact, as Team draws a person: their details, and under them the
	 * clients they act for, each opening that client.
	 *
	 * THIS IS WHERE A CONTACT'S DETAILS CHANGE, one at a time (#lib/Detail). A
	 * client and a site name them and link here.
	 *
	 * Someone with Field reads them, and changes nothing (#lib/access).
	 */
	let { data }: PageProps = $props();
	const p = $derived(data.person);
	const field = $derived(data.user?.access === 'field');
	const billed = $derived(data.clients.filter((c) => c.bills).map((c) => c.name));
	const endpoint = $derived(`/api/contacts/${p.id}`);
</script>

{#snippet sentHere()}{names(billed)}’s invoices are sent here.{/snippet}

<Top title={p.name} back={resolve('/clients/contacts')} backLabel="Contacts" />

<div class="pad primer">
	<section class="box" aria-labelledby="details-h">
		<div class="box-h"><h2 class="box-t" id="details-h">Details</h2></div>
		<Detail
			name="name"
			label="Name"
			value={p.name}
			required
			editable={!field}
			{endpoint}
			validate={parseContactField}
			onsaved={() => refreshAll()}
		/>
		<Detail
			name="email"
			label="Email"
			type="email"
			value={p.email}
			editable={!field}
			{endpoint}
			validate={parseContactField}
			onsaved={() => refreshAll()}
			caption={billed.length ? sentHere : undefined}
		/>
		<Detail
			name="phone"
			label="Phone"
			type="tel"
			value={p.phone}
			editable={!field}
			{endpoint}
			validate={parseContactField}
			onsaved={() => refreshAll()}
		/>
		<Detail
			name="note"
			label="Note"
			value={p.note}
			editable={!field}
			{endpoint}
			validate={parseContactField}
			onsaved={() => refreshAll()}
		>
			{#snippet caption()}What they do, or when to call.{/snippet}
		</Detail>
	</section>

	<section class="box" aria-labelledby="for-h">
		<div class="box-h"><h2 class="box-t" id="for-h">Clients</h2></div>
		{#each data.clients as c (c.slug)}
			<a class="box-row" href={clientOpens(c.slug, data.user?.access)}>
				<span class="who">
					<span class="n">{c.name}</span>
					{#if c.sites.length}<span class="sub">At {names(c.sites)}</span>{/if}
				</span>
				{#if c.bills}<span class="lab">Gets invoices</span>{/if}
			</a>
		{:else}
			<p class="box-row muted">No client yet.</p>
		{/each}
	</section>
</div>

<style>
	.box-row {
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.n {
		font-weight: 600;
	}
	.who {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.lab {
		flex: 0 0 auto;
	}
</style>
