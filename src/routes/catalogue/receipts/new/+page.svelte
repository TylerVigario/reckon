<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Top from '#lib/Top.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import UnderlinePanels from '#lib/UnderlinePanels.svelte';
	import { Decimal, Ratio, sum } from '#lib/decimal.ts';
	import { percent, quantity } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { readItem, readReceipt, MOST_ITEMS } from '#lib/stock-fields.ts';
	import { itemTotals } from '#lib/receipt-split.ts';
	import { shrink } from '#lib/receipt.ts';
	import ReceiptPicker from '#lib/ReceiptPicker.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * STOCK RECEIVED, AS A RECEIPT OR INVOICE SAYS IT (#lib/stock-fields), as
	 * two tabs of one form (#lib/UnderlinePanels): the Receipt -- what it prints
	 * once: from whom, the day, its number, who paid, the paper itself and its
	 * tax -- and its Items, a row each. What it all comes to, and Receive, stay
	 * pinned at the foot under both, to check against the paper.
	 *
	 * An item is added or changed in a dialog, which fills a phone's screen:
	 * what it is, how many, in packs of how many of its own unit, and its price
	 * for each or for all of them, with what that puts on the shelf worked out
	 * as it is typed (#lib/receipt-split). An item has six things to say, so
	 * each is entered on its own and listed as a row -- the Ministry of
	 * Justice's "add to a list", which it gives for anything longer than a few
	 * short fields.
	 */
	let { data, form }: PageProps = $props();

	type Item = {
		key: number;
		materialId: string;
		name: string;
		unitId: string;
		count: string;
		per: string;
		price: string;
		priceIs: 'each' | 'all';
	};
	let made = 0;
	const blank = (): Item => ({
		key: made++,
		materialId: data.material ?? data.materials[0]?.id ?? '',
		name: '',
		unitId: data.units[0]?.id ?? '',
		count: '',
		per: '',
		price: '',
		priceIs: 'all'
	});

	// Seeded once; after that the boxes are the truth.
	let supplier = $state('');
	let reference = $state('');
	let day = $state(untrack(() => data.today));
	let paidBy = $state(''); // empty is the business
	let tax = $state('');
	let items = $state<Item[]>([]);
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});
	/** Which tab is open: the receipt as printed once, or its items. */
	let part = $state<'receipt' | 'items'>('receipt');
	const itemsWrong = $derived(Object.keys(errors).some((k) => k.startsWith('items')));
	const receiptWrong = $derived(Object.keys(errors).some((k) => !k.startsWith('items')));
	/** Where a complaint is, that tab is opened: the receipt's first. */
	function showWrong() {
		if (receiptWrong) part = 'receipt';
		else if (itemsWrong) part = 'items';
	}
	$effect(() => {
		if (form?.errors) {
			errors = form.errors;
			showWrong();
		}
	});

	/** The item open in the dialog: a copy, put back only when it reads right. */
	let draft = $state<Item | null>(null);
	let draftErrors = $state<Record<string, string>>({});

	const materialOf = (it: Item) => data.materials.find((m) => m.id === it.materialId);
	const unitOf = (it: Item) => {
		const m = materialOf(it);
		return data.units.find((u) => u.id === (m ? m.unit_id : it.unitId));
	};
	const written = (it: Item) => {
		const u = unitOf(it);
		return u ? (u.short ?? u.name) : '';
	};
	/** "a ft", but "each" for what is counted each. */
	const per = (it: Item) => (written(it) === 'each' ? 'each' : `a ${written(it)}`);
	const fieldsOf = (it: Item) => ({
		material_id: it.materialId,
		name: it.name,
		unit_id: it.unitId,
		count: it.count,
		per: it.per,
		price: it.price,
		price_is: it.priceIs
	});
	/** What an item puts on the shelf, and what one costs and sells at; or nothing yet. */
	const shelfOf = (it: Item) => {
		const t = itemTotals(
			{ count: it.count, per: it.per, price: it.price, priceIs: it.priceIs },
			data.places
		);
		if (!t || Decimal.from(t.qty).isZero()) return null;
		const one = Ratio.of(t.cost).div(t.qty);
		const markup = materialOf(it)?.markup_pct ?? data.markup;
		return {
			qty: t.qty,
			cost: t.cost,
			each: one.round(4).toString(),
			sells: one.mul(Ratio.of(markup).div(100).add(1)).round(4).toString(),
			markup
		};
	};
	const nameOf = (it: Item) => materialOf(it)?.name ?? it.name;

	const totals = $derived.by(() => {
		const goods = sum(items.map((it) => shelfOf(it)?.cost ?? null));
		let charged = Decimal.ZERO;
		try {
			charged = Decimal.from(tax || '0');
		} catch {
			/* not a figure yet */
		}
		return {
			goods: goods.toFixed(data.places),
			tax: charged.toFixed(data.places),
			all: goods.add(charged).toFixed(data.places)
		};
	});

	function open(it: Item | null) {
		draft = it ? { ...it } : blank();
		draftErrors = {};
	}
	/** The dialog's own button: the item is put on the list once it reads right. */
	function keep() {
		if (!draft) return;
		const checked = readItem(fieldsOf(draft), unitOf(draft)?.places ?? null, data.places);
		draftErrors = checked.errors;
		if (!checked.item) return;
		const at = items.findIndex((it) => it.key === draft!.key);
		if (at === -1) items.push(draft);
		else items[at] = draft;
		draft = null;
		// What the server said of the list before no longer stands.
		errors = Object.fromEntries(Object.entries(errors).filter(([k]) => !k.startsWith('items')));
	}
	function remove(key: number) {
		items = items.filter((it) => it.key !== key);
		errors = Object.fromEntries(Object.entries(errors).filter(([k]) => !k.startsWith('items')));
	}
	/** What is wrong with an item, said on its row: the first thing. */
	const wrongWith = (i: number) =>
		Object.entries(errors).find(([k]) => k.startsWith(`items.${i}.`))?.[1] ?? null;
	const errId = (key: string) => `r-${key.replaceAll('.', '-')}-e`;
