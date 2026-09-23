<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const n = (v: string) => Number(v);
</script>

<Top
	title="Entities"
	sub="The three things, and none owns another"
	back={resolve('/more')}
	backLabel="More"
/>

<div class="pad">
	<div class="sec">
		<div class="rows">
			<a class="rec link" href={resolve('/clients/contacts')}>
				<div class="rec-m">
					<div class="rec-t">Contacts</div>
					<div class="rec-s">People, who cross clients and sites both</div>
				</div>
				<div class="rec-n"><span class="rec-v mut">{data.counts.contacts}</span></div>
				<span class="arw" aria-hidden="true">›</span>
			</a>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h">
			<h2>Clients</h2>
			{#if n(data.counts.unpriced) > 0}
				<span class="sp"></span>
				<span class="chip warn">
					<span class="dot"></span>{data.counts.unpriced} rate{n(data.counts.unpriced) === 1
						? ''
						: 's'} over 90 days old
				</span>
			{/if}
		</div>
		<div class="rows">
			{#each data.clients as c (c.id)}
				<a class="rec link" href={resolve('/clients/[id]', { id: c.slug })} class:gone={!c.active}>
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
