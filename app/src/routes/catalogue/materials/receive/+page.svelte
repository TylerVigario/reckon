<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Top from '#lib/Top.svelte';
	import { Decimal, Ratio } from '#lib/decimal.ts';
	import { percent, quantity } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { readLot } from '#lib/stock-fields.ts';
	import { asDataUrl, shrink } from '#lib/receipt.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data, form }: PageProps = $props();

	// Seeded once; after that the boxes are the truth.
	let materialId = $state<string>(untrack(() => data.material ?? data.materials[0]?.id ?? ''));
	let name = $state('');
	let unitId = $state<string>(untrack(() => data.units[0]?.id ?? ''));
	let qty = $state('');
	let cost = $state('');
	let tax = $state('');
	let paidBy = $state(''); // empty is the business
	let preview = $state<string | null>(null);
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

	let chosen = $state<string | null>(null);
	async function pick(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		chosen = file?.name ?? null;
		preview =
			file && file.type.startsWith('image/') ? await asDataUrl(file).catch(() => null) : null;
	}
</script>

<Top
	title="Receive stock"
	sub={material ? `Into ${material.name}` : 'Something new to the catalogue'}
	back={resolve('/catalogue/materials')}
	backLabel="Materials"
/>

<div class="pad">
	<form
		class="rows form"
		method="POST"
		enctype="multipart/form-data"
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
		<div class="fld">
			<label for="r-item">Item</label>
			<span class="inp-wrap">
				<select id="r-item" name="material_id" class="inp" bind:value={materialId}>
					{#each data.materials as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
					<option value="">Something new…</option>
				</select>
				{#if material && written}<span class="hint">{written}</span>{/if}
			</span>
			{#if errors.material_id}<small class="why">{errors.material_id}</small>{/if}
		</div>

		{#if !material}
			<div class="fld">
				<label for="r-name">What it is</label>
				<input
					id="r-name"
					name="name"
					class="inp"
					placeholder="Cat6 plenum cable"
					bind:value={name}
				/>
				{#if errors.name}<small class="why">{errors.name}</small>{/if}
			</div>
			<div class="fld">
				<label for="r-unit">Counted in</label>
				<select id="r-unit" name="unit_id" class="inp" bind:value={unitId}>
					{#each data.units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
				</select>
				<small class="lt">Not here? <a href={resolve('/settings/units')}>Add a unit</a>.</small>
			</div>
		{/if}

		<div class="fld">
			<label for="r-from">Bought from</label>
			<input id="r-from" name="supplier" class="inp" placeholder="Delta Wholesale" />
			{#if errors.supplier}<small class="why">{errors.supplier}</small>{/if}
		</div>

		<div class="fld">
			<label for="r-day">Day received</label>
			<input
				id="r-day"
				name="received_on"
				class="inp"
				type="date"
				max={data.today}
				value={data.today}
			/>
			{#if errors.received_on}<small class="why">{errors.received_on}</small>{/if}
		</div>

		<div class="fld">
			<label for="r-qty">How much</label>
			<span class="inp-wrap">
				<input
					id="r-qty"
					name="qty_received"
					class="inp"
					inputmode="decimal"
					placeholder="1000"
					bind:value={qty}
				/>
				{#if written}<span class="hint">{written}</span>{/if}
			</span>
			{#if errors.qty_received}<small class="why">{errors.qty_received}</small>{/if}
		</div>

		<div class="fld">
			<label for="r-cost">Cost before tax, all of it</label>
			<input
				id="r-cost"
				name="ex_tax_cost"
				class="inp"
				inputmode="decimal"
				placeholder="310.00"
				bind:value={cost}
			/>
			{#if errors.ex_tax_cost}<small class="why">{errors.ex_tax_cost}</small>{/if}
		</div>

		<div class="fld">
			<label for="r-tax">Tax paid, all of it</label>
			<input
				id="r-tax"
				name="tax_paid"
				class="inp"
				inputmode="decimal"
				placeholder="0.00"
				bind:value={tax}
			/>
			{#if errors.tax_paid}<small class="why">{errors.tax_paid}</small>{/if}
		</div>

		{#if each}
			<div class="bill">
				<div class="kv">
					<span class="k">Cost a {unit?.name ?? 'unit'}</span><span class="v"
						>{unitPrice(each.cost)}</span
					>
				</div>
				<div class="kv">
					<span class="k">Tax paid a {unit?.name ?? 'unit'}</span><span class="v"
						>{unitPrice(each.tax)}</span
					>
				</div>
				<div class="kv">
					<span class="k">Sells at</span>
					<span class="v"
						>{unitPrice(each.sells)}{written ? `/${written}` : ''}, {percent(markup)} markup</span
					>
				</div>
			</div>
		{/if}

		<div class="fld">
			<span class="lbl">Who paid</span>
			<input type="hidden" name="paid_by" value={paidBy} />
			<div class="seg">
				{#each data.people as p (p.id)}
					<button type="button" class:on={paidBy === p.id} onclick={() => (paidBy = p.id)}
						>{p.name.split(' ')[0]}</button
					>
				{/each}
				<button type="button" class:on={paidBy === ''} onclick={() => (paidBy = '')}
					>Business</button
				>
			</div>
			<small class="lt">Whoever paid out of their own pocket is owed it back.</small>
			{#if errors.paid_by}<small class="why">{errors.paid_by}</small>{/if}
		</div>

		<div class="fld">
			<span class="lbl">Receipt or invoice</span>
			<!-- The tile is the file input's label, so tapping it opens the
			     phone's camera or its files; the input itself is out of sight. -->
			<div class="shots">
				{#if preview}
					<img class="thumb" src={preview} alt="The receipt chosen" />
				{:else if chosen}
					<span class="thumb doc">{chosen}</span>
				{/if}
				<label class="addshot" for="r-receipt">
					<span class="plus" aria-hidden="true">+</span>
					<span>{chosen ? 'Another' : 'Photo or file'}</span>
				</label>
			</div>
			<input
				id="r-receipt"
				name="receipt"
				class="hidden-file"
				type="file"
				accept="image/*,application/pdf"
				onchange={pick}
			/>
			<small class="lt"
				>A photo, shrunk on this phone before it is sent, or the supplier's PDF.</small
			>
			{#if errors.receipt}<small class="why">{errors.receipt}</small>{/if}
		</div>

		<button class="btn pri blk" disabled={saving}>
			{saving
				? 'Receiving…'
				: qty
					? `Receive ${quantity(qty)}${written ? ` ${written}` : ''}`
					: 'Receive'}
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
	.lbl {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	.inp-wrap {
		position: relative;
		display: block;
	}
	.inp-wrap .hint {
		position: absolute;
		right: 38px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		color: var(--ink-3);
		font-family: var(--f-mono);
		pointer-events: none;
	}
	.bill {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
		border-radius: var(--r);
		background: var(--accent-wash);
		border: 1px solid var(--accent-line);
	}
	.shots {
		display: flex;
		gap: 10px;
	}
	.thumb,
	.addshot {
		width: 92px;
		height: 122px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--line);
		flex: none;
		box-sizing: border-box;
	}
	img.thumb {
		object-fit: cover;
	}
	.thumb.doc {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
		font-size: 11px;
		overflow-wrap: anywhere;
		text-align: center;
		color: var(--ink-2);
	}
	.addshot {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		background: var(--surface-2);
		border-style: dashed;
		color: var(--ink-2);
		font-size: 12px;
		cursor: pointer;
	}
	/* Keyboard focus is on the input out of sight; it shows on the tile. */
	.fld:has(.hidden-file:focus-visible) .addshot {
		outline: 2px solid var(--accent);
	}
	.plus {
		font-size: 24px;
		line-height: 1;
		color: var(--accent);
	}
	/* Out of sight but still in the form, and still reachable by its label. */
	.hidden-file {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
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
