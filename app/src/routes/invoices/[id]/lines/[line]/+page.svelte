<script lang="ts">
	import { goto } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import { Ratio } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import { clock, datedAt, pct, quantity, todayIn } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const l = $derived(data.line);
	const draft = $derived(l.status === 'draft');
	const byHand = $derived(['material', 'bought', 'paid_for'].includes(l.kind));
	const KIND: Record<string, string> = {
		material: 'From stock',
		bought: 'Bought',
		paid_for: 'Paid for them'
	};
	const back = $derived(resolve('/invoices/[id]', { id: l.invoice_id }));
	const sub = $derived(
		[KIND[l.kind], `${draft ? 'Draft ' : ''}${l.number}`, l.where].filter(Boolean).join(' · ')
	);
	const tax = $derived(
		l.taxable
			? Ratio.of(l.amount).mul(l.tax_rate_pct).div(100).round(currencyPlaces()).toString()
			: null
	);
	/** "9:50 AM", or "Oct 2, 2026, 9:50 AM" on another day. */
	const when = (at: string | Date) => {
		const zone = personalZone();
		const ms = new Date(at).getTime();
		return todayIn(zone, ms) === todayIn(zone)
			? clock(ms, zone)
			: `${datedAt(ms, zone)}, ${clock(ms, zone)}`;
	};
	const owed = $derived(
		l.ex_tax_cost !== null
			? Ratio.of(l.ex_tax_cost)
					.add(l.tax_paid ?? '0')
					.round(currencyPlaces())
					.toString()
			: null
	);

	// Taking a line off is it gone from the draft, so it takes a second tap, and
	// the first one says so.
	let confirming = $state(false);
	let why = $state('');
	async function takeOff() {
		if (!confirming) {
			confirming = true;
			setTimeout(() => (confirming = false), 4000);
			return;
		}
		why = '';
		const r = await fetch(`/api/lines/${l.id}`, { method: 'DELETE' }).catch(() => null);
		if (r?.ok) {
			await goto(back, { invalidateAll: true });
			return;
		}
		why = r
			? (((await r.json().catch(() => ({}))) as { detail?: string }).detail ??
				'It could not be taken off.')
			: 'Taking a line off needs a connection.';
		confirming = false;
	}
</script>

<Top title={l.description} {sub} {back} backLabel={l.number}>
	{#snippet actions()}
		{#if draft && byHand}
			<a
				class="btn sm"
				href={resolve('/invoices/[id]/lines/[line]/change', { id: l.invoice_id, line: l.id })}
				>Change</a
			>
		{/if}
	{/snippet}
</Top>

<div class="pad">
	{#if why}<p class="why">{why}</p>{/if}
	{#if l.receipt_type}
		{@const href = resolve('/invoices/[id]/lines/[line]/receipt', { id: l.invoice_id, line: l.id })}
		<div class="receipt">
			{#if l.receipt_type.startsWith('image/')}
				<a {href}
					><img src={href} alt={`The receipt${l.bought_from ? ` from ${l.bought_from}` : ''}`} /></a
				>
			{:else}
				<a class="btn blk" {href}>The receipt, a PDF</a>
			{/if}
		</div>
	{/if}

	{#if byHand}
		<div class="sec">
			<div class="sec-h"><h2>{KIND[l.kind]}</h2></div>
			<div class="rows inset">
				<div class="stack">
					{#if l.kind === 'material'}
						<div class="kv"><span class="k">Item</span><span class="v">{l.item}</span></div>
						<div class="kv">
							<span class="k">How much</span><span class="v">{quantity(l.qty)} {l.unit}</span>
						</div>
					{:else}
						<div class="kv">
							<span class="k">{l.kind === 'bought' ? 'From' : 'To'}</span>
							<span class="v">{l.bought_from ?? '—'}</span>
						</div>
					{/if}
					<div class="kv">
						<span class="k">{l.kind === 'paid_for' ? 'Paid' : 'Cost before tax'}</span>
						<span class="v">{money(l.ex_tax_cost)}</span>
					</div>
					{#if l.kind !== 'paid_for'}
						<div class="kv">
							<span class="k">Tax paid</span><span class="v">{money(l.tax_paid)}</span>
						</div>
					{/if}
					{#if l.kind !== 'material'}
						<div class="kv">
							<span class="k">Paid by</span>
							<span class="v"
								>{l.paid_by ? `${l.paid_by} — owed back ${money(owed)}` : 'The business'}</span
							>
						</div>
					{/if}
					{#if l.moved_from}
						<div class="kv">
							<span class="k">Meant for</span><span class="v">{l.moved_from}</span>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<div class="sec">
		<div class="sec-h"><h2>Billed</h2></div>
		<div class="rows inset">
			<div class="stack">
				<div class="kv">
					<span class="k">Charged</span>
					<span class="v"
						>{money(l.amount)} · {quantity(l.qty)}{l.unit ? ` ${l.unit}` : ''} × {unitPrice(
							l.unit_price
						)}</span
					>
				</div>
				<div class="kv">
					<span class="k">{l.taxable ? `Tax at ${pct(l.tax_rate_pct)}` : 'Tax'}</span>
					<span class="v">{tax !== null ? money(tax) : 'None'}</span>
				</div>
				{#if l.taxable && data.claims && l.ex_tax_cost !== null}
					<div class="kv">
						<span class="k">Off the return</span>
						<span class="v">{money(l.ex_tax_cost)}, Reg 1701</span>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="rows">
		<a
			class="rec link"
			href={resolve('/invoices/[id]/lines/[line]/history', { id: l.invoice_id, line: l.id })}
		>
			<div class="rec-m">
				<div class="rec-t">History</div>
				<div class="rec-s">
					{data.added
						? `Added by ${data.added.who ?? 'someone'}, ${when(data.added.at)}`
						: 'Added before lines kept their history'}{data.changes
						? ` · changed ${data.changes === 1 ? 'once' : `${data.changes} times`} since`
						: ''}
				</div>
			</div>
			<span class="arw" aria-hidden="true">›</span>
		</a>
	</div>

	{#if draft && byHand}
		<button class="btn gho blk off" onclick={takeOff}>
			{confirming ? 'Tap again to take it off' : 'Take it off the draft'}
		</button>
	{/if}
</div>

<style>
	.receipt {
		margin-bottom: 16px;
	}
	.receipt img {
		display: block;
		width: 100%;
		max-height: 420px;
		object-fit: contain;
		border-radius: var(--r);
		border: 1px solid var(--line);
		background: var(--card);
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
	}
	.off {
		margin-top: 16px;
	}
	.why {
		color: var(--crit);
	}
</style>
