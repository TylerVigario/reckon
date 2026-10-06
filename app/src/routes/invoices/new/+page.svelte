<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Top from '#lib/Top.svelte';
	import { warm } from '#lib/warm.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data, form }: PageProps = $props();
	let client = $state(untrack(() => data.client ?? data.clients[0]?.id ?? ''));
	let saving = $state(false);
</script>

<Top
	title="New draft"
	sub="An invoice to add lines to"
	back={resolve('/invoices')}
	backLabel="Invoices"
/>

<div class="pad">
	<form
		class="rows form"
		method="POST"
		use:enhance={() => {
			saving = true;
			return async ({ result, update }) => {
				await update({ reset: false });
				saving = false;
				// Started: the worker keeps it for no signal from now on.
				if (result.type === 'redirect') warm();
			};
		}}
	>
		<div class="fld">
			<label for="n-client">For</label>
			<select id="n-client" name="entity_id" class="inp" bind:value={client}>
				{#each data.clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			{#if form?.errors?.entity_id}<small class="why">{form.errors.entity_id}</small>{/if}
			<small class="lt"
				>It takes the next invoice number now, and stays a draft until it is sent.</small
			>
		</div>
		<button class="btn pri blk" disabled={saving || !client}>
			{saving ? 'Starting…' : 'Start the draft'}
		</button>
	</form>
</div>

<style>
	.form {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 15px;
	}
	.why {
		color: var(--crit);
		font-size: 12.5px;
	}
	button.btn[disabled] {
		opacity: 0.6;
		cursor: default;
	}
</style>