</script>

{#snippet wrong(key: string, from: Record<string, string> = errors)}
	{#if from[key]}
		<p class="fc-e" id={errId(key)}><Octicon name="alert" />{from[key]}</p>
	{/if}
{/snippet}

<Top
	title="Receive stock"
	sub="A receipt or invoice, and what was on it"
	back={resolve('/catalogue/receipts')}
	backLabel="Receipts"
/>

<div class="pad primer">
	<form
		id="receive"
		method="POST"
		enctype="multipart/form-data"
		novalidate
		use:enhance={async ({ formData, cancel }) => {
			const fields = Object.fromEntries(
				[...formData.entries()].filter((e): e is [string, string] => typeof e[1] === 'string')
			);
			const sent = items.map(fieldsOf);
			errors = readReceipt(
				fields,
				sent,
				(raw) => {
					const it = items[sent.indexOf(raw as (typeof sent)[number])];
					return it ? (unitOf(it)?.places ?? null) : null;
				},
				data.places
			).errors;
			if (Object.keys(errors).length > 0) {
				showWrong();
				return cancel();
			}
			saving = true;
			formData.set('items', JSON.stringify(sent));
			// A photo goes shrunk, so a receipt costs a few hundred kilobytes.
			const file = formData.get('receipt');
			if (file instanceof File && file.size > 0) formData.set('receipt', await shrink(file));
			return async ({ update }) => {
				await update({ reset: false });
				saving = false;
			};
		}}
	>
		<UnderlinePanels
			label="Receiving stock"
			id="rcv"
			bind:selected={part}
			tabs={[
				{ id: 'receipt', label: 'Receipt', flagged: receiptWrong },
				{ id: 'items', label: 'Items', count: items.length, flagged: itemsWrong }
			]}
		/>

		<div
			role="tabpanel"
			id="rcv-panel-receipt"
			aria-labelledby="rcv-tab-receipt"
			hidden={part !== 'receipt'}
		>
			<section class="box" aria-labelledby="receipt-h">
				<div class="box-h"><h2 class="box-t" id="receipt-h">What it prints once</h2></div>
				<div class="box-row form">
					<div class="fc">
						<label class="fc-l" for="r-from">Bought from</label>
						<input
							id="r-from"
							name="supplier"
							class="ti"
							autocomplete="off"
							bind:value={supplier}
							aria-invalid={errors.supplier ? 'true' : undefined}
							aria-describedby={errors.supplier ? errId('supplier') : undefined}
						/>
						{@render wrong('supplier')}
					</div>
					<div class="pair">
						<div class="fc">
							<label class="fc-l" for="r-day">Day<span aria-hidden="true"> *</span></label>
							<input
								id="r-day"
								name="received_on"
								class="ti"
								type="date"
								max={data.today}
								bind:value={day}
								aria-invalid={errors.received_on ? 'true' : undefined}
								aria-describedby={errors.received_on ? errId('received_on') : undefined}
							/>
							{@render wrong('received_on')}
						</div>
						<div class="fc">
							<label class="fc-l" for="r-ref">Its number</label>
							<input
								id="r-ref"
								name="reference"
								class="ti"
								autocomplete="off"
								bind:value={reference}
								aria-invalid={errors.reference ? 'true' : undefined}
								aria-describedby={errors.reference ? errId('reference') : undefined}
							/>
							{@render wrong('reference')}
						</div>
					</div>
					<div class="pair">
						<div class="fc">
							<label class="fc-l" for="r-paid">Who paid</label>
							<select
								id="r-paid"
								name="paid_by"
								class="ti"
								bind:value={paidBy}
								aria-describedby={errors.paid_by ? errId('paid_by') : 'r-paid-c'}
							>
								<option value="">The business</option>
								{#each data.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
							</select>
							{#if errors.paid_by}
								{@render wrong('paid_by')}
							{:else}
								<p class="fc-c" id="r-paid-c">Paid from their pocket: owed it back.</p>
							{/if}
						</div>
						<div class="fc">
							<label class="fc-l" for="r-tax">Tax on it</label>
							<input
								id="r-tax"
								name="tax_paid"
								class="ti"
								inputmode="decimal"
								autocomplete="off"
								bind:value={tax}
								aria-invalid={errors.tax_paid ? 'true' : undefined}
								aria-describedby={errors.tax_paid ? errId('tax_paid') : 'r-tax-c'}
							/>
							{#if errors.tax_paid}
								{@render wrong('tax_paid')}
							{:else}
								<p class="fc-c" id="r-tax-c">All of it: split over the items by cost.</p>
							{/if}
						</div>
					</div>
					<div class="fc">
						<span class="fc-l">Photo or PDF</span>
						<ReceiptPicker id="r-receipt" />
						{@render wrong('receipt')}
					</div>
				</div>
			</section>
		</div>

		<div
			role="tabpanel"
			id="rcv-panel-items"
			aria-labelledby="rcv-tab-items"
			hidden={part !== 'items'}
		>
			<section class="box" aria-labelledby="items-h">
				<div class="box-h">
					<h2 class="box-t" id="items-h">What was on it</h2>
					{#if items.length < MOST_ITEMS}
						<button type="button" class="btn sm" onclick={() => open(null)}>Add an item</button>
					{/if}
				</div>
				{#each items as it, i (it.key)}
					{@const shelf = shelfOf(it)}
					{@const bad = wrongWith(i)}
					<div class="box-row line" data-item={i}>
						<span class="what">
							<span class="n">{nameOf(it)}</span>
							{#if shelf}
								<span class="sub"
									>{quantity(shelf.qty)}
									{written(it)} · {money(shelf.cost)} · {unitPrice(shelf.each)}
									{per(it)}</span
								>
							{/if}
							{#if bad}<span class="fc-e"><Octicon name="alert" />{bad}</span>{/if}
						</span>
						{#if !materialOf(it)}<span class="lab acc">New</span>{/if}
						<span class="acts">
							<button type="button" class="btn sm" onclick={() => open(it)}>Edit</button>
							<button type="button" class="btn sm" onclick={() => remove(it.key)}>Remove</button>
						</span>
					</div>
				{:else}
					<p class="box-row muted">Nothing yet. Add an item for each line of the receipt.</p>
				{/each}
				{#if errors.items}<div class="box-row">{@render wrong('items')}</div>{/if}
			</section>
		</div>

		<div class="foot">
			<p class="sum" data-total>
				<span>
					{items.length}
					{items.length === 1 ? 'item' : 'items'} · {money(totals.goods)} + {money(totals.tax)} tax
				</span>
				<span class="all">Total <span class="v">{money(totals.all)}</span></span>
			</p>
			<div class="keep">
				<button type="submit" class="btn pri" disabled={saving || items.length === 0}>
					{saving ? 'Receiving…' : items.length > 1 ? `Receive ${items.length} items` : 'Receive'}
				</button>
				<a class="btn" href={resolve('/catalogue/receipts')}>Cancel</a>
			</div>
		</div>
	</form>
</div>

<Dialog
	open={draft !== null}
	title={draft && items.some((it) => it.key === draft!.key) ? 'Change the item' : 'Add an item'}
	go={draft && items.some((it) => it.key === draft!.key) ? 'Save item' : 'Add item'}
	ongo={keep}
	onclose={() => (draft = null)}
>
	{#if draft}
		{@const m = materialOf(draft)}
		{@const shelf = shelfOf(draft)}
		<div class="fc">
			<label class="fc-l" for="d-item">What</label>
			<select id="d-item" class="ti" bind:value={draft.materialId}>
				{#each data.materials as mm (mm.id)}<option value={mm.id}>{mm.name}</option>{/each}
				<option value="">Something new…</option>
			</select>
			{#if m && written(draft)}<p class="fc-c">Counted in {written(draft)}.</p>{/if}
		</div>
		{#if !m}
			<div class="fc">
				<label class="fc-l" for="d-name">What it is<span aria-hidden="true"> *</span></label>
				<input
					id="d-name"
					class="ti"
					autocomplete="off"
					bind:value={draft.name}
					aria-invalid={draftErrors.name ? 'true' : undefined}
				/>
				{@render wrong('name', draftErrors)}
			</div>
			<div class="fc">
				<label class="fc-l" for="d-unit">Counted in</label>
				<select id="d-unit" class="ti" bind:value={draft.unitId}>
					{#each data.units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
				</select>
				<p class="fc-c">
					Not listed? <a class="lk" href={resolve('/settings/units')}>Add a unit</a>.
				</p>
			</div>
		{/if}
		<div class="pair">
			<div class="fc">
				<label class="fc-l" for="d-count">How many<span aria-hidden="true"> *</span></label>
				<input
					id="d-count"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={draft.count}
					aria-invalid={draftErrors.count ? 'true' : undefined}
				/>
				{@render wrong('count', draftErrors)}
			</div>
			<div class="fc">
				<label class="fc-l" for="d-per">In packs of</label>
				<span class="tv">
					<input
						id="d-per"
						class="ti"
						inputmode="decimal"
						autocomplete="off"
						bind:value={draft.per}
						aria-invalid={draftErrors.per ? 'true' : undefined}
					/>
					{#if written(draft)}<span class="tv-v" aria-hidden="true">{written(draft)}</span>{/if}
				</span>
				{#if draftErrors.per}
					{@render wrong('per', draftErrors)}
				{:else}
					<p class="fc-c">Empty where they come singly.</p>
				{/if}
			</div>
		</div>
		<div class="fc">
			<label class="fc-l" for="d-price">Price before tax<span aria-hidden="true"> *</span></label>
			<input
				id="d-price"
				class="ti"
				inputmode="decimal"
				autocomplete="off"
				bind:value={draft.price}
				aria-invalid={draftErrors.price ? 'true' : undefined}
			/>
			{@render wrong('price', draftErrors)}
		</div>
		<fieldset class="fc">
			<legend class="fc-l">The price is for</legend>
			<label class="rad">
				<input type="radio" name="d-for" value="all" bind:group={draft.priceIs} />
				<span><span class="rad-t">All of them</span></span>
			</label>
			<label class="rad">
				<input type="radio" name="d-for" value="each" bind:group={draft.priceIs} />
				<span
					><span class="rad-t">Each {draft.per ? 'pack' : 'one'}</span><span class="rad-c"
						>As a receipt prints “2 @ 12.97”.</span
					></span
				>
			</label>
		</fieldset>
		{#if shelf}
			<p class="shelf" data-shelf>
				<span class="v">{quantity(shelf.qty)} {written(draft)}</span> for
				<span class="v">{money(shelf.cost)}</span>:
				<span class="v">{unitPrice(shelf.each)}</span>
				{per(draft)}, selling at <span class="v">{unitPrice(shelf.sells)}</span> with {percent(
					shelf.markup
				)} markup.
			</p>
		{/if}
	{/if}
</Dialog>

<style>
	/* The screen fills the window down to the bar of sections, so the foot
	   rests at the bottom however short the open tab is, and pins there once it
	   is longer. Only this screen: the rest keep their own height. */
	:global(main:has(#receive)) {
		display: flex;
		flex-direction: column;
	}
	:global(.pad:has(> #receive)) {
		flex: 1 0 auto;
		padding-bottom: 0;
	}
	form {
		flex: 1 0 auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fc {
		max-width: 440px;
	}
	/* Two short fields side by side, down to a phone's width. */
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: 20px;
		max-width: 440px;
	}
	.pair .fc {
		max-width: none;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		min-height: 64px;
		box-sizing: border-box;
		margin: 0;
	}
	.what {
		flex: 1 1 12rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
	.lab {
		flex: 0 0 auto;
	}
	.acts {
		display: flex;
		gap: 8px;
	}
	.tv {
		position: relative;
		display: block;
	}
	.tv .ti {
		padding-right: 64px;
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
	.shelf {
		margin: 0;
		font-size: 13px;
		color: var(--ink-2);
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
		color: var(--ink);
	}
	/* What it all comes to, and Receive, pinned above the bar of sections on a
	   phone (it is --tabh tall, its border and the safe area under it) and at
	   the window's foot where the rail takes its place. */
	.foot {
		margin-top: auto;
		position: sticky;
		bottom: calc(var(--tabh) + 1px + env(safe-area-inset-bottom));
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-inline: calc(-1 * var(--pad));
		padding: 12px var(--pad);
		background: var(--surface);
		border-top: 1px solid var(--line);
	}
	@media (min-width: 1180px) {
		.foot {
			bottom: 16px;
			margin-inline: 0;
			margin-bottom: 16px;
			border: 1px solid var(--line);
			border-radius: 6px;
		}
	}
	.sum {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 4px 12px;
		font-size: 13px;
		color: var(--ink-2);
	}
	.sum .all {
		font-weight: 600;
		color: var(--ink);
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
</style>
