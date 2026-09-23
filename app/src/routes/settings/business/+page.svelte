<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Top from '$lib/Top.svelte';
	import Setting from '$lib/Setting.svelte';
	import AddressField from '$lib/AddressField.svelte';
	import type { PageProps } from './$types';
	import { readJson, readProblem, type Saved } from '$lib/json';
	import type { ProblemLike } from '$lib/problem';
	import { resolve } from '$app/paths';

	let { data, form }: PageProps = $props();
	const o = $derived(data.operator);

	const tidy = (v: unknown) => {
		if (v === null || v === undefined || v === '') return '';
		if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return '';
		return String(v).replace(/\.?0+$/, '');
	};

	// The address is three columns that only make sense together -- the text,
	// the place it is, and when Google last agreed -- so it is the one thing
	// here that does not go through <Setting>.
	let address = $state(untrack(() => data.operator?.address ?? ''));
	let placeId = $state<string | null>(untrack(() => data.operator?.google_place_id ?? null));
	let addrStatus = $state<'idle' | 'saving' | 'ok' | 'bad'>('idle');
	let addrSaid = $state('Saved');
	let addrWhy = $state('');
	let addrStored = $state(
		untrack(() =>
			JSON.stringify({
				a: data.operator?.address ?? '',
				p: data.operator?.google_place_id ?? null
			})
		)
	);
	let clearAddrOk: ReturnType<typeof setTimeout> | undefined;

	async function saveAddress(a: { value: string; placeId: string | null }) {
		const key = JSON.stringify({ a: a.value, p: a.placeId });
		if (key === addrStored) return;
		clearTimeout(clearAddrOk);
		addrStatus = 'saving';
		addrWhy = '';
		try {
			const r = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					fields: { address: a.value, google_place_id: a.placeId ?? '' }
				})
			});
			const out = r.ok
				? ((await readJson(r).catch(() => ({}))) as Saved & { address_verified?: boolean })
				: await readProblem(r);
			if (r.ok) {
				addrStored = key;
				addrStatus = 'ok';
				addrSaid =
					a.placeId && !(out as { address_verified?: boolean }).address_verified
						? 'Saved, not confirmed'
						: 'Saved';
				clearAddrOk = setTimeout(() => {
					if (addrStatus === 'ok') addrStatus = 'idle';
				}, 2500);
			} else {
				addrStatus = 'bad';
				const { errors, detail, title } = out as ProblemLike;
				const all = errors ? Object.values(errors) : [];
				addrWhy = all.join(' ') || detail || title || `Not saved (${r.status}).`;
			}
		} catch {
			addrStatus = 'bad';
			addrWhy = 'Not saved — no connection.';
		}
	}
</script>

<Top
	title="Business"
	sub="What appears on an invoice"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	{#if form?.message}<p class="msg warn">{form.message}</p>{/if}

	<div class="sec">
		<div class="sec-h"><h2>Mark</h2></div>
		<div class="rows inset">
			<form class="logo" method="POST" action="?/logo" enctype="multipart/form-data" use:enhance>
				{#if o?.has_logo}
					<img src="/operator/logo" alt={o.trading_name} />
				{:else}
					<p class="none">
						With no mark set, the trading name is used instead — a page that only looks right once a
						file is uploaded is broken for every new installation on its first day.
					</p>
				{/if}
				<input
					class="inp"
					type="file"
					name="logo"
					accept="image/png,image/jpeg,image/svg+xml,image/webp"
				/>
				<div class="btnrow">
					<button class="btn" type="submit">Upload</button>
					{#if o?.has_logo}
						<button class="btn gho" type="submit" formaction="?/clearLogo">Remove</button>
					{/if}
				</div>
				<small>PNG, JPEG, SVG or WebP, under 512 KB.</small>
			</form>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Identity</h2></div>
		<div class="rows inset">
			<Setting name="trading_name" label="Trading name" value={o?.trading_name} required />
			<Setting
				name="short_name"
				label="Short name — used in tight spaces"
				value={o?.short_name}
				placeholder="VTS"
			/>

			<div class="fld" class:bad={addrStatus === 'bad'}>
				<label for="address-input">
					Address
					<span class="state" aria-live="polite">
						{#if addrStatus === 'saving'}Saving…{:else if addrStatus === 'ok'}{addrSaid}{/if}
					</span>
				</label>
				<AddressField label="" bind:value={address} bind:placeId oncommit={saveAddress} />
				{#if addrStatus === 'bad'}<small class="why">{addrWhy}</small>{/if}
			</div>

			<div class="pair">
				<Setting
					name="tax_number"
					label="Tax number — labelled for your country"
					value={o?.tax_number}
				/>
				<Setting name="tax_number_label" label="Labelled" value={o?.tax_number_label ?? 'EIN'} />
			</div>
			<div class="pair">
				<Setting name="email" label="Email" type="email" value={o?.email} />
				<Setting name="phone" label="Phone" value={o?.phone} />
			</div>
			<Setting
				name="accent_colour"
				label="Accent colour"
				value={o?.accent_colour}
				placeholder="#2382b3"
				hint="Set, never guessed from the mark — extracting a colour from an image gets it wrong on the logos that matter most."
				swatch
			/>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Locale</h2></div>
		<div class="rows inset">
			<div class="pair">
				<Setting
					name="currency"
					label="Currency"
					value={o?.currency ?? 'USD'}
					hint="Stored as NUMERIC, never a float"
				/>
				<Setting name="timezone" label="Time zone" value={o?.timezone ?? 'America/Los_Angeles'} />
			</div>
			<div class="pair">
				<Setting
					name="rounding_mode"
					label="Rounding"
					value={o?.rounding_mode ?? 'half_up'}
					options={[
						{ value: 'half_up', label: 'Half up' },
						{ value: 'half_even', label: "Half even (banker's)" }
					]}
				/>
				<Setting name="date_format" label="Date format" value={o?.date_format ?? 'd MMM yyyy'} />
			</div>
			<Setting
				name="default_markup_pct"
				label="Default markup %"
				value={tidy(o?.default_markup_pct) || '20'}
				inputmode="decimal"
				hint="Applies to every sellable item without its own."
			/>
		</div>
	</div>
</div>

<style>
	.msg {
		padding: 10px 14px;
		border-radius: var(--r);
		font-size: 14px;
	}
	.warn {
		background: var(--warn-wash);
		color: var(--warn);
	}
	.logo {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.logo img {
		max-height: 56px;
		max-width: 220px;
		width: auto;
	}
	.none {
		margin: 0;
		color: var(--ink-3);
		font-size: 13.5px;
	}
	small {
		color: var(--ink-3);
		font-size: 12px;
	}
	.why {
		color: var(--warn);
	}
	.state {
		font-size: 10px;
		color: var(--ink-3);
	}
	.fld > label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}
	@media (min-width: 560px) {
		.pair {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
