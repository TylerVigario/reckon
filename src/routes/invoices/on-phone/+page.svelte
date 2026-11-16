<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import {
		discardDraft,
		findDraft,
		flush,
		linesHeld,
		waitingCount,
		type QueuedDraft,
		type QueuedLine
	} from '#lib/queue.ts';
	import { draftTotals } from '#lib/draft-totals.ts';
	import { quantity } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { warm } from '#lib/warm.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	/**
	 * A DRAFT STARTED ON THIS PHONE, read from the queue: the server has not seen
	 * it. Once it has, this screen gives way to the draft's own, numbered.
	 */
	const uuid = $derived(page.url.searchParams.get('draft') ?? '');
	let draft = $state<QueuedDraft | null | undefined>(undefined);
	let lines = $state<QueuedLine[]>([]);
	let waiting = $state(0);

	/** The draft as the server has it, once it has arrived; null until then. */
	async function arrived(): Promise<string | null> {
		try {
			const r = await fetch(`/api/drafts?client_uuid=${encodeURIComponent(uuid)}`);
			return r.ok ? ((await r.json()) as { id: string }).id : null;
		} catch {
			return null;
		}
	}
	async function read() {
		try {
			const [d, all, count] = await Promise.all([findDraft(uuid), linesHeld(uuid), waitingCount()]);
			draft = d ?? null;
			lines = all;
			waiting = count;
		} catch {
			draft = null;
		}
		if (!draft) {
			const id = await arrived();
			if (id) {
				warm();
				await goto(resolve('/invoices/[id]', { id }), { replace: true });
			}
		}
	}
	async function send() {
		await flush().catch(() => null);
		await read();
	}
	onMount(() => {
		void read().then(send);
		const back = () => void send();
		addEventListener('online', back);
		return () => removeEventListener('online', back);
	});

	const t = $derived(
		draftTotals(
			lines.map((q) => ({
				kind: q.line.shown.kind,
				amount: q.line.shown.amount,
				taxable: q.line.shown.taxable,
				rate: q.line.shown.tax_rate_pct
			})),
			data.rounding,
			data.places
		)
	);

	// Letting go of a draft started here is it and its lines gone for good, so
	// it takes a second tap, and the first one says so.
	let confirming = $state(false);
	async function letGo() {
		if (!confirming) {
			confirming = true;
			setTimeout(() => (confirming = false), 4000);
			return;
		}
		await discardDraft(uuid).catch(() => {});
		await goto(resolve('/invoices'));
	}
</script>

<Top
	title="New draft"
	sub={draft?.draft.who ?? ''}
	back={resolve('/invoices')}
	backLabel="Invoices"
>
	{#snippet actions()}
		{#if draft && !draft.refused}
			<a class="btn sm" href={resolve(`/invoices/on-phone/add?draft=${encodeURIComponent(uuid)}`)}
				>Add a line</a
			>
		{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if draft === null}
		<div class="banner" role="status">
			<Octicon name="info" />
			<div class="banner-m">
				<p class="banner-t why">
					That draft is not on this phone. It may have reached the server already.
				</p>
			</div>
		</div>
	{:else if draft}
		{#if draft.refused}
			<div class="banner crit" role="alert">
				<Octicon name="alert" />
				<div class="banner-m">
					<p class="banner-t why refusal">
						Refused: {draft.refused.detail} It is kept on this phone, with its lines, until it is let
						go.
					</p>
				</div>
			</div>
		{:else}
			<p class="note">Started on this phone. It takes its number when it reaches the server.</p>
		{/if}

		<section class="box" aria-labelledby="lines-h">
			<div class="box-h"><h2 class="box-t" id="lines-h">Lines</h2></div>
			{#each lines as q (q.line.client_uuid)}
				{@const l = q.line.shown}
				<div class="box-row line">
					<span class="what">
						<span class="n">{l.description}</span>
						<span class="sub">{l.detail}{l.taxable ? ' · taxable' : ''}</span>
						<span class="labs">
							{#if q.line.receipt}<span class="lab">Receipt</span>{/if}
							<span class="lab acc">On this phone</span>
						</span>
					</span>
					<span class="fig">
						<span class="v">{money(l.amount)}</span>
						<span class="sub">{quantity(l.qty)} {l.unit} × {quantity(l.unit_price)}</span>
					</span>
				</div>
			{:else}
				<p class="box-row muted">No lines yet.</p>
			{/each}
			{#if lines.length}
				{#if Number(t.tax) > 0}
					<div class="box-row line">
						<span class="what"><span class="sub">Sales tax</span></span>
						<span class="v muted">{money(t.tax)}</span>
					</div>
				{/if}
				<div class="box-row line tot">
					<span class="what"><span class="n">Due</span></span>
					<span class="v">{money(t.due)}</span>
				</div>
			{/if}
		</section>

		<div class="acts">
			<button class="btn danger" onclick={letGo}>
				{confirming ? 'Tap again to let it go, with its lines' : 'Let go of this draft'}
			</button>
		</div>
	{/if}
</div>

<style>
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
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
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}
	.v {
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.tot {
		background: var(--bgColor-muted);
	}
	.acts {
		display: flex;
		gap: 8px;
	}
</style>
