<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	/**
	 * A page for someone who is not signed in -- signing in, and what an
	 * emailed link opens -- drawn as GitHub draws its own: one narrow column,
	 * the business's mark over the heading, then the page's words and its one
	 * button the column's width, and under them what else there is to do. There
	 * is nothing to navigate to, so there is no shell around it.
	 */
	let {
		title,
		role,
		children,
		footer
	}: {
		title: string;
		/** What the page says, when it says it unasked: a link's outcome. */
		role?: 'status' | 'alert';
		children?: Snippet;
		footer?: Snippet;
	} = $props();

	const operator = $derived(page.data.operator);
	const name = $derived(operator?.trading_name?.trim() || 'reckon');
</script>

<main class="primer auth">
	<div class="auth-c" {role}>
		<header class="auth-h">
			<!-- The business's logo where it has one, reckon's tally where it has not. -->
			<img
				class="auth-mark"
				src={operator?.has_logo ? '/operator/logo' : '/icons/reckon.svg'}
				alt={name}
			/>
			<h1 class="auth-t">{title}</h1>
		</header>
		{#if children}<div class="auth-b">{@render children()}</div>{/if}
	</div>
	{#if footer}<footer class="auth-f">{@render footer()}</footer>{/if}
</main>

<style>
	/* GitHub's sign-in: a 24rem column, its parts 16px apart, its heading
	   Primer's medium title, its words centred, its buttons the column's width. */
	.auth {
		box-sizing: border-box;
		width: min(24rem, 100%);
		margin: 0 auto;
		padding: var(--base-size-40) var(--base-size-16);
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--base-size-24);
	}
	.auth-c {
		display: flex;
		flex-direction: column;
		gap: var(--base-size-16);
	}
	.auth-h {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--base-size-16);
		text-align: center;
	}
	.auth-mark {
		height: 44px;
		max-width: 12rem;
		object-fit: contain;
	}
	.auth-t {
		margin: 0;
		font-size: var(--text-title-size-medium);
		font-weight: var(--text-title-weight-medium);
		line-height: var(--text-title-lineHeight-medium);
		text-wrap: balance;
	}
	.auth-b {
		display: flex;
		flex-direction: column;
		gap: var(--base-size-16);
		text-align: center;
		text-wrap: pretty;
	}
	.auth-b :global(p) {
		margin: 0;
	}
	.auth-b :global(form) {
		display: flex;
		flex-direction: column;
		gap: var(--base-size-16);
	}
	/* A field's label and a banner's words read from the left, as a form's do. */
	.auth-b :global(.fc),
	.auth-b :global(.banner) {
		text-align: left;
	}
	.auth-b :global(.btn) {
		width: 100%;
	}
	.auth-f {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--base-size-8);
		text-align: center;
		text-wrap: pretty;
		color: var(--fgColor-muted);
	}
	.auth-f :global(p) {
		margin: 0;
	}
</style>
