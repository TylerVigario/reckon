<script lang="ts">
	import { enhance } from '$app/forms';
	import Top from '#lib/Top.svelte';
	import { datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

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
								{#if i.checked_at}<span class="chip"
										>{i.name === 'email' ? 'last sent' : 'proven'} {when(i.checked_at)}</span
									>{/if}
							{:else}
								<span class="chip">not connected</span>
							{/if}
							{#if i.name === 'email' && data.emailFailing}
								<span class="chip warn"
									>{data.emailFailing.waiting ? 'waiting since' : 'last failed'}
									{when(data.emailFailing.at)}</span
								>
							{/if}
						</div>
						{#if i.name === 'email' && data.emailFailing}
							<p class="said">The relay said: {data.emailFailing.said}</p>
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
								<button class="btn" type="submit" disabled={testing}>
									{testing ? 'Sending…' : 'Send a test email'}
								</button>
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

<style>
	.said {
		margin: 6px 0 0;
		font-size: 13.5px;
		color: var(--ink-2);
		overflow-wrap: anywhere;
	}
	.test {
		margin-top: 10px;
		display: grid;
		gap: 4px;
		justify-items: start;
	}
</style>
