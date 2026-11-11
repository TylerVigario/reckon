<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { authClient, autofillWorks, passkeysWork } from '#lib/auth-client.ts';
	import { safeNext } from '#lib/safe-next.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	// Signing in with a passkey happens here in the browser, against Better
	// Auth's own routes (#lib/server/auth-paths): the browser offers saved
	// passkeys as the email field is filled, where it can (autofill), and the
	// button opens its passkey dialog, with a phone or a security key besides.
	// Nothing about the address typed is looked up.
	let usable = $state(true);
	let busy = $state(false);
	let said = $state('');

	async function withPasskey(autoFill: boolean) {
		if (!autoFill) {
			busy = true;
			said = '';
		}
		const r = await authClient.signIn.passkey({ autoFill, returnWebAuthnResponse: true });
		busy = false;
		if (r.error) {
			// Cancelling, or the dialog taking over from autofill, is nothing to say.
			const quiet = [
				'AUTH_CANCELLED',
				'ERROR_CEREMONY_ABORTED',
				'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'
			];
			if (!quiet.includes(String('code' in r.error ? r.error.code : '')) && r.error.message)
				said = r.error.message;
			else if (!autoFill) said = '';
			return;
		}
		const next = safeNext(page.url.searchParams.get('next'), page.url.origin);
		// Signed in with a passkey from another device -- a phone's, by its QR code,
		// or a security key -- where this one could keep one of its own: offered one
		// for it, so next time this device signs in by itself (FIDO's design
		// guidelines, a passkey offered after a cross-device sign-in).
		const elsewhere =
			(r as { webauthn?: { response?: { authenticatorAttachment?: string | null } } }).webauthn
				?.response?.authenticatorAttachment === 'cross-platform';
		const here = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(
			() => false
		);
		location.assign(
			elsewhere && here
				? `/profile/passkeys?offer=this-device&next=${encodeURIComponent(next)}`
				: next
		);
	}

	onMount(() => {
		usable = passkeysWork();
		void autofillWorks().then((yes) => {
			if (yes) void withPasskey(true);
		});
	});
</script>

<svelte:head><title>Sign in</title></svelte:head>

<main>
	<!-- Enter in the email field opens the passkey dialog, as the button does:
	     there is nothing else to submit. -->
	<form
		onsubmit={(e) => {
			e.preventDefault();
			if (usable) void withPasskey(false);
		}}
	>
		<h1>Sign in</h1>
		{#if said}<p class="msg" role="alert">{said}</p>{/if}
		<label
			>Email
			<input name="email" type="email" autocomplete="username webauthn" />
		</label>
		{#if usable}
			<button type="submit" disabled={busy}>Sign in with a passkey</button>
		{:else}
			<p class="lede">
				Passkeys can’t be used in this browser. If you opened reckon from an email or another app,
				open it in Chrome or Safari instead.
			</p>
		{/if}
		<p class="lede help">Can’t sign in? Contact {data.contact}.</p>
	</form>
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
	}
	form {
		width: min(22rem, 100%);
		box-sizing: border-box;
		display: grid;
		gap: 0.9rem;
		padding: 1.5rem;
		border-radius: 12px;
		background: light-dark(#fff, #1d2128);
		border: 1px solid light-dark(#d9dee6, #2f353f);
	}
	h1 {
		margin: 0 0 0.2rem;
		font-size: 1.2rem;
		letter-spacing: -0.01em;
	}
	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: light-dark(#5a6472, #a3adbc);
	}
	input {
		font: inherit;
		min-height: 3rem;
		padding: 0.6rem 0.7rem;
		border-radius: 8px;
		border: 1px solid light-dark(#d9dee6, #2f353f);
		background: light-dark(#eff1f4, #14171c);
		color: inherit;
	}
	.lede {
		margin: 0;
		font-size: 0.88rem;
		color: light-dark(#5a6472, #a3adbc);
	}
	button {
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
		opacity: 0.6;
		cursor: default;
	}
	.help {
		text-align: center;
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
