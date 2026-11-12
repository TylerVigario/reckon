<script lang="ts">
	import Top from '#lib/Top.svelte';
	import RecordHead from '#lib/RecordHead.svelte';
	import { money } from '#lib/money.svelte.ts';
	import type { Tab } from '#lib/section-tabs.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	/**
	 * One client, as a record: their name heading it, whether they are worked
	 * for and what they owe under it, then their tabs, each its own address --
	 * Details, their billing, tax, retainer and recent invoices; Sites, where
	 * the work is; Contacts, whom to ask for and send the invoices to. Someone
	 * with Field has Sites and Contacts, and nothing of what a client owes
	 * (#lib/access).
	 *
	 * A site, and the forms that add one or a contact, are screens of their
	 * own under the client, with their own heads.
	 */
	let { data, children }: LayoutProps = $props();

	const c = $derived(data.client);
	const field = $derived(data.user?.access === 'field');
	const id = $derived({ id: c.slug });
	const TABBED = ['/clients/[id]', '/clients/[id]/sites', '/clients/[id]/contacts'];
	const tabbed = $derived(TABBED.includes(page.route.id ?? ''));
	const tabs = $derived<Tab[]>([
		...(field
			? []
			: [
					{
						href: resolve('/clients/[id]', id),
						label: 'Details',
						current: page.route.id === '/clients/[id]'
					}
				]),
		{
			href: resolve('/clients/[id]/sites', id),
			label: 'Sites',
			count: data.counts.sites,
			current: page.route.id === '/clients/[id]/sites'
		},
		{
			href: resolve('/clients/[id]/contacts', id),
			label: 'Contacts',
			count: data.counts.contacts,
			current: page.route.id === '/clients/[id]/contacts'
		}
	]);
	const owes = $derived(
		c.owed === null
			? null
			: Number(c.owed) > 0
				? `${money(c.owed)} owed · ${c.out} ${Number(c.out) === 1 ? 'invoice' : 'invoices'} out`
				: 'Nothing owed'
	);
</script>

{#if tabbed}
	<Top title={c.name} back={resolve('/clients')} backLabel="Entities" />

	<div class="pad">
		<RecordHead label="{c.name}’s record" {tabs}>
			{#snippet state()}
				<span class="lab {c.active ? 'good' : ''}">{c.active ? 'Active' : 'Inactive'}</span>
				{#if owes}<span class="muted">{owes}</span>{/if}
			{/snippet}
		</RecordHead>

		{@render children()}
	</div>
{:else}
	{@render children()}
{/if}
