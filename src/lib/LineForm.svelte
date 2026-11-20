<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import ReceiptPicker from '#lib/ReceiptPicker.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import {
		enqueueChange,
		enqueueLine,
		findLine,
		flush,
		notKept,
		waitingCount,
		materialChangesHeld,
		stockHeld,
		type MaterialChange,
		type QueuedLine,
		type ShownReceipt
	} from '#lib/queue.ts';
	import { withChanged, withReceived } from '#lib/stock-held.ts';
	import { pct, percent, quantity } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { readFromStock, readPassedOn } from '#lib/line-fields.ts';
	import { fromStock, passedOn, type Taxes } from '#lib/passed-on.ts';
	import { changeDraw, drawFrom, unitCost } from '#lib/stock-draw.ts';
	import { Decimal, Ratio } from '#lib/decimal.ts';
	import { shrink } from '#lib/receipt.ts';
	import type { Costing, Shelf } from '#lib/stock-draw.ts';
	import type { ResolvedPathname } from '$app/types';
	import { busy } from './busy.svelte.ts';

	/**
	 * ADD A LINE: goods drawn from stock, goods bought for the job, or a cost
	 * paid on the client's behalf, saved on this phone and sent by the queue
	 * (#lib/queue). For a draft the server has, and for one started on this
	 * phone that has not arrived yet: the form is the same, and only where it
	 * came from differs.
	 */
	type Props = {
		data: {
			draft: {
				/** The server's id, or -- a draft started here -- the uuid this phone made for it. */
				id: string;
				/** The uuid it was started with on a phone, where it was. */
				client_uuid?: string | null;
				/** Its number, or null until it arrives. */
				number: string | null;
				who: string;
				/** Where it has gone out, a line added now starts a new draft (#lib/server/lines). */
				status?: string;
			};
			/**
			 * Each with its state, and its rate where the business collects there
			 * and the site has been placed.
			 */
			sites: { id: string; label: string | null; state: string; rate_pct: string | null }[];
			people: { id: string; name: string }[];
			markup: string;
			/** What stock sells at over its cost, where a material has no markup of its own. */
			stock_markup?: string;
			/** Each state the business collects in, and the kinds of sale it taxes there. */
			taxes: Taxes;
			/** reckon's goods, which goods bought for the job are sold as. */
			goods: string;
			costing: Costing;
			places: number;
			stock: {
				id: string;
				name: string;
				sku: string | null;
				unit: string;
				short: string;
				places: number;
				markup: string;
				listed: string | null;
				/** The kind of sale it is. */
				kind: string;
				shelf: Shelf;
			}[];
			as_of: string;
		};
		/**
		 * The draft's own screen: where the form goes back to, and after a save.
		 * A draft started here is one screen with the draft in its query.
		 */
		back: ResolvedPathname;
		/**
		 * A line already on the draft, to be changed: its fields as Add a line
		 * names them, whether it has a receipt, and -- one from stock -- what it
		 * draws now. Its kind, and the item a line from stock is of, stay as they
		 * are. Changed with a signal: #lib/server/lines changeLine.
		 */
		editing?: {
			id: string;
			/** The save of the line the change begins from. */
			version: number;
			kind: 'material' | 'bought' | 'paid_for';
			fields: Record<string, string>;
			receipt: boolean;
			drawn: { qty: string; exTaxCost: string; taxPaid: string } | null;
		};
	};
	let { data, back, editing }: Props = $props();
	const named = $derived(
		data.draft.number ? `Draft ${data.draft.number}` : `New draft, on this phone`
	);

	// Stock first, where there is any, as the mock has it.
	let kind = $state<'material' | 'bought' | 'paid_for'>(
		untrack(() => editing?.kind ?? (data.stock.length > 0 ? 'material' : 'bought'))
	);
	const was = untrack(() => editing?.fields ?? {});
	let siteId = $state<string>(
		untrack(() => (editing ? (was.site_id ?? '') : (data.sites[0]?.id ?? '')))
	);
	let materialId = $state(was.material_id ?? '');
	let find = $state('');
	let qty = $state(was.qty ?? '');
	let description = $state(was.description ?? '');
	let cost = $state(was.ex_tax_cost ?? '');
	let taxPaid = $state(was.tax_paid ?? '');
	let paidBy = $state(was.paid_by ?? ''); // empty is the business
	let boughtFrom = $state(was.bought_from ?? '');
	let saving = $state(false);
	let why = $state('');
	let errors = $state<Record<string, string>>({});
	let waiting = $state(0);

	// A line the server refused, opened from the draft to be fixed: its fields
	// as they were, its receipt kept unless another is chosen, and the server's
	// reason. Saving it queues it again under its own uuid, which clears the
	// refusal.
	let fixing = $state<QueuedLine | null>(null);
	// Stock received on this phone and not yet sent is on the shelf here too,
	// something new on it included (#lib/stock-held).
	let received = $state<ShownReceipt[]>([]);
	// And a material changed on this phone is offered as changed.
	let changed = $state<MaterialChange[]>([]);
	const offered = $derived(
		withChanged(
			withReceived(data.stock, received, data.goods),
			changed,
			data.stock_markup ?? data.markup
		)
	);
	onMount(() => {
		void materialChangesHeld().then(
			(rows) => (changed = rows.filter((q) => !q.refused).map((q) => q.change)),
			() => {}
		);
		void stockHeld().then(
			(h) => (received = h.receipts.filter((q) => !q.refused).map((q) => q.receipt.shown)),
			() => {}
		);
		void waitingCount().then(
			(n) => (waiting = n),
			() => {}
		);
		const id = page.url.searchParams.get('fix');
		if (!id) return;
		void findLine(id).then(
			(q) => {
				const mine = [data.draft.id, data.draft.client_uuid].includes(q?.line.invoice_id);
				if (!q || !mine) return;
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
	// Its tax, as #lib/passed-on reads it.
	const siteTax = $derived(site ? { state: site.state, ratePct: site.rate_pct } : null);
	const stock = $derived(kind === 'material');
	const bought = $derived(kind === 'bought');
	// What each kind is, said under it: Primer's RadioGroup, each choice with its caption.
	const KINDS = [
		{
			v: 'material',
			label: 'From stock',
			caption: 'Anything held in stock, in whatever unit it is counted.'
		},
		{ v: 'bought', label: 'Bought', caption: 'Goods bought for this job and passed on.' },
		{
			v: 'paid_for',
			label: 'Paid for them',
			caption: 'A fee, a hire or a bill paid on their behalf. Not goods.'
		}
	] as const;

	type Item = (typeof offered)[number];
	const item = $derived(offered.find((m) => m.id === materialId));
	const onHand = (m: Item) => m.shelf.lots.reduce((n, l) => n.add(l.qtyRemaining), Decimal.ZERO);
	const shown = $derived(
		offered.filter((m) =>
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
	// Picked, the list folds to what was picked; Change opens it again.
	let choosing = $state(untrack(() => !was.material_id));
	function pick(m: Item) {
		if (description === '' || description === item?.name) description = m.name;
		materialId = m.id;
		choosing = false;
	}

	/** What a draw takes, what it bills and its tax, by the rule the server saves it by. */
	const drawn = $derived.by(() => {
		if (!item || !/^\d+(\.\d+)?$/.test(qty) || !/[1-9]/.test(qty)) return null;
		const before = editing?.drawn ?? null;
		// A line being changed draws only the difference: more off the shelf, or
		// some put back at what it paid for one.
		const draw = before
			? changeDraw(item.shelf, before, qty, data.costing)
			: drawFrom(item.shelf, qty, data.costing);
		if ('short' in draw)
			return {
				short: (before ? draw.short.add(before.qty) : draw.short).toString(),
				needsASite: false,
				needsPlacing: false
			};
		const line = fromStock(
			{
				qty,
				unit: item.unit,
				cost: draw.exTaxCost.toString(),
				taxPaid: draw.taxPaid.toString(),
				listed: item.listed,
				markupPct: item.markup,
				kind: item.kind
			},
			{ taxes: data.taxes, site: siteTax, places: data.places }
		);
		return {
			...line,
			short: null,
			left: onHand(item)
				.sub(qty)
				.add(before?.qty ?? '0')
				.toString(),
			tax: line.taxable
				? Ratio.of(line.amount).mul(line.taxRatePct).div(100).round(data.places).toString()
				: null
		};
	});

	/** What the shelf allows: all of it for a new line, what is drawn and more for one changed. */
	const shortBy = (most: string) =>
		editing
			? `Only ${quantity(most)} ${item?.short ?? ''} can be on this line.`
			: `Only ${quantity(most)} ${item?.short ?? ''} on the shelf.`;

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
		if (stock && drawn?.short) errors.qty = shortBy(drawn.short);
		const priced = stock ? drawn : bills;
		if (priced?.needsASite) errors.site_id = 'Where it went, so its tax rate is known.';
		else if (priced?.needsPlacing)
			errors.site_id = 'That site is in no tax area yet, so its rate is not known.';
		const line = stock ? drawn : bills;
		if (Object.keys(errors).length > 0 || !line || line.short !== null) return;
		saving = true;
		why = '';
		const file = formData.get('receipt');
		if (editing) return change(fields, file instanceof File && file.size > 0 ? file : null);
		const receipt =
			file instanceof File && file.size > 0 ? await shrink(file) : (fixing?.line.receipt ?? null);
		try {
			await enqueueLine({
				client_uuid: fixing?.line.client_uuid ?? crypto.randomUUID(),
				invoice_id: data.draft.id,
				fields,
				made_at: new Date().toISOString(),
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
		await goto(back, { refreshAll: true });
	}

	/**
	 * Saves a change to a line already on the draft on this phone, as a line
	 * added is saved, with the save of the line it began from and its fields
	 * then: whatever someone else changed meanwhile is merged with it when it
	 * arrives (#lib/line-merge), and the line's screen says what it ran into.
	 */
	async function change(fields: Record<string, string>, file: File | null) {
		const line = stock ? drawn : bills;
		if (!line || line.short !== null) return;
		try {
			await enqueueChange({
				line_id: editing!.id,
				invoice_id: data.draft.id,
				act: 'change',
				version: editing!.version,
				base: editing!.fields,
				fields,
				receipt: file ? await shrink(file) : null,
				made_at: new Date().toISOString(),
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
		} catch (e) {
			why = notKept(e, 'This phone would not save the change, so it is not made.');
			saving = false;
			return;
		}
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		await goto(back, { refreshAll: true });
	}

	/** What the line will bill and the tax on it, by the rule the server saves it by. */
	const bills = $derived.by(() => {
		if (!/^\d+(\.\d+)?$/.test(cost) || stock) return null;
		const line = passedOn(
			{ kind: bought ? 'bought' : 'paid_for', cost, taxPaid: taxPaid || '0' },
			{
				purchaseMarkupPct: data.markup,
				taxes: data.taxes,
				goods: data.goods,
				site: siteTax,
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

{#snippet wrong(key: string)}
	{#if errors[key]}<p class="fc-e" id="l-{key}-e"><Octicon name="alert" />{errors[key]}</p>{/if}
{/snippet}

<Top
	title={editing ? 'Change the line' : 'Add a line'}
	sub={`${named} · ${data.draft.who}`}
	{back}
	backLabel={editing ? 'The line' : (data.draft.number ?? 'The draft')}
/>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if fixing?.refused}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t why">
					Refused: {fixing.refused.detail} Fix it and add it again, or discard it from the draft.
				</p>
			</div>
		</div>
	{/if}
	{#if data.draft.status && data.draft.status !== 'draft'}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t why">
					{data.draft.number} has gone out, so this line will start a new draft for {data.draft.who}
					when it reaches the server.
				</p>
			</div>
		</div>
	{/if}
	{#if why}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t why">{why}</p></div>
		</div>
	{/if}
	<form class="box form" onsubmit={save}>
		<div class="box-row fields">
			{#if editing}
				<div class="fc">
					<span class="fc-l">Kind</span>
					<input type="hidden" name="kind" value={kind} />
					<span>{KINDS.find((k) => k.v === kind)?.label}</span>
				</div>
			{:else}
				<fieldset class="fc">
					<legend class="fc-l">Kind</legend>
					{#each KINDS as k (k.v)}
						<label class="rad">
							<input type="radio" name="kind" value={k.v} bind:group={kind} />
							<span>
								<span class="rad-t">{k.label}</span>
								<span class="rad-c">{k.caption}</span>
							</span>
						</label>
					{/each}
					{@render wrong('kind')}
				</fieldset>
			{/if}

			<div class="fc">
				<label class="fc-l" for="l-site">Where</label>
				<select id="l-site" name="site_id" class="ti" bind:value={siteId}>
					<option value="">Not at one of their sites</option>
					{#each data.sites as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
				</select>
				{#if errors.site_id}
					{@render wrong('site_id')}
				{:else if site?.rate_pct}
					<p class="fc-c">Taxed there at {pct(site.rate_pct)}.</p>
				{:else if site && site.state in data.taxes}
					<p class="fc-c">In no tax area yet, so nothing taxed can be billed there.</p>
				{/if}
			</div>

			{#if stock && editing}
				<div class="fc">
					<span class="fc-l">Item</span>
					<input type="hidden" name="material_id" value={materialId} />
					<span>{item?.name ?? 'An item no longer in the catalogue'}</span>
					{#if item}
						<p class="fc-c">{quantity(onHand(item).toString())} {item.short} more on the shelf</p>
					{/if}
				</div>
			{:else if stock}
				<div class="fc">
					<span class="fc-l" id="l-item-l">Item</span>
					<input type="hidden" name="material_id" value={materialId} />
					{#if item && !choosing}
						<div class="picked">
							<span class="what">
								<span class="n">{item.name}</span>
								<span class="sub"
									>{quantity(onHand(item).toString())} {item.short} on the shelf</span
								>
							</span>
							<button type="button" class="btn sm" onclick={() => (choosing = true)}>Change</button>
						</div>
					{:else}
						<input
							id="l-find"
							class="ti"
							type="search"
							placeholder="Find in stock"
							autocomplete="off"
							aria-labelledby="l-item-l"
							bind:value={find}
						/>
						<div class="pick" role="radiogroup" aria-labelledby="l-item-l">
							{#each shown as m (m.id)}
								<button
									type="button"
									class="opt"
									role="radio"
									aria-checked={m.id === materialId}
									onclick={() => pick(m)}
								>
									<span class="what">
										<span class="n">{m.name}</span>
										<span class="sub">{quantity(onHand(m).toString())} {m.short} on the shelf</span>
									</span>
									<span class="fig">
										<span class="v">{unitPrice(priceOf(m))}</span>
										<span class="sub">{per(m)}</span>
									</span>
								</button>
							{:else}
								<p class="opt muted">
									{offered.length ? 'Nothing in stock by that name.' : 'Nothing in stock.'}
								</p>
							{/each}
						</div>
					{/if}
					{@render wrong('material_id')}
				</div>
			{/if}

			{#if stock}
				<div class="fc">
					<label class="fc-l" for="l-qty">How much{item ? `, in ${item.short}` : ''}</label>
					<input
						id="l-qty"
						name="qty"
						class="ti"
						inputmode="decimal"
						autocomplete="off"
						placeholder="147"
						bind:value={qty}
					/>
					{@render wrong('qty')}
				</div>
			{/if}

			<div class="fc">
				<label class="fc-l" for="l-desc">Description</label>
				<input
					id="l-desc"
					name="description"
					class="ti"
					autocomplete="off"
					placeholder={stock
						? 'Cat6 plenum cable'
						: bought
							? 'Keystone jacks ×12, faceplates ×3'
							: 'Low-voltage permit'}
					bind:value={description}
				/>
				{#if errors.description}
					{@render wrong('description')}
				{:else}
					<p class="fc-c">As it appears on the invoice.</p>
				{/if}
			</div>

			{#if stock}
				{#if drawn && drawn.short === null}
					<dl class="bill">
						<dt>Bills</dt>
						<dd>{money(drawn.amount)}, {unitPrice(drawn.unitPrice)} {item ? per(item) : ''}</dd>
						<dt>Tax</dt>
						<dd>
							{drawn.tax !== null
								? `${money(drawn.tax)} at ${pct(drawn.taxRatePct)}`
								: drawn.needsASite
									? 'needs the site it went to'
									: drawn.needsPlacing
										? 'needs the site placed in a tax area'
										: 'none'}
						</dd>
						<dt>Cost</dt>
						<dd>
							{money(drawn.exTaxCost)} and {money(drawn.taxPaid)} tax, {data.costing === 'average'
								? 'at the average'
								: 'oldest first'}
						</dd>
						<dt>Left after</dt>
						<dd>{quantity(drawn.left)} {item?.short}</dd>
					</dl>
				{:else if drawn?.short}
					<p class="fc-e why"><Octicon name="alert" />{shortBy(drawn.short)}</p>
				{/if}
			{:else}
				<div class="fc">
					<label class="fc-l" for="l-from">{bought ? 'Bought from' : 'Paid to'}</label>
					<input
						id="l-from"
						name="bought_from"
						class="ti"
						autocomplete="off"
						placeholder={bought ? 'Valley Hardware' : 'City of Woodland'}
						bind:value={boughtFrom}
					/>
					{@render wrong('bought_from')}
				</div>

				<div class="fc">
					<label class="fc-l" for="l-cost"
						>{bought ? 'Cost before tax, all of it' : 'What was paid'}</label
					>
					<input
						id="l-cost"
						name="ex_tax_cost"
						class="ti"
						inputmode="decimal"
						autocomplete="off"
						placeholder="33.33"
						bind:value={cost}
					/>
					{@render wrong('ex_tax_cost')}
				</div>

				{#if bought}
					<div class="fc">
						<label class="fc-l" for="l-tax">Tax paid, all of it</label>
						<input
							id="l-tax"
							name="tax_paid"
							class="ti"
							inputmode="decimal"
							autocomplete="off"
							placeholder="0.00"
							bind:value={taxPaid}
						/>
						{@render wrong('tax_paid')}
					</div>
				{/if}

				{#if bills}
					<dl class="bill">
						<dt>Bills</dt>
						<dd>
							{money(bills.amount)}{bought && Number(data.markup) > 0
								? `, ${percent(data.markup)} over cost`
								: bought
									? ', as it cost'
									: ', at cost'}
						</dd>
						<dt>Tax</dt>
						<dd>
							{bills.tax !== null
								? `${money(bills.tax)} at ${pct(bills.taxRatePct)}`
								: bills.needsASite
									? 'needs the site it went to'
									: bills.needsPlacing
										? 'needs the site placed in a tax area'
										: 'none'}
						</dd>
					</dl>
				{/if}

				<fieldset class="fc">
					<legend class="fc-l">Who paid</legend>
					<p class="fc-c">Whoever paid out of their own pocket is owed it back.</p>
					{#each data.people as p (p.id)}
						<label class="rad">
							<input type="radio" name="paid_by" value={p.id} bind:group={paidBy} />
							<span class="rad-t">{p.name}</span>
						</label>
					{/each}
					<label class="rad">
						<input type="radio" name="paid_by" value="" bind:group={paidBy} />
						<span class="rad-t">The business</span>
					</label>
					{@render wrong('paid_by')}
				</fieldset>

				<div class="fc">
					<span class="fc-l">Receipt</span>
					<ReceiptPicker id="l-receipt" />
					<p class="fc-c">
						{fixing?.line.receipt || editing?.receipt
							? 'The receipt taken before is kept unless another is chosen.'
							: 'A photo, shrunk on this phone before it is sent, or a PDF.'}
					</p>
					{@render wrong('receipt')}
				</div>
			{/if}
		</div>
		<div class="box-row keep">
			<button
				class="btn pri"
				{@attach busy(saving && (editing ? 'Saving the change' : 'Adding the line'))}
				>{editing ? 'Save the change' : 'Add the line'}</button
			>
			<a class="btn" href={back}>Cancel</a>
		</div>
	</form>
</div>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fc {
		max-width: 480px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--bgColor-muted);
	}
	/* Primer's ActionList for one choice: each item a row, the chosen one
	   marked, in a bordered list under the field that finds it. */
	.pick {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--borderColor-default);
		border-radius: var(--borderRadius-medium);
		overflow: hidden;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
		padding: 8px 12px;
		font: inherit;
		color: inherit;
		text-align: left;
		background: var(--bgColor-default);
		border: 0;
		cursor: pointer;
	}
	.opt + .opt {
		border-top: 1px solid var(--borderColor-muted);
	}
	.opt:hover {
		background: var(--control-transparent-bgColor-hover);
	}
	.opt[aria-checked='true'] {
		background: var(--bgColor-accent-muted);
		box-shadow: inset 3px 0 0 var(--borderColor-accent-emphasis);
	}
	.opt:focus-visible {
		outline: 2px solid var(--focus-outlineColor);
		outline-offset: -2px;
	}
	.picked {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		border: 1px solid var(--borderColor-default);
		border-radius: var(--borderRadius-medium);
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	/* What the line comes to, as it is filled in. */
	.bill {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 6px 16px;
		margin: 0;
		padding: 12px 16px;
		background: var(--bgColor-muted);
		border: 1px solid var(--borderColor-default);
		border-radius: var(--borderRadius-medium);
	}
	.bill dt {
		font-weight: 600;
	}
	.bill dd {
		margin: 0;
		color: var(--fgColor-muted);
		overflow-wrap: anywhere;
	}
</style>
