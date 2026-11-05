<script lang="ts">
	import type { PageProps } from './$types';

	/**
	 * Choosing a password of their own, after signing in with one handed to
	 * them: the first time, or after a reset. Drawn as the sign-in page is,
	 * outside the app, since nothing in it opens until they have.
	 */
	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Choose a new password</title></svelte:head>

<main>
	<form method="POST">
		<h1>Choose a new password</h1>
		<p class="lede">You signed in with a temporary password. Choose your own to continue.</p>

		{#if form?.message}<p class="msg" id="why">{form.message}</p>{/if}

		<!-- Who it is for, so a password manager saves it against the right sign-in. -->
		<input type="hidden" name="username" autocomplete="username" value={data.email} />
		<label
			>New password
			<input
				name="password"
				type="password"
				autocomplete="new-password"
				minlength={data.min}
				aria-invalid={form?.field === 'password' ? 'true' : undefined}
				aria-describedby={form?.field === 'password' ? 'why' : 'hint'}
				required
			/>
		</label>
		<label
			>Confirm new password
			<input
				name="confirm"
				type="password"
				autocomplete="new-password"
				aria-invalid={form?.field === 'confirm' ? 'true' : undefined}
				aria-describedby={form?.field === 'confirm' ? 'why' : undefined}
				required
			/>
		</label>
		<p class="hint" id="hint">At least {data.min} characters.</p>
		<button type="submit">Save password</button>
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
	button {
		font: 600 1rem/1 inherit;
		min-height: 3.2rem;
		border: 0;
		border-radius: 8px;
		background: #273142;
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
