<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { clientOpens, entityTabs } from '#lib/section-tabs.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const n = (v: string | null) => Number(v ?? 0);
	const full = $derived(data.user?.access === 'full');
</script>

<Top
	title="Entities"
	sub="The three things, and none owns another"
	back={resolve('/more')}
	backLabel="More"
/>

<div class="pad primer">
	<UnderlineNav
		label="Entities"
		items={entityTabs('clients', {
			clients: data.clients.length,
			contacts: data.counts.contacts
		})}
	/>

	<section class="box" aria-labelledby="clients-h">
		<div class="box-h"><h2 class="box-t" id="clients-h">Clients</h2></div>
		{#each data.clients as c (c.id)}
			<a class="box-row" href={clientOpens(c.slug, data.user?.access)}>
				<span class="what">
					<span class="n">{c.name}</span>
					<span class="sub">{c.site_labels ?? 'No sites'}</span>
					{#if full && c.contact}<span class="sub">Invoices go to {c.contact}</span>{/if}
				</span>
				{#if !c.active}<span class="lab">Inactive</span>{/if}
				{#if n(c.owed) > 0}
					<span class="fig">
						<span class="v">{money(c.owed)}</span>
						<span class="sub">owed</span>
					</span>
				{/if}
			</a>
		{:else}
			<p class="box-row muted">No clients yet.</p>
		{/each}
	</section>
</div>

<style>
	.box-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		box-sizing: border-box;
		margin: 0;
	}
	.what {
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
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
</style>
