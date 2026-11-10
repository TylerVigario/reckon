<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * Changing your own password, as GitHub's "Change password" does: the
	 * current one, a new one and the new one again, then Update password. A
	 * form posted to the page rather than to /api, so a password manager sees
	 * the change and offers to keep it.
	 */
	let { data, form }: PageProps = $props();

	let saving = $state(false);
	// The answer the banner was dismissed for, so the next update shows again.
	let dismissed = $state.raw<PageProps['form']>(null);
	const updated = $derived(!!form?.updated && form !== dismissed);
	const wrongIn = (field: string) => (form?.field === field ? form.message : '');
</script>

{#snippet wrong(id: string, message: string)}
	<p class="fc-e" id="{id}-e"><Octicon name="alert" />{message}</p>
{/snippet}

<Top title="Password" back={resolve('/profile')} backLabel="Your profile" />

<div class="pad primer">
	{#if updated}
		<div class="banner good" role="status">
			<Octicon name="checkCircle" />
			<div class="banner-m">
				<p class="banner-t">Password updated</p>
				<p class="banner-d">
					You’re still signed in here. Every other device you were signed in on is signed out.
				</p>
			</div>
			<button type="button" class="ib" aria-label="Dismiss" onclick={() => (dismissed = form)}>
				<Octicon name="x" />
			</button>
		</div>
	{/if}

	<form
		class="box"
		method="POST"
		novalidate
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update();
				saving = false;
			};
		}}
	>
		<!-- Who it is for, so a password manager saves it against the right sign-in. -->
		<input type="hidden" name="username" autocomplete="username" value={data.email} />
		<div class="box-row form">
			<div class="fc">
				<label class="fc-l" for="p-current">Current password</label>
				<input
					id="p-current"
					name="current"
					class="ti"
					type="password"
					autocomplete="current-password"
					required
					aria-invalid={wrongIn('current') ? 'true' : undefined}
					aria-describedby={wrongIn('current') ? 'p-current-e' : undefined}
				/>
				{#if wrongIn('current')}
					{@render wrong('p-current', wrongIn('current'))}
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="p-new">New password</label>
				<input
					id="p-new"
					name="password"
					class="ti"
					type="password"
					autocomplete="new-password"
					minlength={data.min}
					required
					aria-invalid={wrongIn('password') ? 'true' : undefined}
					aria-describedby={wrongIn('password') ? 'p-new-e' : 'p-new-c'}
				/>
				{#if wrongIn('password')}
					{@render wrong('p-new', wrongIn('password'))}
				{:else}
					<p class="fc-c" id="p-new-c">At least {data.min} characters.</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="p-confirm">Confirm new password</label>
				<input
					id="p-confirm"
					name="confirm"
					class="ti"
					type="password"
					autocomplete="new-password"
					required
					aria-invalid={wrongIn('confirm') ? 'true' : undefined}
					aria-describedby={wrongIn('confirm') ? 'p-confirm-e' : undefined}
				/>
				{#if wrongIn('confirm')}
					{@render wrong('p-confirm', wrongIn('confirm'))}
				{/if}
			</div>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" disabled={saving}
				>{saving ? 'Updating…' : 'Update password'}</button
			>
			{#if form?.field === ''}
				<p class="fc-e"><Octicon name="alert" />{form.message}</p>
			{:else}
				<p class="note">Every other device you’re signed in on is signed out.</p>
			{/if}
		</div>
	</form>

	<p class="note">
		Forgotten your current password? Sign out, and choose a new one with Forgot password? on the
		sign-in page.
	</p>
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fc {
		max-width: 440px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--surface-2);
	}
</style>
