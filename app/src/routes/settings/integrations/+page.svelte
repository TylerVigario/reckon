<script lang="ts">
	import Top from '$lib/Top.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const when = (iso: string | null | undefined) =>
		iso
			? new Date(iso).toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric'
				})
			: null;
</script>

<Top
	title="Integrations"
	sub="Payments, ledger, PDF and email"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="sec">
		<div class="rows">
			{#each data.integrations as i (i.name)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{i.title}</div>
						<div class="rec-s">
							{i.sub}{i.detail ? ` · ${i.detail}` : ''}
						</div>
						<div class="rec-c">
							{#if i.connected}
								<span class="chip good"><span class="dot"></span>Connected</span>
								{#if i.checked_at}<span class="chip">proven {when(i.checked_at)}</span>{/if}
							{:else}
								<span class="chip">not connected</span>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>

	{#if data.mapping.length}
		<div class="sec">
			<div class="sec-h"><h2>Account mapping</h2></div>
			<div class="rows">
				{#each data.mapping as m (m.role)}
					<div class="rec">
						<div class="rec-m"><div class="rec-t">{m.role.replace(/_/g, ' ')}</div></div>
						<div class="rec-n"><span class="rec-v mut">{m.account}</span></div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
