<script lang="ts">
	import { dated, day, percent, quantity } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	const f = $derived(data.from);
	const inv = $derived(data.invoice);
	// "Sales tax, 7.75%" where every taxed line was taxed at one rate.
	const taxSaid = $derived(
		!data.voided && data.totals.rates === 1 && data.totals.rate_pct
			? `Sales tax, ${percent(data.totals.rate_pct)}`
			: 'Sales tax'
	);
	const owes = $derived(!data.voided && Number(data.totals.owed) > 0);
</script>

<svelte:head>
	<title>Invoice {inv.number}{f ? ` from ${f.name}` : ''}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	{#if f}
		<header>
			{#if f.has_logo}<img class="logo" src="/operator/logo" alt="" />{/if}
			<div class="from">
				<strong>{f.name}</strong>
				{#if f.address}<span>{f.address}</span>{/if}
				{#if f.phone || f.email}<span>{[f.phone, f.email].filter(Boolean).join(' · ')}</span>{/if}
			</div>
		</header>
	{/if}

	<section class="head">
		<h1>Invoice {inv.number}</h1>
		<p>To {inv.to}</p>
		<p class="dates">Dated {dated(inv.issued_on)} · Due {dated(inv.due_on)}</p>
	</section>

	{#if data.voided}
		<div class="rows">
			<div class="rec warn">
				<div class="rec-m">
					<div class="rec-t">This invoice was voided</div>
					<div class="rec-s">Nothing is owed on it.</div>
				</div>
			</div>
		</div>
	{:else}
		{@const b = data.totals}
		<div class="rows">
			{#each data.lines as l, k (k)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{l.description}</div>
						{#if l.on}<div class="rec-s">{day(l.on)}</div>{/if}
					</div>
					<div class="rec-n">
						<span class="rec-v">{money(l.amount)}</span>
						<span class="rec-x">
							{quantity(l.qty)}{l.unit ? ` ${l.unit}` : ''} × {unitPrice(l.unit_price)}
						</span>
					</div>
				</div>
			{/each}
			{#if Number(b.tax) > 0}
				<div class="rec">
					<div class="rec-m"><div class="rec-t lt">{taxSaid}</div></div>
					<div class="rec-n"><span class="rec-v mut">{money(b.tax)}</span></div>
				</div>
			{/if}
			<div class="rec">
				<div class="rec-m"><div class="rec-t">Total</div></div>
				<div class="rec-n"><span class="rec-v">{money(b.gross)}</span></div>
			</div>
			{#if Number(b.paid) > 0}
				<div class="rec">
					<div class="rec-m"><div class="rec-t lt">Paid</div></div>
					<div class="rec-n"><span class="rec-v mut">−{money(b.paid)}</span></div>
				</div>
			{/if}
			{#if Number(b.credited) > 0}
				<div class="rec">
					<div class="rec-m"><div class="rec-t lt">Credited</div></div>
					<div class="rec-n"><span class="rec-v mut">−{money(b.credited)}</span></div>
				</div>
			{/if}
			<div class="rec tot">
				<div class="rec-m"><div class="rec-t">{owes ? 'Balance due' : 'Paid in full'}</div></div>
				<div class="rec-n"><span class="rec-v" class:good={!owes}>{money(b.owed)}</span></div>
			</div>
		</div>

		{#if owes && f?.address}
			<p class="other">
				Pay by check to {f.name}, {f.address}, with {inv.number} on it.
			</p>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 560px;
		margin: 0 auto;
		padding: 24px 16px 40px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 14px;
		padding-bottom: 14px;
		border-bottom: 2px solid var(--accent);
	}
	.logo {
		max-height: 48px;
		max-width: 120px;
	}
	.from {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13px;
		color: var(--ink-3);
	}
	.from strong {
		font-size: 18px;
		color: var(--ink);
	}
	.head h1 {
		margin: 0;
		font-size: 24px;
	}
	.head p {
		margin: 4px 0 0;
	}
	.head .dates {
		font-size: 13px;
		color: var(--ink-3);
	}
	.lt {
		color: var(--ink-3);
	}
	.other {
		margin: 0;
		font-size: 13px;
		color: var(--ink-3);
		text-align: center;
	}
</style>
