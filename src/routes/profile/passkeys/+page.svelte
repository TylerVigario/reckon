<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { authClient, passkeysWork } from '#lib/auth-client.ts';
	import { clock, datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import Octicon from '#lib/Octicon.svelte';
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
		await refreshAll();
	}
</script>

<svelte:head><title>Passkeys</title></svelte:head>

{#if data.offer && data.available && usable}
	<!-- Signed in from another device: a passkey for this one, offered once,
	     as Primer's Banner with its actions. -->
	<div class="banner info" role="status">
		<Octicon name="info" />
		<div class="banner-m">
			<p class="banner-t">Make a passkey for this device</p>
			<p class="banner-d">
				You signed in with a passkey from another device. Make one here, and next time this one
				signs you in by itself.
			</p>
			<div class="acts">
				<button
					type="button"
					class="btn pri"
					onclick={add}
					{@attach busy(adding && 'Making a passkey')}>Make a passkey</button
				>
				<button type="button" class="btn" onclick={() => location.assign(data.next)}>Not now</button
				>
			</div>
		</div>
	</div>
{/if}

{#if said}
	<div class="banner crit" role="alert">
		<Octicon name="alert" />
		<div class="banner-m"><p class="banner-t">{said}</p></div>
	</div>
{/if}
{#if form?.removed}
	<div class="banner good" role="status">
		<Octicon name="checkCircle" />
		<div class="banner-m"><p class="banner-t">{form.removed} was removed.</p></div>
	</div>
{/if}

<section class="box" aria-labelledby="passkeys-h">
	<div class="box-h">
		<h2 class="box-t" id="passkeys-h">Your passkeys</h2>
	</div>
	{#each data.passkeys as p (p.id)}
		<div class="box-row">
			{#if renaming === p.id}
				<form
					method="POST"
					action="?/rename"
					class="fc rename"
					use:enhance={() =>
						async ({ update }) => {
							renaming = null;
							await update();
						}}
				>
					<input type="hidden" name="id" value={p.id} />
					<label class="fc-l" for="name-{p.id}">Name</label>
					<div class="ie">
						<input
							id="name-{p.id}"
							class="ti"
							name="name"
							value={p.named ? p.label : ''}
							placeholder={p.keeper ?? ''}
							required
							maxlength="100"
						/>
						<button type="submit" class="btn">Save</button>
						<button type="button" class="btn" onclick={() => (renaming = null)}>Cancel</button>
					</div>
				</form>
			{:else}
				<span class="who">
					<span class="n">{p.label}</span>
					<span class="e"
						>{p.keeper && p.keeper !== p.label ? `${p.keeper} · ` : ''}{p.synced
							? 'Synced between your devices'
							: 'On one device'}</span
					>
					<span class="e"
						>Added {when(p.created)} · {p.lastUsed
							? `Last used ${when(p.lastUsed)}${p.lastFrom ? `, from ${p.lastFrom}` : ''}`
							: 'Not used to sign in yet'}</span
					>
					{#if form?.message && form.id === p.id}
						<span class="fc-e" role="alert"><Octicon name="alert" />{form.message}</span>
					{/if}
				</span>
				<div class="acts">
					<button type="button" class="btn sm" onclick={() => (renaming = p.id)}>Rename</button>
					<form method="POST" action="?/remove" use:enhance>
						<input type="hidden" name="id" value={p.id} />
						<button type="submit" class="btn sm danger">Remove</button>
					</form>
				</div>
			{/if}
		</div>
	{:else}
		<div class="box-row">
			<span class="muted">
				None. You sign in with a passkey: without one, you’ll need a new link to sign in again.
			</span>
		</div>
	{/each}
</section>

{#if !data.available}
	<p class="note">
		Passkeys aren’t set up on this server: it needs SITE_URL, the address reckon is reached at.
	</p>
{:else if !usable}
	<div class="banner warn">
		<Octicon name="alert" />
		<div class="banner-m">
			<p class="banner-t">Passkeys can’t be made in this browser</p>
			<p class="banner-d">
				If you opened reckon from an email or another app, open it in Chrome or Safari instead.
			</p>
		</div>
	</div>
{:else if !data.offer}
	<div class="add">
		<button type="button" class="btn" onclick={add} {@attach busy(adding && 'Making a passkey')}
			>Add a passkey</button
		>
		<p class="note">
			{data.passkeys.length === 1
				? 'It’s your only one. Add another, on another phone or computer or a security key, so losing it doesn’t lock you out.'
				: 'Add one for each phone or computer you sign in on, or keep them in one passkey manager that syncs between them.'}
		</p>
	</div>
{/if}

<style>
	.box-row {
		display: flex;
		align-items: center;
		gap: var(--base-size-12);
		min-height: 64px;
		box-sizing: border-box;
	}
	/* The name and its lines take the row; Rename and Remove stay beside them,
	   at its end. */
	.who {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--base-size-2);
	}
	.n {
		font-weight: var(--base-text-weight-semibold);
	}
	.e {
		font-size: var(--text-body-size-small);
		color: var(--fgColor-muted);
		overflow-wrap: anywhere;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--base-size-8);
	}
	/* Renaming: the field across the row, Save and Cancel beside it, under it
	   where there is no room. */
	.rename {
		flex: 1 1 auto;
	}
	.ie {
		display: flex;
		flex-wrap: wrap;
		gap: var(--base-size-8);
	}
	.ie .ti {
		flex: 1 1 14rem;
		width: auto;
		min-width: 0;
	}
	.add {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--base-size-8);
	}
</style>
