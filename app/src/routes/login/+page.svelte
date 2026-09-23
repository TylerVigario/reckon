<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	let { form }: PageProps = $props();
</script>

<svelte:head><title>Sign in</title></svelte:head>

<main>
	<form method="POST">
		<h1>Sign in</h1>
		<input type="hidden" name="next" value={page.url.searchParams.get('next') ?? ''} />

		{#if form?.message}<p class="msg">{form.message}</p>{/if}

		<label
			>Email
			<input name="email" type="email" autocomplete="username" value={form?.email ?? ''} required />
		</label>
		<label
			>Password
			<input name="password" type="password" autocomplete="current-password" required />
		</label>
		<button type="submit">Sign in</button>
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
		background: #eff1f4;
		color: #14181f;
	}
	@media (prefers-color-scheme: dark) {
		:global(body) {
			background: #14171c;
			color: #e8ebf0;
		}
	}
	main {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 1.5rem;
	}
	form {
		width: min(22rem, 100%);
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
	button {
		font: 600 1rem/1 inherit;
		min-height: 3.2rem;
		border: 0;
		border-radius: 8px;
		background: #2e3a68;
		color: #fff;
		cursor: pointer;
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
