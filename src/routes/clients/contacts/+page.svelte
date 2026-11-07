<script lang="ts">
	import Top from '#lib/Top.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	let { data }: PageProps = $props();
</script>

<Top
	title="Contacts"
	sub="People cross entities and locations both"
	back={resolve('/clients')}
	backLabel="Entities"
/>

<div class="pad">
	<div class="sec">
		<div class="rows">
			{#each data.contacts as c (c.id)}
				<a class="rec link" href={resolve('/clients/contacts/[id]', { id: c.id })}>
					<div class="rec-m">
						<div class="rec-t">{c.name}</div>
						<div class="rec-s">
							{[c.email, c.phone, c.note].filter(Boolean).join(' · ') || 'no details on file'}
						</div>
						{#if c.clients.length || c.sites.length}
							<div class="rec-c">
								{#each c.primary_for as who (who)}
									<span class="chip acc">gets invoices · {who}</span>
								{/each}
								{#each c.clients.filter((x) => !c.primary_for.includes(x)) as who (who)}
									<span class="chip">{who}</span>
								{/each}
								{#each c.sites as site (site)}<span class="chip">{site}</span>{/each}
							</div>
						{/if}
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{:else}
				<div class="rec">
					<div class="rec-m"><div class="rec-t"><span class="lt">No contacts yet</span></div></div>
				</div>
			{/each}
		</div>
	</div>
</div>
