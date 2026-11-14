<script lang="ts">
	import { untrack } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import AddressField from '#lib/AddressField.svelte';
	import { parseField } from '#lib/settings-fields.ts';
	import { readJson, readProblem, type Saved } from '#lib/json.ts';
	import type { PageProps } from './$types';

	/**
	 * Who the business is, as an invoice names it, and how it is reached, each
	 * changed in place (#lib/Detail).
	 *
	 * The address is three columns that only make sense together -- the text,
	 * the place it is, and when Google last agreed -- so it is changed its own
	 * way: chosen from Google's suggestions, and saved when it is (#lib/
	 * AddressField). Every site's drive is measured again from it.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.operator);
	const endpoint = '/api/settings';
	const again = () => refreshAll();

	let moving = $state(false);
	let moved = $state<'' | 'saving' | 'bad'>('');
	let movedWhy = $state('');
	// What moving the business did to every site's drive (#lib/server/site-drive).
	let sites = $state('');
	let address = $state(untrack(() => data.operator?.address ?? ''));
	let placeId = $state<string | null>(untrack(() => data.operator?.google_place_id ?? null));

	async function moveTo(a: { formatted: string; placeId: string | null }) {
		moved = 'saving';
		const r = await fetch(endpoint, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { address: a.formatted, google_place_id: a.placeId ?? '' } })
		}).catch(() => null);
		if (!r?.ok) {
			moved = 'bad';
			if (!r) return void (movedWhy = 'Not saved — no connection.');
			const { errors, detail, title } = await readProblem(r);
			movedWhy = Object.values(errors ?? {}).join(' ') || detail || title || 'That did not save.';
			return;
		}
		const out = (await readJson(r).catch(() => ({}))) as Saved & {
			sites?: { sites: number; unmeasured: number } | null;
		};
		const m = out.sites;
		sites = !m?.sites
			? ''
			: m.unmeasured === 0
				? "Every site's drive is measured again from here."
				: !a.formatted
					? "With no address, Google measures no site's drive."
					: `Google could not measure ${m.unmeasured} of ${m.sites} sites from here.`;
		moved = '';
		moving = false;
		await refreshAll();
	}
</script>

<Top
	title="Business"
	sub="What appears on an invoice"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad primer">
	<section class="box" aria-labelledby="who-h">
		<div class="box-h"><h2 class="box-t" id="who-h">Who it is</h2></div>
		<Detail
			name="trading_name"
			label="Trading name"
			value={o?.trading_name ?? ''}
			required
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="short_name"
			label="Short name"
			value={o?.short_name ?? null}
			placeholder="KFS"
			{endpoint}
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}Used where there is no room for the trading name.{/snippet}
		</Detail>
		<Detail
			name="tax_number"
			label="Tax number"
			value={o?.tax_number ?? null}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="tax_number_label"
			label="Labelled"
			value={o?.tax_number_label ?? 'EIN'}
			{endpoint}
			validate={parseField}
			onsaved={again}
		>
			{#snippet caption()}What the tax number is called in your country.{/snippet}
		</Detail>
	</section>

	<section class="box" aria-labelledby="reach-h">
		<div class="box-h"><h2 class="box-t" id="reach-h">How it is reached</h2></div>
		<div class="box-row kv" data-detail="address" data-value={o?.address ?? ''}>
			{#if moving}
				<label class="kv-l" for="address-input">Address</label>
				<div class="kv-edit">
					<div class="kv-ie">
						<div class="grow">
							<AddressField
								label=""
								bind:value={address}
								bind:placeId
								onchosen={(a) => moveTo({ formatted: a.formatted, placeId: a.placeId })}
							/>
						</div>
						<button
							type="button"
							class="btn sm"
							disabled={moved === 'saving'}
							onclick={() => ((moving = false), (moved = ''))}>Cancel</button
						>
					</div>
					{#if moved === 'saving'}
						<p class="fc-c">Saving, and measuring every site’s drive from here…</p>
					{:else if moved === 'bad'}
						<p class="fc-e"><Octicon name="alert" />{movedWhy}</p>
					{:else}
						<p class="fc-c">Choosing a place saves it. Every site’s drive is measured from it.</p>
					{/if}
				</div>
			{:else}
				<span class="kv-l">Address</span>
				<span class="kv-v">
					<span
						>{#if o?.address}{o.address}{:else}<span class="muted">None</span>{/if}</span
					>
					{#if sites}<span class="kv-s">{sites}</span>{/if}
				</span>
				<span class="kv-end">
					<button
						type="button"
						class="ib"
						data-edit="address"
						aria-label="Change address"
						onclick={() => (moving = true)}><Octicon name="pencil" /></button
					>
				</span>
			{/if}
		</div>
		<Detail
			name="email"
			label="Email"
			type="email"
			value={o?.email ?? null}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
		<Detail
			name="phone"
			label="Phone"
			type="tel"
			value={o?.phone ?? null}
			{endpoint}
			validate={parseField}
			onsaved={again}
		/>
	</section>
</div>
