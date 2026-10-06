<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import ReceiptPicker from '#lib/ReceiptPicker.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { enqueueLine, findLine, flush, linesHeld, type QueuedLine } from '#lib/queue.ts';
	import { pct, percent, quantity } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { readFromStock, readPassedOn } from '#lib/line-fields.ts';
	import { fromStock, passedOn } from '#lib/passed-on.ts';
	import { drawFrom, unitCost } from '#lib/stock-draw.ts';
	import { Decimal, Ratio } from '#lib/decimal.ts';
	import { shrink } from '#lib/receipt.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// Stock first, where there is any, as the mock has it.
	let kind = $state<'material' | 'bought' | 'paid_for'>(
		untrack(() => (data.stock.length > 0 ? 'material' : 'bought'))
	);
	let siteId = $state<string>(untrack(() => data.sites[0]?.id ?? ''));
	let materialId = $state('');
	let find = $state('');
	let qty = $state('');
	let description = $state('');
	let cost = $state('');
	let taxPaid = $state('');
	let paidBy = $state(''); // empty is the business
	let boughtFrom = $state('');
	let saving = $state(false);
	let why = $state('');
	let errors = $state<Record<string, string>>({});
	let waiting = $state(0);

	// A line the server refused, opened from the draft to be fixed: its fields
	// as they were, its receipt kept unless another is chosen, and the server's
	// reason. Saving it queues it again under its own uuid, which clears the
	// refusal.
	let fixing = $state<QueuedLine | null>(null);
	onMount(() => {
		void linesHeld().then(
			(all) => (waiting = all.filter((q) => !q.refused).length),
			() => {}
		);
		const id = page.url.searchParams.get('fix');
		if (!id) return;
		void findLine(id).then(
			(q) => {
				if (!q || q.line.invoice_id !== data.draft.id) return;
				const f = q.line.fields;
				fixing = q;
				kind = q.line.shown.kind;
				siteId = f.site_id ?? '';
				materialId = f.material_id ?? '';
				qty = f.qty ?? '';
				description = f.description ?? '';
				boughtFrom = f.bought_from ?? '';
				cost = f.ex_tax_cost ?? '';
				taxPaid = f.tax_paid ?? '';
				paidBy = f.paid_by ?? '';
				errors = q.refused?.errors ?? {};
			},
			() => {}
		);
	});

	const site = $derived(data.sites.find((s) => s.id === siteId));
	const stock = $derived(kind === 'material');
	const bought = $derived(kind === 'bought');

	type Item = (typeof data.stock)[number];
	const item = $derived(data.stock.find((m) => m.id === materialId));
	const onHand = (m: Item) => m.shelf.lots.reduce((n, l) => n.add(l.qtyRemaining), Decimal.ZERO);
	const shown = $derived(
		data.stock.filter((m) =>
			`${m.name} ${m.sku ?? ''}`.toLowerCase().includes(find.trim().toLowerCase())
		)
	);

	/** What one more sells at: its listed price, or what it costs marked up. */
	function priceOf(m: Item) {
		if (m.listed !== null) return m.listed;
		const cost = unitCost(m.shelf, data.costing);
		return cost
			? Ratio.of(cost.exTax).mul(Ratio.of(m.markup).div(100).add(1)).round(4).toString()
			: null;
	}
	/** A price's unit, in words: "each", or "per ft". */
	const per = (m: Item) => (m.unit === 'each' ? 'each' : `per ${m.short}`);

	/** Picks an item, and names the line after it unless it was named already. */
	function pick(m: Item) {
		if (description === '' || description === item?.name) description = m.name;
		materialId = m.id;
	}

	/** What a draw takes, what it bills and its tax, by the rule the server saves it by. */
	const drawn = $derived.by(() => {
		if (!item || !/^\d+(\.\d+)?$/.test(qty) || !/[1-9]/.test(qty)) return null;
		const draw = drawFrom(item.shelf, qty, data.costing);
		if ('short' in draw) return { short: draw.short.toString(), needsASite: false };
		const line = fromStock(
			{
				qty,
				unit: item.unit,
				cost: draw.exTaxCost.toString(),
				taxPaid: draw.taxPaid.toString(),
				listed: item.listed,
				markupPct: item.markup,
				taxable: item.taxable
			},
			{ ruleSet: data.rules, siteRatePct: site?.rate_pct ?? null, places: data.places }
		);
		return {
			...line,
			short: null,
			left: onHand(item).sub(qty).toString(),
			tax: line.taxable
				? Ratio.of(line.amount).mul(line.taxRatePct).div(100).round(data.places).toString()
				: null
		};
	});

	/** How the draft words a line, as the server's own page does. */
	const detail = (fields: Record<string, string>) =>
		stock
			? 'From stock'
			: [
					bought ? 'Bought' : 'Paid for them',
					fields.bought_from,
					fields.paid_by
						? `${data.people.find((p) => p.id === fields.paid_by)?.name ?? 'Someone'} paid`
						: 'the business paid',
					bought ? null : 'at cost'
				]
					.filter(Boolean)
					.join(' · ');

	/**
	 * Saves the line on this phone, receipt and all, then sends what is waiting.
	 * The draft opens either way: with the line from the server where there is a
	 * signal, and with it marked as on this phone where there is not.
	 */
	async function save(e: SubmitEvent) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget as HTMLFormElement);
		const fields = Object.fromEntries(
			[...formData.entries()].filter((x): x is [string, string] => typeof x[1] === 'string')
		);
		errors = stock
			? readFromStock(fields, item?.places ?? null).errors
			: readPassedOn(fields).errors;
		if (stock && drawn?.short)
			errors.qty = `Only ${quantity(drawn.short)} ${item?.short} on the shelf.`;
		if (stock ? drawn?.needsASite : bills?.needsASite)
			errors.site_id = 'Where it went, so its tax rate is known.';
		const line = stock ? drawn : bills;
		if (Object.keys(errors).length > 0 || !line || line.short !== null) return;
		saving = true;
		why = '';
		const file = formData.get('receipt');
		const receipt =
			file instanceof File && file.size > 0 ? await shrink(file) : (fixing?.line.receipt ?? null);
		try {
			await enqueueLine({
				client_uuid: fixing?.line.client_uuid ?? crypto.randomUUID(),
				invoice_id: data.draft.id,
				fields,
				receipt: stock ? null : receipt,
				shown: {
					kind,
					description: fields.description,
					detail: detail(fields),
					qty: line.qty,
					unit: line.unit,
					unit_price: line.unitPrice,
					amount: line.amount,
					taxable: line.taxable,
					tax_rate_pct: line.taxRatePct
				}
			});
		} catch {
			why = 'This phone would not save the line, so it is not added.';
			saving = false;
			return;
		}
		// A few seconds for the server to take it; no longer, so a phone with a
		// weak signal is not left waiting on a page that has done its part.
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		await goto(resolve('/invoices/[id]', { id: data.draft.id }), { invalidateAll: true });
	}

	/** What the line will bill and the tax on it, by the rule the server saves it by. */
	const bills = $derived.by(() => {
		if (!/^\d+(\.\d+)?$/.test(cost) || stock) return null;
		const line = passedOn(
			{ kind: bought ? 'bought' : 'paid_for', cost, taxPaid: taxPaid || '0' },
			{
				purchaseMarkupPct: data.markup,
				ruleSet: data.rules,
				siteRatePct: site?.rate_pct ?? null,
				places: data.places
			}
		);
		return {
			...line,
			short: null,
			tax: line.taxable
				? Ratio.of(line.amount).mul(line.taxRatePct).div(100).round(data.places).toString()
				: null
		};
	});
