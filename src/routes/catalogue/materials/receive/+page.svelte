<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Top from '#lib/Top.svelte';
	import { Decimal, Ratio } from '#lib/decimal.ts';
	import { percent, quantity } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { readLot } from '#lib/stock-fields.ts';
	import { shrink } from '#lib/receipt.ts';
	import ReceiptPicker from '#lib/ReceiptPicker.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Stock received, as a Primer form: each label above its field, what it
	 * means below, and Receive at the foot with Cancel beside it. What one of it
	 * cost and sells at is worked out as the figures are typed, from what all of
	 * it cost, as the receipt says them.
	 */
	let { data, form }: PageProps = $props();

	// Seeded once; after that the boxes are the truth.
	let materialId = $state<string>(untrack(() => data.material ?? data.materials[0]?.id ?? ''));
	let name = $state('');
	let unitId = $state<string>(untrack(() => data.units[0]?.id ?? ''));
	let qty = $state('');
	let cost = $state('');
	let tax = $state('');
	let paidBy = $state(''); // empty is the business
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});
	$effect(() => {
		if (form?.errors) errors = form.errors;
	});

	const material = $derived(data.materials.find((m) => m.id === materialId));
	const unit = $derived(data.units.find((u) => u.id === (material ? material.unit_id : unitId)));
	const written = $derived(unit ? (unit.short ?? unit.name) : '');
	const markup = $derived(material?.markup_pct ?? data.markup);

	/** What one of it cost and sells at, worked out from what all of it cost. */
	const each = $derived.by(() => {
		try {
			const n = Decimal.from(qty);
			if (n.isZero()) return null;
			const c = Ratio.of(cost || '0').div(n);
			return {
				cost: c.round(4).toString(),
				tax: Ratio.of(tax || '0')
					.div(n)
					.round(4)
					.toString(),
				sells: c.mul(Ratio.of(markup).div(100).add(1)).round(4).toString()
			};
		} catch {
			return null;
		}
	});
</script>

