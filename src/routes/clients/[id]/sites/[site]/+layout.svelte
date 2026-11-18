<script lang="ts">
	import Top from '#lib/Top.svelte';
	import RecordHead from '#lib/RecordHead.svelte';
	import Day from '#lib/Day.svelte';
	import { hours, pct } from '#lib/format.ts';
	import { clientOpens } from '#lib/section-tabs.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	/**
	 * A site, as Primer draws a record: what it is called, under it the tax
	 * charged there and how long has been worked there, then its tabs, each its
	 * own address -- Details, where it is and how far; Contacts, who to ask for;
	 * Tax, the area it is in and what is levied there. A rate not confirmed this
	 * quarter, or a site in no area where the business collects, is said on
	 * every tab.
	 */
	let { data, children }: LayoutProps = $props();
	const s = $derived(data.site);
	const at = $derived({ id: s.client_slug, site: s.slug });
	const tabs = $derived([
		{
			href: resolve('/clients/[id]/sites/[site]', at),
			label: 'Details',
			current: page.route.id === '/clients/[id]/sites/[site]'
		},
		{
			href: resolve('/clients/[id]/sites/[site]/contacts', at),
			label: 'Contacts',
			count: data.people,
			current: page.route.id === '/clients/[id]/sites/[site]/contacts'
		},
		{
			href: resolve('/clients/[id]/sites/[site]/tax', at),
			label: 'Tax',
			current: page.route.id === '/clients/[id]/sites/[site]/tax'
		}
	]);
	const entries = $derived(Number(data.worked.entries));
</script>

<Top
	title={s.label}
	trail={[
		{ href: resolve('/clients'), label: 'Entities' },
		{ href: clientOpens(s.client_slug, data.user?.access), label: s.client },
		{ href: resolve('/clients/[id]/sites', { id: s.client_slug }), label: 'Sites' }
	]}
/>

<div class="pad">
	<RecordHead label="{s.label}’s record" {tabs}>
		{#snippet state()}
			{#if !s.active}<span class="lab">Closed</span>{/if}
			{#if s.stale}<span class="lab warn">Rate not confirmed this quarter</span>{/if}
			{#if s.collected && s.rate_pct === null}<span class="lab warn">In no tax area yet</span>{/if}
			<span class="muted">
				{s.rate_pct !== null ? `${pct(s.rate_pct)} tax` : s.collected ? 'No rate' : 'Not taxed'} ·
				{#if entries}
					{hours(data.worked.hours, 'glance')} worked{#if data.worked.last}, last <Day
							iso={data.worked.last}
						/>{/if}
				{:else}
					never worked
				{/if}
			</span>
		{/snippet}
	</RecordHead>

	{@render children()}
</div>
