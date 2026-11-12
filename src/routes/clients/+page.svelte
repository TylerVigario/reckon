<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { clientOpens, entityTabs } from '#lib/section-tabs.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const n = (v: string | null) => Number(v ?? 0);
</script>

<Top
	title="Entities"
	sub="The three things, and none owns another"
	back={resolve('/more')}
	backLabel="More"
/>

<div class="pad">
	<div class="primer">
		<UnderlineNav
			label="Entities"
			items={entityTabs('clients', {
				clients: data.clients.length,
				contacts: data.counts.contacts
			})}
		/>
	</div>

	<div class="sec">
		<div class="rows">
			{#each data.clients as c (c.id)}
				<a class="rec link" href={clientOpens(c.slug, data.user?.access)} class:gone={!c.active}>
					<div class="rec-m">
						<div class="rec-t">
							{c.name}{#if !c.active}<span class="lt"> · inactive</span>{/if}
						</div>
						<div class="rec-s">{c.site_labels ?? 'no sites'}</div>
						{#if c.contact}<div class="rec-c"><span class="chip">{c.contact}</span></div>{/if}
					</div>
					<div class="rec-n">
						{#if n(c.owed) > 0}
							<span class="rec-v">{money(c.owed)}</span>
							<span class="rec-x">{c.sites} {n(c.sites) === 1 ? 'site' : 'sites'}</span>
						{:else}
							<span class="rec-v mut">{c.sites}</span>
							<span class="rec-x">{n(c.sites) === 1 ? 'site' : 'sites'}</span>
						{/if}
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{:else}
				<div class="rec">
					<div class="rec-m"><div class="rec-t"><span class="lt">No clients yet</span></div></div>
				</div>
			{/each}
		</div>
	</div>
</div>
