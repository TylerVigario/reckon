<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	/**
	 * Forgot password (+page.server.ts): the email they sign in with, then one
	 * answer whatever it was. A form without script, as sign-in is.
	 */
	let { form }: PageProps = $props();
	const business = $derived(page.data.operator?.trading_name?.trim() || 'reckon');
</script>

<svelte:head><title>Forgot your password?</title></svelte:head>

<main>
	{#if form && 'asked' in form}
		<div class="card" role="status">
			<h1>Check your email</h1>
			<p class="lede">
				If {form.asked} is an address someone signs in to {business} with, we’ve emailed it. The link
				in it works once, for an hour.
			</p>
			<p class="lede">Your password hasn’t changed. It still works until you choose a new one.</p>
			<a class="go quiet" href={resolve('/login')}>Back to sign in</a>
		</div>
	{:else if form?.why === 'wait'}
		<div class="card" role="alert">
			<h1>Too many tries from here</h1>
			<p class="lede">Wait a few minutes, then ask again.</p>
			<a class="go quiet" href={resolve('/login')}>Back to sign in</a>
		</div>
	{:else}
		<form method="POST">
			<h1>Forgot your password?</h1>
			<p class="lede">
				Enter the email you sign in with, and we’ll send you a link to choose a new password.
			</p>
			{#if form?.why === 'email'}
				<p class="msg" id="why" role="alert">Enter the email you sign in with.</p>
			{/if}
			<label
				>Email
				<input
					name="email"
					type="email"
					autocomplete="username"
					value={form?.why === 'email' ? form.email : ''}
					aria-invalid={form?.why === 'email' ? 'true' : undefined}
					aria-describedby={form?.why === 'email' ? 'why' : undefined}
					required
				/>
			</label>
			<button type="submit">Send link</button>
			<a class="go quiet" href={resolve('/login')}>Back to sign in</a>
		</form>
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
	.lede {
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