</script>

<Top
	title="Add a line"
	sub={`Draft ${data.draft.number} · ${data.draft.who}`}
	back={resolve('/invoices/[id]', { id: data.draft.id })}
	backLabel={data.draft.number}
/>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if fixing?.refused}
		<p class="why">
			Refused: {fixing.refused.detail} Fix it and add it again, or discard it from the draft.
		</p>
	{/if}
	{#if why}<p class="why">{why}</p>{/if}
	<form class="rows form" onsubmit={save}>
		<div class="fld">
			<span class="lbl">Kind</span>
			<input type="hidden" name="kind" value={kind} />
			<div class="seg">
				<button type="button" class:on={stock} onclick={() => (kind = 'material')}
					>From stock</button
				>
				<button type="button" class:on={bought} onclick={() => (kind = 'bought')}>Bought</button>
				<button type="button" class:on={kind === 'paid_for'} onclick={() => (kind = 'paid_for')}
					>Paid for them</button
				>
			</div>
			<small class="lt">
				{stock
					? 'Anything held in stock, in whatever unit it is counted.'
					: bought
						? 'Goods bought for this job and passed on.'
						: 'A fee, a hire or a bill paid on their behalf. Not goods.'}
			</small>
			{#if errors.kind}<small class="why">{errors.kind}</small>{/if}
		</div>

		<div class="fld">
			<label for="l-site">Where</label>
			<span class="inp-wrap">
				<select id="l-site" name="site_id" class="inp" bind:value={siteId}>
					<option value="">Not at one of their sites</option>
					{#each data.sites as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
				</select>
				{#if site?.rate_pct}<span class="hint">{pct(site.rate_pct)}</span>{/if}
			</span>
			{#if errors.site_id}<small class="why">{errors.site_id}</small>{/if}
		</div>

		{#if stock}
			<div class="fld">
				<label for="l-find">Item</label>
				<input
					id="l-find"
					class="inp"
					type="search"
					placeholder="Find in stock"
					autocomplete="off"
					bind:value={find}
				/>
				<input type="hidden" name="material_id" value={materialId} />
				{#if errors.material_id}<small class="why">{errors.material_id}</small>{/if}
			</div>
			<div class="rows inset pick" role="radiogroup" aria-label="Item">
				{#each shown as m (m.id)}
					<button
						type="button"
						class="rec"
						class:on={m.id === materialId}
						role="radio"
						aria-checked={m.id === materialId}
						onclick={() => pick(m)}
					>
						<span class="rec-m">
							<span class="rec-t">{m.name}</span>
							<span class="rec-s">{quantity(onHand(m).toString())} {m.short} on the shelf</span>
						</span>
						<span class="rec-n">
							<span class="rec-v">{unitPrice(priceOf(m))}</span>
							<span class="rec-x">{per(m)}</span>
						</span>
					</button>
				{:else}
					<div class="rec">
						<span class="rec-m"
							><span class="rec-t"
								><span class="lt"
									>{data.stock.length ? 'Nothing in stock by that name' : 'Nothing in stock'}</span
								></span
							></span
						>
					</div>
				{/each}
			</div>

			<div class="fld">
				<label for="l-qty">How much</label>
				<span class="inp-wrap">
					<input
						id="l-qty"
						name="qty"
						class="inp"
						inputmode="decimal"
						placeholder="147"
						bind:value={qty}
					/>
					{#if item}<span class="hint">{item.short}</span>{/if}
				</span>
				{#if errors.qty}<small class="why">{errors.qty}</small>{/if}
			</div>
		{/if}

		<div class="fld">
			<label for="l-desc">Description — appears on the invoice</label>
			<input
				id="l-desc"
				name="description"
				class="inp"
				placeholder={stock
					? 'Cat6 plenum cable'
					: bought
						? 'Keystone jacks ×12, faceplates ×3'
						: 'Low-voltage permit'}
				bind:value={description}
			/>
			{#if errors.description}<small class="why">{errors.description}</small>{/if}
		</div>

		{#if stock}
			{#if drawn && drawn.short === null}
				<div class="bill">
					<div class="kv">
						<span class="k">Bills</span>
						<span class="v"
							>{money(drawn.amount)}, {unitPrice(drawn.unitPrice)} {item ? per(item) : ''}</span
						>
					</div>
					<div class="kv">
						<span class="k">Tax</span>
						<span class="v"
							>{drawn.tax !== null
								? `${money(drawn.tax)} at ${pct(drawn.taxRatePct)}`
								: drawn.needsASite
									? 'needs the site it went to'
									: 'none'}</span
						>
					</div>
					<div class="kv">
						<span class="k">Cost</span>
						<span class="v"
							>{money(drawn.exTaxCost)} and {money(drawn.taxPaid)} tax, {data.costing === 'average'
								? 'at the average'
								: 'oldest first'}</span
						>
					</div>
					<div class="kv">
						<span class="k">Left after</span>
						<span class="v">{quantity(drawn.left)} {item?.short}</span>
					</div>
				</div>
			{:else if drawn?.short}
				<small class="why">Only {quantity(drawn.short)} {item?.short} on the shelf.</small>
			{/if}
		{:else}
			<div class="fld">
				<label for="l-from">{bought ? 'Bought from' : 'Paid to'}</label>
				<input
					id="l-from"
					name="bought_from"
					class="inp"
					placeholder={bought ? 'Valley Hardware' : 'City of Woodland'}
					bind:value={boughtFrom}
				/>
				{#if errors.bought_from}<small class="why">{errors.bought_from}</small>{/if}
			</div>

			<div class="fld">
				<label for="l-cost">{bought ? 'Cost before tax, all of it' : 'What was paid'}</label>
				<input
					id="l-cost"
					name="ex_tax_cost"
					class="inp"
					inputmode="decimal"
					placeholder="33.33"
					bind:value={cost}
				/>
				{#if errors.ex_tax_cost}<small class="why">{errors.ex_tax_cost}</small>{/if}
			</div>

			{#if bought}
				<div class="fld">
					<label for="l-tax">Tax paid, all of it</label>
					<input
						id="l-tax"
						name="tax_paid"
						class="inp"
						inputmode="decimal"
						placeholder="0.00"
						bind:value={taxPaid}
					/>
					{#if errors.tax_paid}<small class="why">{errors.tax_paid}</small>{/if}
				</div>
			{/if}

			{#if bills}
				<div class="bill">
					<div class="kv">
						<span class="k">Bills</span>
						<span class="v"
							>{money(bills.amount)}{bought && Number(data.markup) > 0
								? `, ${percent(data.markup)} over cost`
								: bought
									? ', as it cost'
									: ', at cost'}</span
						>
					</div>
					<div class="kv">
						<span class="k">Tax</span>
						<span class="v"
							>{bills.tax !== null
								? `${money(bills.tax)} at ${pct(bills.taxRatePct)}`
								: bills.needsASite
									? 'needs the site it went to'
									: 'none'}</span
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
				<span class="lbl">Receipt</span>
				<ReceiptPicker id="l-receipt" />
				<small class="lt"
					>{fixing?.line.receipt
						? 'The receipt taken before is kept unless another is chosen.'
						: 'A photo, shrunk on this phone before it is sent, or a PDF.'}</small
				>
				{#if errors.receipt}<small class="why">{errors.receipt}</small>{/if}
			</div>
		{/if}

		<button class="btn pri blk" disabled={saving}>{saving ? 'Adding…' : 'Add the line'}</button>
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
	#l-qty + .hint {
		right: 14px;
	}
	.pick {
		margin-top: -6px;
	}
	.pick button.rec {
		width: 100%;
		text-align: left;
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		cursor: pointer;
	}
	.pick .rec-m,
	.pick .rec-n,
	.pick .rec-t,
	.pick .rec-s {
		display: block;
	}
	.pick .rec.on {
		background: var(--accent-wash);
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.pick button.rec:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
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
	.why {
		color: var(--crit);
		font-size: 12.5px;
	}
	button.btn[disabled] {
		opacity: 0.6;
		cursor: default;
	}
</style>
