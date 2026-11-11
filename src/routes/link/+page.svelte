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

<main>
	<noscript>
		<div class="card">
			<h1>This page needs JavaScript</h1>
			<p class="lede">
				The code in your link stays in the browser, and the page reads it there. Turn JavaScript on
				for this page, then open the link again.
			</p>
		</div>
	</noscript>

	{#if view.at === 'reading'}
		<p class="lede" role="status">Reading your link…</p>
	{:else if view.at === 'make'}
		{@const other = otherHere(view.email)}
		<div class="card">
			<h1>{view.purpose === 'invite' ? `Welcome to ${business}` : 'Make a new passkey'}</h1>
			<p class="lede">
				{view.purpose === 'invite'
					? `Make a passkey to sign in as ${view.email}. This phone or computer keeps it, and your fingerprint, face or screen lock unlocks it: there’s no password to choose or remember.`
					: `For ${view.email}. This phone or computer keeps it, and making it signs you out everywhere else.`}
			</p>
			{#if unmade}<p class="msg" role="alert">{unmade}</p>{/if}
			{#if !passkeysWork()}
				<p class="lede">
					Passkeys can’t be made in this browser. If you opened this link from an email or another
					app, open it in Chrome or Safari instead.
				</p>
			{:else}
				{#if other}
					<p class="lede">{other.name} is signed in in this browser, and is signed out first.</p>
				{/if}
				<button type="button" onclick={make} disabled={making}
					>{making
						? 'Making it…'
						: view.purpose === 'invite'
							? 'Make your passkey'
							: 'Make a new passkey'}</button
				>
			{/if}
		</div>
	{:else if view.at === 'made'}
		<div class="card" role="status">
			<h1>Passkey made</h1>
			<p class="lede">
				You’re signed in as {view.email}. From now on, sign in with this passkey: this phone or
				computer offers it when you sign in.
			</p>
			<p class="lede">
				Keep more than one, on another phone or computer or a security key, so losing one doesn’t
				lock you out.
			</p>
			<a class="go" href={resolve('/')}>Open reckon</a>
			<a class="go quiet" href={resolve('/profile/passkeys')}>Your passkeys</a>
		</div>
	{:else if view.at === 'confirmed'}
		<div class="card" role="status">
			<h1>Email confirmed</h1>
			<p class="lede">{view.email} is confirmed as yours.</p>
			<a class="go" href={data.signedInAs ? resolve('/profile') : resolve('/login')}
				>{data.signedInAs ? 'Back to your profile' : 'Sign in'}</a
			>
		</div>
	{:else if view.at === 'change'}
		<form onsubmit={change}>
			<h1>Confirm your new email</h1>
			<p class="lede">
				For {view.name}. You’ll sign in to {business} as {view.email} from now on.
			</p>
			<button type="submit" disabled={saving}>{saving ? 'Confirming…' : 'Confirm email'}</button>
			<p class="hint">
				If you aren’t {view.name}, close this page. Nothing changes unless you confirm.
			</p>
		</form>
	{:else if view.at === 'changed'}
		<div class="card" role="status">
			<h1>Email changed</h1>
			<p class="lede">Sign in with {view.email} from now on. It’s confirmed as yours.</p>
			<a class="go" href={data.signedInAs ? resolve('/profile') : resolve('/login')}
				>{data.signedInAs ? 'Back to your profile' : 'Sign in'}</a
			>
		</div>
	{:else if view.at === 'taken'}
		<div class="card" role="alert">
			<h1>That email is taken</h1>
			<p class="lede">
				Someone else signs in to {business} with {view.email} now, so it can’t be yours as well. You still
				sign in with your old one. Contact {data.contact} about it.
			</p>
			<a class="go quiet" href={resolve('/login')}>Sign in</a>
		</div>
	{:else if view.at === 'wait'}
		<div class="card" role="alert">
			<h1>Too many tries from here</h1>
			<p class="lede">Wait a few minutes, then open the link again.</p>
		</div>
	{:else}
		<div class="card" role="alert">
			<h1>This link no longer works</h1>
			<p class="lede">
				It has been used already, or it has expired. To have another sent, contact {data.contact}.
			</p>
			<a class="go quiet" href={resolve('/login')}>Sign in</a>
		</div>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		font:
			16px/1.5 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		background: light-dark(#eff1f4, #14171c);
		color: light-dark(#14181f, #e8ebf0);
	}
	main {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 1.5rem;
		box-sizing: border-box;
	}
	form,
	.card {
		width: min(22rem, 100%);
		display: grid;
		gap: 0.9rem;
		padding: 1.5rem;
		border-radius: 12px;
		background: light-dark(#fff, #1d2128);
		border: 1px solid light-dark(#d9dee6, #2f353f);
		box-sizing: border-box;
	}
	h1 {
		margin: 0 0 0.2rem;
		font-size: 1.2rem;
		letter-spacing: -0.01em;
	}
	.lede,
	.hint {
		margin: 0;
		font-size: 0.88rem;
		color: light-dark(#5a6472, #a3adbc);
	}
	button,
	.go {
		display: grid;
		place-items: center;
		/* The family is the page's: inherit is the whole of a font shorthand or no part of it. */
		font: inherit;
		font-size: 1rem;
		font-weight: 600;
		line-height: 1;
		min-height: 3.2rem;
		border: 0;
		border-radius: 8px;
		background: #273142;
		color: #fff;
		text-decoration: none;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.7;
		cursor: progress;
	}
	.go.quiet {
		background: transparent;
		color: inherit;
		border: 1px solid light-dark(#d9dee6, #2f353f);
	}
	.msg {
		margin: 0;
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		font-size: 0.88rem;
		color: #b3462e;
		background: color-mix(in srgb, #b3462e 13%, transparent);
	}
</style>
