<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { parseField } from '#lib/settings-fields.ts';
	import type { PageProps } from './$types';
	import { busy } from '#lib/busy.svelte.ts';

	/**
	 * How the business looks on what it sends: its mark, uploaded as a file,
	 * and its colour, changed in place (#lib/Detail).
	 *
	 * Removing the mark asks first: the file is not kept, and it goes from every
	 * invoice page a client opens, sent ones too.
	 */
	let { data, form }: PageProps = $props();
	const o = $derived(data.operator);
	let removing = $state(false);
	let working = $state(false);
	let uploading = $state(false);
	let clearForm = $state<HTMLFormElement>();
</script>

<Top title="Brand" sub="How what it sends looks" back={resolve('/settings')} backLabel="Settings" />

<div class="pad primer">
	<section class="box" aria-labelledby="mark-h">
		<div class="box-h">
			<h2 class="box-t" id="mark-h">Mark</h2>
			{#if o?.has_logo}
				<button type="button" class="btn sm" onclick={() => (removing = true)}>Remove</button>
			{/if}
		</div>
		<div class="box-row mark">
			{#if o?.has_logo}
				<img src="/operator/logo" alt={o.trading_name} />
			{:else}
				<p class="muted">None. The trading name is used instead.</p>
			{/if}
		</div>
		<form
			class="box-row up"
			method="POST"
			action="?/logo"
			enctype="multipart/form-data"
			use:enhance={() => {
				uploading = true;
				return async ({ update }) => {
					await update();
					uploading = false;
				};
			}}
		>
			<div class="fc">
				<label class="fc-l" for="logo-file">{o?.has_logo ? 'A new one' : 'Upload one'}</label>
				<input
					id="logo-file"
					class="file"
					type="file"
					name="logo"
					accept="image/png,image/jpeg,image/svg+xml,image/webp"
					aria-describedby="logo-c"
				/>
				{#if form?.message}
					<p class="fc-e" id="logo-c"><Octicon name="alert" />{form.message}</p>
				{:else}
					<p class="fc-c" id="logo-c">PNG, JPEG, SVG or WebP, under 512 KB.</p>
				{/if}
			</div>
			<button class="btn" type="submit" {@attach busy(uploading && 'Uploading the logo')}
				>Upload</button
			>
		</form>
	</section>

	<section class="box" aria-labelledby="colour-h">
		<div class="box-h"><h2 class="box-t" id="colour-h">Colour</h2></div>
		<Detail
			name="accent_colour"
			label="Accent colour"
			value={o?.accent_colour ?? null}
			placeholder="#4f6d8a"
			swatch
			hint="On the emails and invoices it sends, and the installed app’s frame."
			endpoint="/api/settings"
			validate={parseField}
			onsaved={() => refreshAll()}
		>
			{#snippet caption()}
				A hex colour. Set, never guessed from the mark: a colour taken from an image is wrong on the
				logos that matter most.
			{/snippet}
		</Detail>
	</section>
</div>

<form
	method="POST"
	action="?/clearLogo"
	hidden
	bind:this={clearForm}
	use:enhance={() => {
		working = true;
		return async ({ update }) => {
			await update();
			working = false;
			removing = false;
		};
	}}
></form>

<Dialog
	open={removing}
	title="Remove the mark?"
	go="Remove the mark"
	going="Removing…"
	tone="danger"
	{working}
	ongo={() => clearForm?.requestSubmit()}
	onclose={() => (removing = false)}
>
	<p>
		It goes from the app’s icon and from the page of every invoice a client opens, the ones already
		sent too. The file is not kept: to have it back, it is uploaded again.
	</p>
</Dialog>

<style>
	.mark img {
		display: block;
		max-height: 56px;
		max-width: 220px;
		width: auto;
	}
	.mark p {
		margin: 0;
	}
	.up {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.file {
		font: inherit;
		font-size: var(--text-body-size-small);
		color: var(--fgColor-muted);
		max-width: 100%;
	}
	.file::file-selector-button {
		margin-right: 12px;
		min-height: var(--control-medium-size);
		padding: 0 12px;
		font: inherit;
		font-weight: 500;
		color: var(--button-default-fgColor-rest);
		background: var(--button-default-bgColor-rest);
		border: 1px solid var(--button-default-borderColor-rest);
		border-radius: var(--borderRadius-medium);
		cursor: pointer;
	}
</style>