{#snippet wrong(key: string)}
	{#if errors[key]}
		<p class="fc-e" id="r-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<Top
	title="Receive stock"
	sub={material ? `Into ${material.name}` : 'Something new to the catalogue'}
	back={resolve('/catalogue/materials')}
	backLabel="Materials"
/>

<div class="pad primer">
	<form
		id="receive"
		class="box"
		method="POST"
		enctype="multipart/form-data"
		novalidate
		use:enhance={async ({ formData, cancel }) => {
			const fields = Object.fromEntries(
				[...formData.entries()].filter((e): e is [string, string] => typeof e[1] === 'string')
			);
			errors = readLot(fields, unit?.places ?? null).errors;
			if (Object.keys(errors).length > 0) return cancel();
			saving = true;
			// A photo goes shrunk, so a receipt costs a few hundred kilobytes.
			const file = formData.get('receipt');
			if (file instanceof File && file.size > 0) formData.set('receipt', await shrink(file));
			return async ({ update }) => {
				await update({ reset: false });
				saving = false;
			};
		}}
	>
		<div class="box-row form">
			<div class="fc">
				<label class="fc-l" for="r-item">Item</label>
				<select
					id="r-item"
					name="material_id"
					class="ti"
					bind:value={materialId}
					aria-invalid={errors.material_id ? 'true' : undefined}
					aria-describedby={errors.material_id ? 'r-material_id-e' : 'r-item-c'}
				>
					{#each data.materials as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
					<option value="">Something new…</option>
				</select>
				{#if errors.material_id}
					{@render wrong('material_id')}
				{:else}
					<p class="fc-c" id="r-item-c">
						{material && written
							? `Counted in ${written}.`
							: 'Named here, and counted in a unit below.'}
					</p>
				{/if}
			</div>

			{#if !material}
				<div class="fc">
					<label class="fc-l" for="r-name">What it is<span aria-hidden="true"> *</span></label>
					<input
						id="r-name"
						name="name"
						class="ti"
						autocomplete="off"
						bind:value={name}
						aria-invalid={errors.name ? 'true' : undefined}
						aria-describedby={errors.name ? 'r-name-e' : undefined}
					/>
					{@render wrong('name')}
				</div>
				<div class="fc">
					<label class="fc-l" for="r-unit">Counted in</label>
					<select
						id="r-unit"
						name="unit_id"
						class="ti"
						bind:value={unitId}
						aria-describedby="r-unit-c"
					>
						{#each data.units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
					</select>
					<p class="fc-c" id="r-unit-c">
						Not listed? <a class="lk" href={resolve('/settings/units')}>Add a unit</a>.
					</p>
				</div>
			{/if}

			<div class="fc">
				<label class="fc-l" for="r-from">Bought from</label>
				<input
					id="r-from"
					name="supplier"
					class="ti"
					autocomplete="off"
					aria-invalid={errors.supplier ? 'true' : undefined}
					aria-describedby={errors.supplier ? 'r-supplier-e' : undefined}
				/>
				{@render wrong('supplier')}
			</div>

			<div class="fc">
				<label class="fc-l" for="r-day">Day received<span aria-hidden="true"> *</span></label>
				<input
					id="r-day"
					name="received_on"
					class="ti"
					type="date"
					max={data.today}
					value={data.today}
					aria-invalid={errors.received_on ? 'true' : undefined}
					aria-describedby={errors.received_on ? 'r-received_on-e' : undefined}
				/>
				{@render wrong('received_on')}
			</div>

			<div class="fc">
				<label class="fc-l" for="r-qty">How much<span aria-hidden="true"> *</span></label>
				<span class="tv">
					<input
						id="r-qty"
						name="qty_received"
						class="ti"
						inputmode="decimal"
						autocomplete="off"
						bind:value={qty}
						aria-invalid={errors.qty_received ? 'true' : undefined}
						aria-describedby={errors.qty_received ? 'r-qty_received-e' : undefined}
					/>
					{#if written}<span class="tv-v" aria-hidden="true">{written}</span>{/if}
				</span>
				{@render wrong('qty_received')}
			</div>

			<div class="fc">
				<label class="fc-l" for="r-cost"
					>Cost before tax, all of it<span aria-hidden="true"> *</span></label
				>
				<input
					id="r-cost"
					name="ex_tax_cost"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={cost}
					aria-invalid={errors.ex_tax_cost ? 'true' : undefined}
					aria-describedby={errors.ex_tax_cost ? 'r-ex_tax_cost-e' : 'r-cost-c'}
				/>
				{#if errors.ex_tax_cost}
					{@render wrong('ex_tax_cost')}
				{:else}
					<p class="fc-c" id="r-cost-c">As the receipt says it, for everything received.</p>
				{/if}
			</div>

			<div class="fc">
				<label class="fc-l" for="r-tax">Tax paid, all of it</label>
				<input
					id="r-tax"
					name="tax_paid"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={tax}
					aria-invalid={errors.tax_paid ? 'true' : undefined}
					aria-describedby={errors.tax_paid ? 'r-tax_paid-e' : 'r-tax-c'}
				/>
				{#if errors.tax_paid}
					{@render wrong('tax_paid')}
				{:else}
					<p class="fc-c" id="r-tax-c">
						Kept apart from the cost, so what was resold can be claimed back.
					</p>
				{/if}
			</div>

			{#if each}
				<section class="box each" aria-labelledby="each-h">
					<div class="box-h">
						<h3 class="box-t" id="each-h">
							{!unit || unit.name === 'each' ? 'Each one' : `Each ${unit.name}`}
						</h3>
					</div>
					<div class="box-row kv">
						<span>Costs</span><span class="v">{unitPrice(each.cost)}</span>
					</div>
					<div class="box-row kv">
						<span>Tax paid</span><span class="v">{unitPrice(each.tax)}</span>
					</div>
					<div class="box-row kv">
						<span>Sells at, {percent(markup)} markup</span><span class="v"
							>{unitPrice(each.sells)}</span
						>
					</div>
				</section>
			{/if}

			<fieldset class="fc" aria-describedby="r-paid-c">
				<legend class="fc-l">Who paid</legend>
				<p class="fc-c" id="r-paid-c">Whoever paid out of their own pocket is owed it back.</p>
				<label class="rad">
					<input type="radio" name="paid_by" value="" bind:group={paidBy} />
					<span><span class="rad-t">The business</span></span>
				</label>
				{#each data.people as p (p.id)}
					<label class="rad">
						<input type="radio" name="paid_by" value={p.id} bind:group={paidBy} />
						<span><span class="rad-t">{p.name}</span></span>
					</label>
				{/each}
				{@render wrong('paid_by')}
			</fieldset>

			<div class="fc">
				<span class="fc-l" id="r-receipt-l">Receipt or invoice</span>
				<ReceiptPicker id="r-receipt" />
				{#if errors.receipt}
					{@render wrong('receipt')}
				{:else}
					<p class="fc-c">
						A photo, shrunk on this phone before it is sent, or the supplier’s PDF.
					</p>
				{/if}
			</div>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" disabled={saving}>
				{saving
					? 'Receiving…'
					: qty
						? `Receive ${quantity(qty)}${written ? ` ${written}` : ''}`
						: 'Receive'}
			</button>
			<a class="btn" href={resolve('/catalogue/materials')}>Cancel</a>
		</div>
	</form>
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
		font-family: var(--f-mono);
		font-size: 13px;
		color: var(--ink-3);
		pointer-events: none;
	}
	.each {
		max-width: 440px;
	}
	.kv {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px;
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
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
