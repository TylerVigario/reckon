<script lang="ts">
	import { onMount } from 'svelte';
	import Detail from '#lib/Detail.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { percent } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { parseMaterialField, readPricing, type PricedBy } from '#lib/material-fields.ts';
	import { changeMaterial } from '#lib/material-change.ts';
	import {
		discardMaterialChange,
		materialChangeKey,
		materialChangesHeld,
		QUEUE_CHANGED,
		type QueuedMaterialChange
	} from '#lib/queue.ts';
	import { todayIn } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
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
	 *
	 * Each change is kept on the phone first and sent by the queue (#lib/
	 * material-change), so it is made with no signal too: what waits is shown
	 * here as it will be, and what someone else changed meanwhile is said, to
	 * save over or let go, as online.
	 */
	let { data }: PageProps = $props();
	const endpoint = $derived(`/api/materials/${data.material.id}`);

	// What waits on this phone, shown as it will be.
	let held = $state<QueuedMaterialChange[]>([]);
	const read = async () =>
		(held = await materialChangesHeld(data.material.id).catch(() => [] as QueuedMaterialChange[]));
	onMount(() => {
		void read();
		const again = () => void read();
		addEventListener(QUEUE_CHANGED, again);
		return () => removeEventListener(QUEUE_CHANGED, again);
	});
	const waitingFields = $derived(
		held.find((q) => q.change.kind === 'fields' && !q.refused)?.change.fields ?? {}
	);
	const waitingPrice = $derived(
		held.find((q) => q.change.kind === 'price' && !q.refused)?.change.fields
	);
	const m = $derived({
		...data.material,
		...('name' in waitingFields ? { name: waitingFields.name } : {}),
		...('brand' in waitingFields ? { brand: waitingFields.brand || null } : {}),
		...('sku' in waitingFields ? { sku: waitingFields.sku || null } : {}),
		...('unit_id' in waitingFields ? { unit_id: waitingFields.unit_id } : {}),
		...('taxable' in waitingFields ? { taxable: waitingFields.taxable === 'true' } : {}),
		...(waitingPrice
			? {
					listed: waitingPrice.by === 'price' ? waitingPrice.price : null,
					own_markup: waitingPrice.by === 'markup' ? waitingPrice.markup_pct : null,
					price: waitingPrice.by === 'price' ? waitingPrice.price : null
				}
			: {})
	});
	/** Under a detail: what it means, and that it waits on this phone. */
	const note = (field: string, hint = '') =>
		[field in waitingFields ? 'Waiting to send.' : '', hint].filter(Boolean).join(' ');
	const per = $derived(m.unit === 'each' ? 'each' : `a ${m.unit}`);
	const by = $derived<PricedBy>(
		m.listed !== null ? 'price' : m.own_markup !== null ? 'markup' : 'business'
	);

	/**
	 * A detail, kept on the phone and sent. Refused at once -- something wrong
	 * with it, or changed meanwhile -- the reason is said under it; changed
	 * meanwhile, the screen is fetched again so Save puts this over theirs.
	 */
	async function send(
		fields: Record<string, string>,
		version: number | undefined,
		base: Record<string, string>
	) {
		const came = await changeMaterial({
			kind: 'fields',
			material_id: data.material.id,
			version: version ?? data.material.version,
			base,
			fields,
			made_at: new Date().toISOString(),
			shown: { name: data.material.name }
		}).catch(() => null);
		if (!came) return 'This phone would not keep it, so it is not changed.';
		if (came.state === 'sent') await refreshAll();
		if (came.state !== 'refused') return null;
		if (came.refused.conflict) await refreshAll();
		const [field] = Object.keys(fields);
		return came.refused.errors?.[field] ?? came.refused.detail;
	}
	/** Cancel on a refused detail: let it go, and keep what is there. */
	const letGo = (field: string) => () =>
		discardMaterialChange(materialChangeKey('fields', data.material.id), field);
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
	/**
	 * What it sells at, kept on the phone and sent, from the day it is set
	 * here, with what it sold at when the dialog opened: changed elsewhere
	 * meanwhile, it is said, and Save puts this over it.
	 */
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
		const server = data.material;
		const came = await changeMaterial({
			kind: 'price',
			material_id: server.id,
			version: 0,
			base: {
				by: server.listed !== null ? 'price' : server.own_markup !== null ? 'markup' : 'business',
				markup_pct: server.own_markup ?? '',
				price: server.listed ?? ''
			},
			fields,
			from: todayIn(personalZone()),
			made_at: new Date().toISOString(),
			shown: { name: server.name }
		}).catch(() => null);
		saving = false;
		if (!came) return void (problem = 'This phone would not keep it, so it is not changed.');
		if (came.state === 'refused') {
			errors = came.refused.errors ?? {};
			if (!Object.keys(errors).length) problem = came.refused.detail;
			if (came.refused.conflict) await refreshAll();
			return;
		}
		pricing = false;
		if (came.state === 'sent') await refreshAll();
	}
	/** Cancel on a refused pricing: let it go, and keep what is there. */
	async function closePricing() {
		pricing = false;
		if (held.some((q) => q.change.kind === 'price' && q.refused))
			await discardMaterialChange(materialChangeKey('price', data.material.id));
	}
</script>

<section class="box" aria-labelledby="is-h">
	<div class="box-h"><h2 class="box-t" id="is-h">What it is</h2></div>
	<Detail
		name="name"
		oncancel={letGo('name')}
		label="Name"
		value={m.name}
		hint={note('name')}
		required
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		{send}
	/>
	<Detail
		name="brand"
		oncancel={letGo('brand')}
		label="Brand"
		value={m.brand}
		hint={note('brand')}
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		{send}
	/>
	<Detail
		name="sku"
		oncancel={letGo('sku')}
		label="SKU"
		value={m.sku}
		hint={note('sku')}
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		{send}
	/>
	<Detail
		name="unit_id"
		oncancel={letGo('unit_id')}
		label="Counted in"
		value={m.unit_id}
		shown={data.units.find((u) => u.id === m.unit_id)?.name}
		options={data.units.map((u) => ({ value: u.id, label: u.name }))}
		editable={!data.received}
		hint={note('unit_id', data.received ? 'Fixed once some is received.' : '')}
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		{send}
	/>
	<Detail
		name="taxable"
		oncancel={letGo('taxable')}
		label="Taxed"
		value={String(m.taxable)}
		hint={note('taxable')}
		options={YES_NO}
		{endpoint}
		version={m.version}
		validate={parseMaterialField}
		{send}
	/>
</section>

<section class="box" aria-labelledby="sells-h">
	<div class="box-h"><h2 class="box-t" id="sells-h">What it sells at</h2></div>
	<div class="box-row kv">
		<span class="kv-l">Sells at</span>
		<span class="kv-v">
			<span
				>{m.listed !== null
					? `${unitPrice(m.listed)} ${per}`
					: m.price
						? `${unitPrice(m.price)} ${per}`
						: data.copy
							? 'Worked out with a connection'
							: 'Nothing yet: none on the shelf to cost it by'}</span
			>
			<span class="sub">
				{by === 'price'
					? 'A set price'
					: by === 'markup'
						? `${percent(m.own_markup ?? '0')} over what one cost, its own markup`
						: `${percent(data.markup ?? '0')} over what one cost, the business’s markup`}{waitingPrice
					? ' · waiting to send'
					: ''}
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
	onclose={closePricing}
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
