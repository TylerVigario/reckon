<script lang="ts">
	import { onMount } from 'svelte';
	import { deserialize } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
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
		| { at: 'choose'; purpose: 'invite' | 'reset'; name: string; email: string }
		| { at: 'saved'; email: string }
		| { at: 'confirmed'; email: string };
	let view = $state<View>({ at: 'reading' });
	let code = '';
	let password = $state('');
	let confirm = $state('');
	let refused = $state<{ field: 'password' | 'confirm'; message: string } | null>(null);
	let saving = $state(false);

	const business = $derived(page.data.operator?.trading_name?.trim() || 'reckon');

	/** One of the page's actions, posted as a form would be. */
	async function act(name: 'look' | 'choose' | 'confirm', fields: Record<string, string>) {
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
			purpose: 'invite' | 'reset' | 'confirm';
			name: string;
			email: string;
		};
		if (found.purpose !== 'confirm')
			return void (view = { at: 'choose', ...found, purpose: found.purpose });
		const c = await act('confirm', { code });
		view = c?.type === 'success' ? { at: 'confirmed', email: found.email } : after(c);
	});

	async function choose(e: SubmitEvent) {
		e.preventDefault();
		if (saving || view.at !== 'choose') return;
		saving = true;
		const r = await act('choose', { code, password, confirm });
		saving = false;
		if (r?.type === 'success') {
			view = { at: 'saved', email: view.email };
			password = confirm = '';
			return;
		}
		if (r?.type === 'failure' && r.data?.why === 'password')
			return void (refused = r.data as { field: 'password' | 'confirm'; message: string });
		if (!r) return void (refused = { field: 'password', message: 'Not saved — no connection.' });
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
	{:else if view.at === 'choose'}
		<form onsubmit={choose} novalidate>
			<h1>{view.purpose === 'reset' ? 'Choose a new password' : `Welcome to ${business}`}</h1>
			<p class="lede">
				{view.purpose === 'reset'
					? `For ${view.email}. Your old password no longer works.`
					: `Choose a password to sign in as ${view.email}.`}
			</p>
			{#if refused}<p class="msg" id="why" role="alert">{refused.message}</p>{/if}
			<!-- Who it is for, so a password manager saves it against the right sign-in. -->
			<input type="hidden" name="username" autocomplete="username" value={view.email} />
			<label
				>{view.purpose === 'reset' ? 'New password' : 'Password'}
				<input
					name="password"
					type="password"
					autocomplete="new-password"
					minlength={data.min}
					maxlength={data.max}
					bind:value={password}
					aria-invalid={refused?.field === 'password' ? 'true' : undefined}
					aria-describedby={refused?.field === 'password' ? 'why' : 'hint'}
					required
				/>
			</label>
			<label
				>Confirm password
				<input
					name="confirm"
					type="password"
					autocomplete="new-password"
					bind:value={confirm}
					aria-invalid={refused?.field === 'confirm' ? 'true' : undefined}
					aria-describedby={refused?.field === 'confirm' ? 'why' : undefined}
					required
				/>
			</label>
			<p class="hint" id="hint">At least {data.min} characters.</p>
			<button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save password'}</button>
		</form>
	{:else if view.at === 'saved'}
		{@const other = otherHere(view.email)}
		<div class="card" role="status">
			<h1>Password saved</h1>
			<p class="lede">Sign in with {view.email} and the password you just chose.</p>
			{#if other}
				<p class="lede">
					{other.name} is signed in in this browser, and signs out first.
				</p>
				<form class="bare" method="POST" action="/logout">
					<button type="submit">Sign out, then sign in</button>
				</form>
			{:else}
				<a class="go" href={resolve('/login')}>Sign in</a>
			{/if}
		</div>
	{:else if view.at === 'confirmed'}
		<div class="card" role="status">
			<h1>Email confirmed</h1>
			<p class="lede">{view.email} is confirmed as yours.</p>
			<a class="go" href={data.signedInAs ? resolve('/profile') : resolve('/login')}
				>{data.signedInAs ? 'Back to your profile' : 'Sign in'}</a
			>
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
				It has been used already, or it’s more than 24 hours old. Ask whoever sent it to send
				another.
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
	form:not(.bare),
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
	.bare {
		display: grid;
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
	input[aria-invalid='true'] {
		border-color: #b3462e;
	}
	button,
	.go {
		display: grid;
		place-items: center;
		font: 600 1rem/1 inherit;
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
