<script lang="ts">
	import { onMount } from 'svelte';
	import { dated, percent, quantity, todayIn } from '#lib/format.ts';
	import Octicon from '#lib/Octicon.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import StockOnPhone from '#lib/StockOnPhone.svelte';
	import { readProblem } from '#lib/json.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { enqueueCount, stockHeld, waitingCount } from '#lib/queue.ts';
	import { goto } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { catalogueTabs } from '#lib/section-tabs.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Materials: what is on the shelf, as a Primer box with a row each -- what
	 * it is, what one costs and sells at, how much is left -- each row opening
	 * its own page, and those retired in a box of their own under it. Count
	 * and Receive stock are its actions; a count being counted says so, with
	 * how far it has got, and when stock was last counted is said under the
	 * list, with every count. The markup and costing every price here is
	 * worked out by are the business's, set on Business, and said under the
	 * list with a link there.
	 *
	 * Kept for no signal with quantities alone (#lib/offline-copy): what is
	 * received, adjusted or counted on the phone waits there, said above the
	 * list (#lib/StockOnPhone), and a count started with no signal is counted
	 * on the phone until it arrives.
	 */
	let { data }: PageProps = $props();
	// The cost a markup is on: the shelf's average, or the oldest lot's (#lib/stock-draw).
	const basis = $derived(data.costing === 'average' ? 'average' : 'oldest');
	/** "a ft", but "each" for what is counted each. */
	const per = (unit: string) => (unit === 'each' ? 'each' : `a ${unit}`);
	const offered = $derived(data.materials.filter((m) => m.active));
	let waiting = $state(0);
	/** A count started on this phone and not yet arrived, if there is one. */
	let onPhone = $state<string | null>(null);
	onMount(() => {
		void waitingCount().then(
			(n) => (waiting = n),
			() => {}
		);
		void stockHeld().then(
			(h) => (onPhone = h.counts.find((q) => !q.refused)?.count.client_uuid ?? null),
			() => {}
		);
	});
	// Count opens the count being counted -- the open one, or one started on
	// this phone -- or starts one: on the server, or with no signal on this
	// phone, to join whichever is open when it arrives.
	let starting = $state(false);
	let failed = $state('');
	async function count() {
		if (data.open) return goto(resolve('/catalogue/counts/[id]', { id: data.open.id }));
		if (onPhone)
			return goto(resolve(`/catalogue/counts/on-phone?count=${encodeURIComponent(onPhone)}`));
		starting = true;
		failed = '';
		const uuid = crypto.randomUUID();
		const r = await fetch('/api/counts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ client_uuid: uuid })
		}).catch(() => null);
		if (r?.ok) {
			const { id } = (await r.json()) as { id: string };
			return goto(resolve('/catalogue/counts/[id]', { id }));
		}
		if (r && r.status < 500) {
			starting = false;
			failed = (await readProblem(r)).detail ?? 'It did not start.';
			return;
		}
		try {
			await enqueueCount({
				client_uuid: uuid,
				counted_on: todayIn(personalZone()),
				made_at: new Date().toISOString()
			});
		} catch {
			starting = false;
			failed = 'This phone would not keep a count, so none is started.';
			return;
		}
		await goto(resolve(`/catalogue/counts/on-phone?count=${encodeURIComponent(uuid)}`));
	}
	const retired = $derived(data.materials.filter((m) => !m.active));
</script>

{#snippet row(m: (typeof data.materials)[number])}
	{@const out = m.active && Number(m.on_hand) <= 0}
	<a class="box-row" href={resolve('/catalogue/materials/[id]', { id: m.id })}>
		<span class="what">
			<span class="n">{m.name}</span>
			{#if m.brand || m.sku}<span class="sub">{[m.brand, m.sku].filter(Boolean).join(' · ')}</span
				>{/if}
			{#if m.ex_tax}
				<span class="sub">
					Costs {unitPrice(m.ex_tax)}
					{per(m.unit)}, and {unitPrice(m.tax_paid)} tax
				</span>
			{/if}
		</span>
		{#if out}<span class="lab warn">Out of stock</span>{/if}
		<span class="fig">
			{#if m.price !== null}<span class="v">{unitPrice(m.price)}</span>{/if}
			<span class="sub">{quantity(m.on_hand)} {m.unit} left</span>
		</span>
	</a>
{/snippet}

<Top title="Catalogue" sub="What can go on a line" back={resolve('/more')} backLabel="More">
	{#snippet actions()}
		<button type="button" class="btn sm" onclick={count} disabled={starting}>Count</button>
		<a class="btn sm pri" href={resolve('/catalogue/receipts/new')}>Receive stock</a>
	{/snippet}
</Top>

<div class="pad primer">
	<OfflineBanner asOf={data.as_of} {waiting} />
	<UnderlineNav label="Catalogue" items={catalogueTabs('materials')} />
	<StockOnPhone today={data.today} />

	{#if data.open}
		<div class="banner" role="status">
			<Octicon name="info" />
			<div class="banner-m">
				<p class="banner-t">A count is open</p>
				<p class="banner-d">
					{data.open.counted} counted so far.
					<a href={resolve('/catalogue/counts/[id]', { id: data.open.id })}>Carry on counting</a>
				</p>
			</div>
		</div>
	{/if}
	{#if failed}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{failed}</p></div>
		</div>
	{/if}

	<section class="box" aria-labelledby="stock-h">
		<div class="box-h">
			<h2 class="box-t" id="stock-h">Stock on hand</h2>
			<span class="count">{offered.length}</span>
		</div>
		{#each offered as m (m.id)}
			{@render row(m)}
		{:else}
			<p class="box-row muted">Nothing stocked yet. Receive stock adds the first.</p>
		{/each}
	</section>

	{#if retired.length}
		<section class="box" aria-labelledby="retired-h">
			<div class="box-h">
				<h2 class="box-t" id="retired-h">Retired</h2>
				<span class="count">{retired.length}</span>
			</div>
			{#each retired as m (m.id)}
				{@render row(m)}
			{/each}
		</section>
	{/if}

	<p class="note">
		{data.lastCounted ? `Last counted ${dated(data.lastCounted)}.` : 'Never counted.'}
		<a href={resolve('/catalogue/counts')}>Every count</a>
	</p>

	{#if data.markup}
		<p class="note">
			Each sells at {percent(data.markup)} over the {basis} cost before tax, unless it has a markup or
			a price of its own. The markup and how stock is costed are set on
			<a href={resolve('/settings/business')}>Business</a>.
		</p>
	{/if}
</div>

<style>
	.box-row {
		min-height: 64px;
		box-sizing: border-box;
		margin: 0;
	}
	.what {
		flex: 1 1 auto;
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
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
	}
	.lab {
		flex: 0 0 auto;
	}
</style>
