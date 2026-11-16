<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { authClient, autofillWorks, passkeysWork } from '#lib/auth-client.ts';
	import { safeNext } from '#lib/safe-next.ts';
	import Authentication from '#lib/Authentication.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const business = $derived(page.data.operator?.trading_name?.trim() || 'reckon');

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

<Authentication title="Sign in to {business}">
	{#if said}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{said}</p></div>
		</div>
	{/if}
	{#if usable}
		<!-- Enter in the email field opens the passkey dialog, as the button does:
		     there is nothing else to submit. -->
		<form
			onsubmit={(e) => {
				e.preventDefault();
				if (!busy) void withPasskey(false);
			}}
		>
			<div class="fc">
				<label class="fc-l" for="email">Email</label>
				<input id="email" class="ti" name="email" type="email" autocomplete="username webauthn" />
			</div>
			<button class="btn pri" type="submit" aria-disabled={busy || undefined}>
				Sign in with a passkey
			</button>
		</form>
	{:else}
		<!-- Nothing here can be done without one, so there is no form to fill. -->
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t">Passkeys can’t be used in this browser</p>
				<p class="banner-d">
					If you opened reckon from an email or another app, open it in Chrome or Safari instead.
				</p>
			</div>
		</div>
	{/if}
	{#snippet footer()}
		<p>Can’t sign in? Contact {data.contact}.</p>
	{/snippet}
</Authentication>
