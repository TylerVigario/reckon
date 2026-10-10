<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
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
				await goto(resolve('/invoices/[id]', { id }), { replaceState: true });
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
			<a
				class="btn sm"
				href={`${resolve('/invoices/on-phone/add')}?draft=${encodeURIComponent(uuid)}`}
				>Add a line</a
			>
		{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if draft === null}
		<p class="why">That draft is not on this phone. It may have reached the server already.</p>
	{:else if draft}
		{#if draft.refused}
			<p class="why refusal">
				Refused: {draft.refused.detail} It is kept on this phone, with its lines, until it is let go.
			</p>
		{:else}
			<p class="lt">Started on this phone. It takes its number when it reaches the server.</p>
		{/if}

		<div class="sec">
			<div class="sec-h"><h2>Lines</h2></div>
			<div class="rows">
				{#each lines as q (q.line.client_uuid)}
					{@const l = q.line.shown}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{l.description}</div>
							<div class="rec-s">{l.detail}{l.taxable ? ' · taxable' : ''}</div>
							<div class="rec-c">
								{#if q.line.receipt}<span class="chip">Receipt</span>{/if}
								<span class="chip acc"><span class="dot"></span>On this phone</span>
							</div>
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(l.amount)}</span>
							<span class="rec-x">{quantity(l.qty)} {l.unit} × {quantity(l.unit_price)}</span>
						</div>
					</div>
				{:else}
					<div class="rec">
						<div class="rec-m"><div class="rec-t"><span class="lt">No lines yet</span></div></div>
					</div>
				{/each}
				{#if lines.length}
					{#if Number(t.tax) > 0}
						<div class="rec">
							<div class="rec-m"><div class="rec-t lt">Sales tax</div></div>
							<div class="rec-n"><span class="rec-v mut">{money(t.tax)}</span></div>
						</div>
					{/if}
					<div class="rec tot">
						<div class="rec-m"><div class="rec-t">Due</div></div>
						<div class="rec-n"><span class="rec-v">{money(t.due)}</span></div>
					</div>
				{/if}
			</div>
		</div>

		<button class="btn gho blk" onclick={letGo}>
			{confirming ? 'Tap again to let it go, with its lines' : 'Let go of this draft'}
		</button>
	{/if}
</div>

<style>
	.refusal {
		color: var(--crit);
	}
	.lt {
		margin: 0 0 14px;
	}
	.blk {
		margin-top: 16px;
	}
</style>
