<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { authClient, passkeysWork } from '#lib/auth-client.ts';
	import { clock, datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * Your own passkeys (+page.server.ts). Adding one is the browser's ceremony
	 * against Better Auth's routes; naming and removing are this page's actions.
	 */
	let { data, form }: PageProps = $props();

	let usable = $state(true);
	let adding = $state(false);
	let said = $state('');
	let renaming = $state<string | null>(null);

	onMount(() => (usable = passkeysWork()));

	const when = (iso: string) => `${datedAt(iso, personalZone())}, ${clock(iso, personalZone())}`;

	async function add() {
		if (adding) return;
		adding = true;
		said = '';
		const r = await authClient.passkey.addPasskey();
		adding = false;
		if (r?.error) {
			const quiet = ['AUTH_CANCELLED', 'ERROR_CEREMONY_ABORTED'];
			if (!quiet.includes(String('code' in r.error ? r.error.code : '')))
				said = r.error.message ?? 'That passkey wasn’t kept.';
			return;
		}
		// Where they were headed, which safeNext has already held to this site.
		if (data.offer) return void location.assign(data.next);
		await invalidateAll();
	}
</script>

<svelte:head><title>Passkeys</title></svelte:head>

{#if data.offer && data.available && usable}
	<div class="sec offer">
		<h2>Make a passkey for this device</h2>
		<p class="lede">
			You signed in with a passkey from another device. Make one here, and next time this one signs
			you in by itself.
		</p>
		<div class="acts">
			<button type="button" class="btn pri" onclick={add} disabled={adding}
				>{adding ? 'Making it…' : 'Make a passkey'}</button
			>
			<button type="button" class="btn gho" onclick={() => location.assign(data.next)}
				>Not now</button
			>
		</div>
	</div>
{/if}

{#if said}<p class="msg" role="alert">{said}</p>{/if}
{#if form?.removed}<p class="msg good" role="status">{form.removed} was removed.</p>{/if}

<div class="sec">
	<div class="sec-h"><h2>Your passkeys</h2></div>
	{#if data.passkeys.length === 0}
		<p class="lede">
			None. You sign in with a passkey: without one, you’ll need a new link to sign in again.
		</p>
	{:else}
		<div class="rows">
			{#each data.passkeys as p (p.id)}
				<div class="rec">
					<div class="rec-m">
						{#if renaming === p.id}
							<form
								method="POST"
								action="?/rename"
								class="rename"
								use:enhance={() =>
									async ({ update }) => {
										renaming = null;
										await update();
									}}
							>
								<input type="hidden" name="id" value={p.id} />
								<label
									>Name
									<input
										name="name"
										value={p.named ? p.label : ''}
										placeholder={p.keeper ?? ''}
										required
										maxlength="100"
									/>
								</label>
								<button type="submit" class="btn sm">Save</button>
								<button type="button" class="btn sm gho" onclick={() => (renaming = null)}
									>Cancel</button
								>
							</form>
						{:else}
							<div class="rec-t">{p.label}</div>
						{/if}
						<div class="rec-s">
							{p.keeper && p.keeper !== p.label ? `${p.keeper} · ` : ''}{p.synced
								? 'Synced between your devices'
								: 'On one device'}
						</div>
						<div class="rec-s">
							Added {when(p.created)} · {p.lastUsed
								? `Last used ${when(p.lastUsed)}${p.lastFrom ? `, from ${p.lastFrom}` : ''}`
								: 'Not used to sign in yet'}
						</div>
						{#if form?.message && form.id === p.id}
							<div class="rec-s no" role="alert">{form.message}</div>
						{/if}
					</div>
					{#if renaming !== p.id}
						<div class="acts">
							<button type="button" class="btn sm gho" onclick={() => (renaming = p.id)}
								>Rename</button
							>
							<form method="POST" action="?/remove" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<button type="submit" class="btn sm gho">Remove</button>
							</form>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if !data.available}
	<p class="lede">
		Passkeys aren’t set up on this server: it needs SITE_URL, the address reckon is reached at.
	</p>
{:else if !usable}
	<p class="lede">
		Passkeys can’t be made in this browser. If you opened reckon from an email or another app, open
		it in Chrome or Safari instead.
	</p>
{:else if !data.offer}
	<button type="button" class="btn" onclick={add} disabled={adding}
		>{adding ? 'Making it…' : 'Add a passkey'}</button
	>
	<p class="lede">
		{data.passkeys.length === 1
			? 'It’s your only one. Add another, on another phone or computer or a security key, so losing it doesn’t lock you out.'
			: 'Add one for each phone or computer you sign in on, or keep them in one passkey manager that syncs between them.'}
	</p>
{/if}

<style>
	.offer {
		padding: 1rem;
		border-radius: 12px;
		border: 1px solid var(--line, #d9dee6);
	}
	.offer h2 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
	}
	.lede {
		margin: 0.4rem 0;
		color: var(--muted, #5a6472);
		font-size: 0.9rem;
	}
	.acts {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.rename {
		display: flex;
		gap: 0.5rem;
		align-items: end;
		flex-wrap: wrap;
	}
	.rename label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.8rem;
	}
	.msg {
		margin: 0.5rem 0;
	}
</style>
