<script lang="ts">
	import Detail from '#lib/Detail.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { percent } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { parseMaterialField, readPricing, type PricedBy } from '#lib/material-fields.ts';
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';

	/**
	 * A material's Details tab: what it is -- its name, brand and SKU, what it is
	 * counted in, whether it is taxed -- each changed in place (#lib/Detail),
	 * carrying the save it began from so a change made since is not written
	 * over unseen; and what it sells at, changed in a dialog as one choice: the
	 * business's markup, its own, or a set price, from today.
	 *
	 * What it is counted in is fixed once any of it has been received, and says
	 * so, as Odoo and ERPNext refuse that change once stock has moved.
	 */
	let { data }: PageProps = $props();
	const m = $derived(data.material);
	const endpoint = $derived(`/api/materials/${data.material.id}`);
	const per = $derived(m.unit === 'each' ? 'each' : `a ${m.unit}`);
	const by = $derived<PricedBy>(
		m.listed !== null ? 'price' : m.own_markup !== null ? 'markup' : 'business'
	);
	const YES_NO = [
		{ value: 'true', label: 'Yes' },
		{ value: 'false', label: 'No' }
	];

	let pricing = $state(false);
	let choice = $state<PricedBy>('business');
	let markup = $state('');
	let price = $state('');
	let errors = $state<Record<string, string>>({});
	let problem = $state('');
	let saving = $state(false);
	function openPricing() {
		choice = by;
		markup = m.own_markup ?? '';
		price = m.listed ?? '';
		errors = {};
		problem = '';
		pricing = true;
	}
	async function savePricing() {
		const fields = {
			by: choice,
			markup_pct: choice === 'markup' ? markup : '',
			price: choice === 'price' ? price : ''
		};
		errors = readPricing(fields).errors;
		problem = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`${endpoint}/price`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		saving = false;
		if (!r) return void (problem = 'Not saved — no connection.');
		if (!r.ok) {
			const b = await readProblem(r);
			errors = b.errors ?? {};
			if (!Object.keys(errors).length) problem = b.detail ?? 'That did not save.';
			return;
		}
		pricing = false;
		await refreshAll();
	}
</script>

<section class="box" aria-labelledby="is-h">
	<div class="box-h"><h2 class="box-t" id="is-h">What it is</h2></div>
	<Detail
		name="name"
		label="Name"
		value={m.name}
		required
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		onsaved={refreshAll}
		onconflict={refreshAll}
	/>
	<Detail
		name="brand"
		label="Brand"
		value={m.brand}
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		onsaved={refreshAll}
		onconflict={refreshAll}
	/>
	<Detail
		name="sku"
		label="SKU"
		value={m.sku}
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		onsaved={refreshAll}
		onconflict={refreshAll}
	/>
	<Detail
		name="unit_id"
		label="Counted in"
		value={m.unit_id}
		shown={data.units.find((u) => u.id === m.unit_id)?.name}
		options={data.units.map((u) => ({ value: u.id, label: u.name }))}
		editable={!data.received}
		hint={data.received ? 'Fixed once some is received.' : ''}
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		onsaved={refreshAll}
		onconflict={refreshAll}
	/>
	<Detail
		name="taxable"
		label="Taxed"
		value={String(m.taxable)}
		options={YES_NO}
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		onsaved={refreshAll}
		onconflict={refreshAll}
	/>
</section>

<section class="box" aria-labelledby="sells-h">
	<div class="box-h"><h2 class="box-t" id="sells-h">What it sells at</h2></div>
	<div class="box-row kv">
		<span class="kv-l">Sells at</span>
		<span class="kv-v">
			<span
				>{m.price
					? `${unitPrice(m.price)} ${per}`
					: 'Nothing yet: none on the shelf to cost it by'}</span
			>
			<span class="sub">
				{by === 'price'
					? 'A set price'
					: by === 'markup'
						? `${percent(m.own_markup ?? '0')} over what one cost, its own markup`
						: `${percent(data.markup ?? '0')} over what one cost, the business’s markup`}
			</span>
		</span>
		<span class="end">
			<button type="button" class="ib" aria-label="Change what it sells at" onclick={openPricing}
				><Octicon name="pencil" /></button
			>
		</span>
	</div>
</section>

<Dialog
	open={pricing}
	title="What {m.name} sells at"
	go="Save"
	going="Saving…"
	working={saving}
	ongo={savePricing}
	onclose={() => (pricing = false)}
>
	<fieldset class="fc">
		<legend class="fc-l">Priced by</legend>
		<label class="rad">
			<input type="radio" name="p-by" value="business" bind:group={choice} />
			<span
				><span class="rad-t">The business’s markup</span><span class="rad-c"
					>{percent(data.markup ?? '0')} over what one cost.</span
				></span
			>
		</label>
		<label class="rad">
			<input type="radio" name="p-by" value="markup" bind:group={choice} />
			<span><span class="rad-t">A markup of its own</span></span>
		</label>
		<label class="rad">
			<input type="radio" name="p-by" value="price" bind:group={choice} />
			<span><span class="rad-t">A set price</span></span>
		</label>
	</fieldset>
	{#if choice === 'markup'}
		<div class="fc">
			<label class="fc-l" for="p-markup">Markup</label>
			<span class="tv">
				<input
					id="p-markup"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={markup}
					aria-invalid={errors.markup_pct ? 'true' : undefined}
				/>
				<span class="tv-v" aria-hidden="true">%</span>
			</span>
			{#if errors.markup_pct}<p class="fc-e"><Octicon name="alert" />{errors.markup_pct}</p>{/if}
		</div>
	{:else if choice === 'price'}
		<div class="fc">
			<label class="fc-l" for="p-price">Price</label>
			<span class="tv">
				<input
					id="p-price"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={price}
					aria-invalid={errors.price ? 'true' : undefined}
				/>
				<span class="tv-v" aria-hidden="true">{per}</span>
			</span>
			{#if errors.price}<p class="fc-e"><Octicon name="alert" />{errors.price}</p>{/if}
		</div>
	{/if}
	<p class="fc-c">From today. Lines already on a draft keep what they were priced at.</p>
	{#if problem}<p class="fc-e"><Octicon name="alert" />{problem}</p>{/if}
</Dialog>

<style>
	.kv {
		display: grid;
		grid-template-columns: minmax(0, 30%) minmax(0, 1fr) auto;
		align-items: center;
		gap: 4px 16px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.kv-l {
		font-weight: 600;
	}
	.kv-v {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		color: var(--ink-2);
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
	.end {
		display: flex;
		justify-content: flex-end;
		min-width: 32px;
	}
	.tv {
		position: relative;
		display: block;
	}
	.tv .ti {
		padding-right: 56px;
	}
	.tv-v {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		color: var(--ink-3);
		pointer-events: none;
	}
	@media (max-width: 543px) {
		.kv {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.kv-l {
			grid-column: 1;
			grid-row: 1;
		}
		.kv-v {
			grid-column: 1;
			grid-row: 2;
		}
		.end {
			grid-column: 2;
			grid-row: 1 / span 2;
		}
	}
</style>
