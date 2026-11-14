<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { entityTabs } from '#lib/section-tabs.ts';
	import { names } from '#lib/format.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	let { data }: PageProps = $props();
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
		items={entityTabs('contacts', {
			clients: data.counts.clients,
			contacts: data.contacts.length
		})}
	/>

	<section class="box" aria-labelledby="contacts-h">
		<div class="box-h"><h2 class="box-t" id="contacts-h">Contacts</h2></div>
		{#each data.contacts as c (c.id)}
			<a class="box-row" href={resolve('/clients/contacts/[id]', { id: c.id })}>
				<span class="what">
					<span class="n">{c.name}</span>
					<span class="sub">
						{[c.email, c.phone, c.note].filter(Boolean).join(' · ') || 'No details yet'}
					</span>
					{#if c.clients.length}
						<span class="sub">
							{[
								...c.clients.map((who) =>
									c.primary_for.includes(who) ? `${who}, gets its invoices` : who
								),
								...(c.sites.length ? [`at ${names(c.sites)}`] : [])
							].join(' · ')}
						</span>
					{/if}
				</span>
			</a>
		{:else}
			<p class="box-row muted">No contacts yet.</p>
		{/each}
	</section>
</div>

<style>
	.box-row {
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
</style>
