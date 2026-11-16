<script lang="ts">
	import { enhance } from '$app/forms';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { busy } from '#lib/busy.svelte.ts';

	let { data, form }: PageProps = $props();
	let testing = $state(false);
	const when = (iso: string | null | undefined) => (iso ? datedAt(iso, personalZone()) : null);
</script>

<Top
	title="Integrations"
	sub="Payments, ledger, PDF and email"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<section class="box" aria-labelledby="int-h">
		<div class="box-h"><h2 class="box-t" id="int-h">Integrations</h2></div>
		{#each data.integrations as i (i.name)}
			<div class="box-row int">
				<div class="top">
					<span class="what">
						<span class="n">{i.title}</span>
						<span class="sub">{i.sub}{i.detail ? ` · ${i.detail}` : ''}</span>
					</span>
					{#if i.connected}
						<span class="lab good">Connected</span>
					{:else}
						<span class="lab">Not connected</span>
					{/if}
				</div>
				{#if i.connected && i.checked_at}
					<p class="said">{i.name === 'email' ? 'Last sent' : 'Proven'} {when(i.checked_at)}.</p>
				{/if}
				{#if i.name === 'email' && data.emailFailing}
					<p class="said warn">
						<Octicon name="alert" />{data.emailFailing.waiting ? 'Waiting since' : 'Last failed'}
						{when(data.emailFailing.at)}. The relay said: {data.emailFailing.said}
					</p>
				{/if}
				{#if i.name === 'email' && i.connected}
					<form
						class="test"
						method="POST"
						action="?/test"
						use:enhance={() => {
							testing = true;
							return async ({ update }) => {
								await update();
								testing = false;
							};
						}}
					>
						<button class="btn sm" type="submit" {@attach busy(testing && 'Sending a test email')}
							>Send a test email</button
						>
						{#if form?.tested}
							<p class="said" role="status">
								{form.tested.sent
									? `Sent to ${form.tested.to}. Check that it arrived.`
									: `Not sent. ${form.tested.said}`}
							</p>
						{/if}
					</form>
				{/if}
			</div>
		{/each}
	</section>

	{#if data.mapping.length}
		<section class="box" aria-labelledby="map-h">
			<div class="box-h"><h2 class="box-t" id="map-h">Account mapping</h2></div>
			{#each data.mapping as m (m.role)}
				<div class="box-row kv">
					<span class="kv-l">{m.role.replace(/_/g, ' ')}</span>
					<span class="kv-v"><span>{m.account}</span></span>
				</div>
			{/each}
		</section>
	{/if}
</div>

<style>
	.int {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
		overflow-wrap: anywhere;
	}
	.lab {
		flex: 0 0 auto;
	}
	.said {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		font-size: 12px;
		color: var(--fgColor-muted);
		overflow-wrap: anywhere;
	}
	.said.warn {
		color: var(--fgColor-attention);
	}
	.test {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
	}
</style>
