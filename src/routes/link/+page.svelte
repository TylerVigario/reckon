<script lang="ts">
	import { onMount } from 'svelte';
	import { deserialize } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		startRegistration,
		type PublicKeyCredentialCreationOptionsJSON
	} from '@simplewebauthn/browser';
	import { authClient, passkeysWork } from '#lib/auth-client.ts';
	import Authentication from '#lib/Authentication.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import type { PageProps } from './$types';

	/**
	 * Where a link reckon emailed opens (+page.server.ts). The code is after the
	 * #, which the browser never sends: read here, taken out of the address bar
	 * and the history at once, and posted. Drawn as sign-in is, outside the app.
	 */
	let { data }: PageProps = $props();

	type View =
		| { at: 'reading' }
		| { at: 'wait' }
		| { at: 'dead' }
		| { at: 'make'; purpose: 'invite' | 'reset'; name: string; email: string }
		| { at: 'made'; email: string }
		| { at: 'confirmed'; email: string }
		| { at: 'change'; name: string; email: string }
		| { at: 'changed'; email: string }
		| { at: 'taken'; email: string };
	let view = $state<View>({ at: 'reading' });
	let code = '';
	let saving = $state(false);

	const business = $derived(page.data.operator?.trading_name?.trim() || 'reckon');

	/** One of the page's actions, posted as a form would be. */
	async function act(
		name: 'look' | 'begin' | 'confirm' | 'change',
		fields: Record<string, string>
	) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const r = await fetch(`?/${name}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => null);
		return r ? deserialize(await r.text()) : null;
	}

	/** Where a refusal leaves the page: waiting, or a link that no longer works. */
	const after = (r: ReturnType<typeof deserialize> | null): View =>
		r?.type === 'failure' && r.data?.why === 'wait' ? { at: 'wait' } : { at: 'dead' };

	onMount(async () => {
		code = location.hash.slice(1);
		void replaceState(resolve('/link'), {});
		if (!code) return void (view = { at: 'dead' });
		const r = await act('look', { code });
		if (r?.type !== 'success' || !r.data) return void (view = after(r));
		const found = r.data as {
			purpose: 'invite' | 'reset' | 'confirm' | 'change';
			name: string;
			email: string;
		};
		// A change waits to be asked for: opening the link changes nothing.
		if (found.purpose === 'change')
			return void (view = { at: 'change', name: found.name, email: found.email });
		if (found.purpose === 'invite' || found.purpose === 'reset')
			return void (view = { at: 'make', ...found, purpose: found.purpose });
		const c = await act('confirm', { code });
		view = c?.type === 'success' ? { at: 'confirmed', email: found.email } : after(c);
	});

	/**
	 * A passkey made with the link: the ceremony's options from the server, the
	 * passkey made by this phone or computer, and handed to Better Auth, which
	 * keeps it, uses the link and signs them in (#lib/server/passkeys).
	 */
	let making = $state(false);
	let unmade = $state('');
	async function make() {
		if (making || view.at !== 'make') return;
		const email = view.email;
		making = true;
		unmade = '';
		const r = await act('begin', { code });
		if (r?.type !== 'success' || !r.data) {
			making = false;
			if (!r) return void (unmade = 'Not made — no connection.');
			return void (view = after(r));
		}
		let response;
		try {
			response = await startRegistration({
				optionsJSON: r.data.options as PublicKeyCredentialCreationOptionsJSON
			});
		} catch {
			// Cancelled, or this device could not make one: the link still works.
			making = false;
			return;
		}
		const kept = await authClient.$fetch<unknown>('/passkey/verify-registration', {
			method: 'POST',
			body: { response, createSession: true },
			throw: false
		});
		making = false;
		if (kept.error) return void (unmade = kept.error.message ?? 'That passkey wasn’t kept.');
		view = { at: 'made', email };
	}

	async function change(e: SubmitEvent) {
		e.preventDefault();
		if (saving || view.at !== 'change') return;
		const email = view.email;
		saving = true;
		const r = await act('change', { code });
		saving = false;
		if (r?.type === 'success') return void (view = { at: 'changed', email });
		if (r?.type === 'failure' && r.data?.why === 'taken')
			return void (view = { at: 'taken', email });
		view = after(r);
	}

	// Someone else signed in in this browser signs out before signing in as them.
	const otherHere = (email: string) =>
		data.signedInAs && data.signedInAs.email !== email ? data.signedInAs : null;
</script>

<svelte:head><title>{business}</title></svelte:head>

{#snippet signIn()}
	<p><a href={resolve('/login')}>Sign in</a></p>
{/snippet}

{#if view.at === 'reading'}
	<Authentication title="Reading your link…" role="status">
		<noscript>
			<div class="banner warn">
				<Octicon name="alert" />
				<div class="banner-m">
					<p class="banner-t">This page needs JavaScript</p>
					<p class="banner-d">
						The code in your link stays in the browser, and the page reads it there. Turn JavaScript
						on for this page, then open the link again.
					</p>
				</div>
			</div>
		</noscript>
	</Authentication>
{:else if view.at === 'make'}
	{@const other = otherHere(view.email)}
	<Authentication
		title={view.purpose === 'invite' ? `Welcome to ${business}` : 'Make a new passkey'}
	>
		<p>
			{view.purpose === 'invite'
				? `Make a passkey to sign in as ${view.email}. This phone or computer keeps it, and your fingerprint, face or screen lock unlocks it: there’s no password to choose or remember.`
				: `For ${view.email}. This phone or computer keeps it, and making it signs you out everywhere else.`}
		</p>
		{#if unmade}
			<div class="banner crit" role="alert">
				<Octicon name="alert" />
				<div class="banner-m"><p class="banner-t">{unmade}</p></div>
			</div>
		{/if}
		{#if !passkeysWork()}
			<div class="banner warn">
				<Octicon name="alert" />
				<div class="banner-m">
					<p class="banner-t">Passkeys can’t be made in this browser</p>
					<p class="banner-d">
						If you opened this link from an email or another app, open it in Chrome or Safari
						instead.
					</p>
				</div>
			</div>
		{:else}
			{#if other}
				<p class="muted">{other.name} is signed in in this browser, and is signed out first.</p>
			{/if}
			<button class="btn pri" type="button" onclick={make} aria-disabled={making || undefined}
				>{making
					? 'Making it…'
					: view.purpose === 'invite'
						? 'Make your passkey'
						: 'Make a new passkey'}</button
			>
		{/if}
	</Authentication>
{:else if view.at === 'made'}
	<Authentication title="Passkey made" role="status">
		<p>
			You’re signed in as {view.email}. From now on, sign in with this passkey: this phone or
			computer offers it when you sign in.
		</p>
		<p class="muted">
			Keep more than one, on another phone or computer or a security key, so losing one doesn’t lock
			you out.
		</p>
		<a class="btn pri" href={resolve('/')}>Open reckon</a>
		{#snippet footer()}
			<p><a href={resolve('/profile/passkeys')}>Your passkeys</a></p>
		{/snippet}
	</Authentication>
{:else if view.at === 'confirmed'}
	<Authentication title="Email confirmed" role="status">
		<p>{view.email} is confirmed as yours.</p>
		<a class="btn pri" href={data.signedInAs ? resolve('/profile') : resolve('/login')}
			>{data.signedInAs ? 'Back to your profile' : 'Sign in'}</a
		>
	</Authentication>
{:else if view.at === 'change'}
	{@const who = view.name}
	<Authentication title="Confirm your new email">
		<form onsubmit={change}>
			<p>For {view.name}. You’ll sign in to {business} as {view.email} from now on.</p>
			<button class="btn pri" type="submit" aria-disabled={saving || undefined}
				>{saving ? 'Confirming…' : 'Confirm email'}</button
			>
		</form>
		{#snippet footer()}
			<p>If you aren’t {who}, close this page. Nothing changes unless you confirm.</p>
		{/snippet}
	</Authentication>
{:else if view.at === 'changed'}
	<Authentication title="Email changed" role="status">
		<p>Sign in with {view.email} from now on. It’s confirmed as yours.</p>
		<a class="btn pri" href={data.signedInAs ? resolve('/profile') : resolve('/login')}
			>{data.signedInAs ? 'Back to your profile' : 'Sign in'}</a
		>
	</Authentication>
{:else if view.at === 'taken'}
	<Authentication title="That email is taken" role="alert" footer={signIn}>
		<p>
			Someone else signs in to {business} with {view.email} now, so it can’t be yours as well. You still
			sign in with your old one. Contact {data.contact} about it.
		</p>
	</Authentication>
{:else if view.at === 'wait'}
	<Authentication title="Too many tries from here" role="alert">
		<p>Wait a few minutes, then open the link again.</p>
	</Authentication>
{:else}
	<Authentication title="This link no longer works" role="alert" footer={signIn}>
		<p>
			It has been used already, or it has expired. To have another sent, contact {data.contact}.
		</p>
	</Authentication>
{/if}
