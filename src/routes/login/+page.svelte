<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	let { form }: PageProps = $props();
</script>

<svelte:head><title>Sign in</title></svelte:head>

<main>
	{#if form && 'breached' in form}
		<!-- The password was right and Pwned Passwords has seen it: it has stopped (#lib/server/breach). -->
		<div class="card" role="alert">
			<h1>Choose a new password</h1>
			<p class="lede">
				That password has appeared in a data breach on another site, so it no longer works here.
				Anywhere you were signed in, you’ve been signed out.
			</p>
			<p class="lede">
				{form.breached === 'sent'
					? `We’ve emailed ${form.email} a link to choose a new one. It works once, for an hour.`
					: form.breached === 'unconfirmed'
						? `Your email hasn’t been confirmed, so we can’t send you a link to choose a new one. Contact ${form.contact} to have one sent.`
						: `To choose a new one, contact ${form.contact}.`}
			</p>
			<p class="lede">If you use it anywhere else, change it there too.</p>
			<a class="go quiet" href={resolve('/login')}>Back to sign in</a>
		</div>
	{:else}
		<form method="POST">
			<h1>Sign in</h1>
			<input type="hidden" name="next" value={page.url.searchParams.get('next') ?? ''} />

			{#if form?.message}<p class="msg">{form.message}</p>{/if}

			<label
				>Email
				<input
					name="email"
					type="email"
					autocomplete="username"
					value={form?.email ?? ''}
					required
				/>
			</label>
			<div class="pw">
				<label for="password">Password</label>
				<a class="aside" href={resolve('/forgot-password')}>Forgot password?</a>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>
			<button type="submit">Sign in</button>
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
	}
	form,
	.card {
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
	/* Forgot password? beside the label, where GitHub puts it. */
	.pw {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: baseline;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: light-dark(#5a6472, #a3adbc);
	}
	.pw input {
		grid-column: 1 / -1;
	}
	.aside {
		color: light-dark(#1f5f9e, #7fb2e5);
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
