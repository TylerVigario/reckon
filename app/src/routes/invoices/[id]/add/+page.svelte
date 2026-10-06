<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Top from '#lib/Top.svelte';
	import ReceiptPicker from '#lib/ReceiptPicker.svelte';
	import { pct, percent } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readPassedOn } from '#lib/line-fields.ts';
	import { passedOn } from '#lib/passed-on.ts';
	import { Ratio } from '#lib/decimal.ts';
	import { shrink } from '#lib/receipt.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data, form }: PageProps = $props();

	let kind = $state<'bought' | 'paid_for'>('bought');
	let siteId = $state<string>(untrack(() => data.sites[0]?.id ?? ''));
	let cost = $state('');
	let taxPaid = $state('');
	let paidBy = $state(''); // empty is the business
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});
	$effect(() => {
		if (form?.errors) errors = form.errors;
	});

	const site = $derived(data.sites.find((s) => s.id === siteId));
	const bought = $derived(kind === 'bought');

	/** What the line will bill and the tax on it, by the rule the server saves it by. */
	const bills = $derived.by(() => {
		if (!/^\d+(\.\d+)?$/.test(cost)) return null;
		const line = passedOn(
			{ kind, cost, taxPaid: taxPaid || '0' },
			{
				purchaseMarkupPct: data.markup,
				ruleSet: data.rules,
				siteRatePct: site?.rate_pct ?? null,
				places: data.places
			}
		);
		return {
			...line,
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

<div class="pad">
	<form
		class="rows form"
		method="POST"
		enctype="multipart/form-data"
		use:enhance={async ({ formData, cancel }) => {
			const fields = Object.fromEntries(
				[...formData.entries()].filter((e): e is [string, string] => typeof e[1] === 'string')
			);
			errors = readPassedOn(fields).errors;
			if (bills?.needsASite) errors.site_id = 'Where it went, so its tax rate is known.';
			if (Object.keys(errors).length > 0) return cancel();
			saving = true;
			const file = formData.get('receipt');
			if (file instanceof File && file.size > 0) formData.set('receipt', await shrink(file));
			return async ({ update }) => {
				await update({ reset: false });
				saving = false;
			};
		}}
	>
		<div class="fld">
			<span class="lbl">Kind</span>
			<input type="hidden" name="kind" value={kind} />
			<div class="seg">
				<button type="button" class:on={bought} onclick={() => (kind = 'bought')}>Bought</button>
				<button type="button" class:on={!bought} onclick={() => (kind = 'paid_for')}
					>Paid for them</button
				>
			</div>
			<small class="lt">
				{bought
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

		<div class="fld">
			<label for="l-desc">Description — appears on the invoice</label>
			<input
				id="l-desc"
				name="description"
				class="inp"
				placeholder={bought ? 'Keystone jacks ×12, faceplates ×3' : 'Low-voltage permit'}
			/>
			{#if errors.description}<small class="why">{errors.description}</small>{/if}
		</div>

		<div class="fld">
			<label for="l-from">{bought ? 'Bought from' : 'Paid to'}</label>
			<input
				id="l-from"
				name="bought_from"
				class="inp"
				placeholder={bought ? 'Valley Hardware' : 'City of Woodland'}
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
			<small class="lt">A photo, shrunk on this phone before it is sent, or a PDF.</small>
			{#if errors.receipt}<small class="why">{errors.receipt}</small>{/if}
		</div>

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
