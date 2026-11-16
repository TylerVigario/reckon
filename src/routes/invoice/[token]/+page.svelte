<script lang="ts">
	import { dated, day, percent, quantity } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import Octicon from '#lib/Octicon.svelte';
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

<!-- The client's, whoever opens it: no shell, and nothing of how the work was
     done. Drawn in Primer's boxes, its lines as the business's own copy has them. -->
<main class="primer">
	{#if f}
		<header class="from">
			{#if f.has_logo}<img class="logo" src="/operator/logo" alt="" />{/if}
			<div class="from-m">
				<strong>{f.name}</strong>
				{#if f.address}<span>{f.address}</span>{/if}
				{#if f.phone || f.email}<span>{[f.phone, f.email].filter(Boolean).join(' · ')}</span>{/if}
			</div>
		</header>
	{/if}

	<div class="head">
		<h1>Invoice {inv.number}</h1>
		<p>To {inv.to}</p>
		<p class="muted">Dated {dated(inv.issued_on)} · Due {dated(inv.due_on)}</p>
	</div>

	{#if data.voided}
		<div class="banner warn">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t">This invoice was voided</p>
				<p class="banner-d">Nothing is owed on it.</p>
			</div>
		</div>
	{:else}
		{@const b = data.totals}
		<section class="box" aria-label="What it is for">
			{#each data.lines as l, k (k)}
				<div class="box-row line">
					<span class="what">
						<span class="n">{l.description}</span>
						{#if l.on}<span class="sub">{day(l.on)}</span>{/if}
					</span>
					<span class="fig">
						<span class="v">{money(l.amount)}</span>
						<span class="sub">
							{quantity(l.qty)}{l.unit ? ` ${l.unit}` : ''} × {unitPrice(l.unit_price)}
						</span>
					</span>
				</div>
			{/each}
			{#if Number(b.tax) > 0}
				<div class="box-row line">
					<span class="what"><span class="sub">{taxSaid}</span></span>
					<span class="v muted">{money(b.tax)}</span>
				</div>
			{/if}
			<div class="box-row line">
				<span class="what"><span class="n">Total</span></span>
				<span class="v">{money(b.gross)}</span>
			</div>
			{#if Number(b.paid) > 0}
				<div class="box-row line">
					<span class="what"><span class="sub">Paid</span></span>
					<span class="v muted">−{money(b.paid)}</span>
				</div>
			{/if}
			{#if Number(b.credited) > 0}
				<div class="box-row line">
					<span class="what"><span class="sub">Credited</span></span>
					<span class="v muted">−{money(b.credited)}</span>
				</div>
			{/if}
			<div class="box-row line tot">
				<span class="what"><span class="n">{owes ? 'Balance due' : 'Paid in full'}</span></span>
				<span class="v" class:good={!owes}>{money(b.owed)}</span>
			</div>
		</section>

		{#if owes && f?.address}
			<p class="note">Pay by check to {f.name}, {f.address}, with {inv.number} on it.</p>
		{/if}
	{/if}
</main>

<style>
	main {
		box-sizing: border-box;
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--base-size-24) var(--base-size-16) var(--base-size-40);
		display: flex;
		flex-direction: column;
		gap: var(--base-size-16);
	}
	/* Whom it is from, over a rule, as the printed invoice has it. */
	.from {
		display: flex;
		align-items: center;
		gap: var(--base-size-12);
		padding-bottom: var(--base-size-16);
		border-bottom: var(--borderWidth-thin) solid var(--borderColor-default);
	}
	.logo {
		max-height: 48px;
		max-width: 120px;
	}
	.from-m {
		display: flex;
		flex-direction: column;
		gap: var(--base-size-2);
		min-width: 0;
		font-size: var(--text-body-size-small);
		color: var(--fgColor-muted);
		overflow-wrap: anywhere;
	}
	.from-m strong {
		font-size: var(--text-title-size-small);
		color: var(--fgColor-default);
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--base-size-4);
	}
	.head h1 {
		margin: 0;
		font-size: var(--text-title-size-large);
		font-weight: var(--text-title-weight-large);
		line-height: var(--text-title-lineHeight-large);
	}
	.head p {
		margin: 0;
	}
	.line {
		display: flex;
		align-items: center;
		gap: var(--base-size-12);
		min-height: 56px;
		box-sizing: border-box;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--base-size-2);
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: var(--base-text-weight-semibold);
	}
	.sub {
		font-size: var(--text-body-size-small);
		color: var(--fgColor-muted);
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--base-size-2);
		text-align: right;
	}
	.v {
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: var(--base-text-weight-semibold);
	}
	.tot {
		background: var(--bgColor-muted);
	}
	.good {
		color: var(--fgColor-success);
	}
	.note {
		margin: 0;
		text-align: center;
	}
</style>
