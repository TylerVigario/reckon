<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Octicon from './Octicon.svelte';
	import { money } from './money.svelte.ts';
	import { quantity } from './format.ts';
	import { REASON_WORDS, type AdjustReason } from './adjust-fields.ts';
	import { warm } from './warm.ts';
	import {
		discardAdjust,
		discardCounted,
		discardReceipt,
		flush,
		recount,
		stockHeld,
		type QueuedAdjust,
		type QueuedCount,
		type QueuedCounted,
		type QueuedReceipt
	} from './queue.ts';

	/**
	 * STOCK WORK ON THIS PHONE (#lib/queue): receipts, adjustments and counts
	 * made here, waiting to send, and any the server refused -- kept, with its
	 * reason, until it is fixed or let go; nothing at all when there is none. Letting go is for good, so it takes
	 * a second tap. Sends what is waiting when it opens and whenever the phone
	 * is back online, and fetches the screen again once something arrives.
	 *
	 * On Materials, all of it; on a material's screen (`material`), its own
	 * adjustments alone.
	 */
	let {
		material,
		today,
		onfix
	}: {
		material?: string;
		/** The day a count started to take refused figures is counted on. */
		today: string;
		/** Fix, for an adjustment on this material's screen: opens Adjust with it. */
		onfix?: (q: QueuedAdjust) => void;
	} = $props();

	let receipts = $state<QueuedReceipt[]>([]);
	let adjusts = $state<QueuedAdjust[]>([]);
	let counts = $state<QueuedCount[]>([]);
	let counted = $state<QueuedCounted[]>([]);
	async function read() {
		try {
			const h = await stockHeld();
			receipts = material ? [] : h.receipts;
			adjusts = material ? h.adjusts.filter((q) => q.adjust.material_id === material) : h.adjusts;
			counts = material ? [] : h.counts;
			counted = material ? [] : h.counted;
		} catch {
			/* a phone that will not open its queue shows the server's alone */
		}
	}
	async function send() {
		const sent = await flush().catch(() => null);
		await read();
		if (sent && sent.sent + sent.refused > 0) {
			await invalidateAll();
			warm();
		}
	}
	onMount(() => {
		void read().then(send);
		const back = () => void send();
		addEventListener('online', back);
		return () => removeEventListener('online', back);
	});
	/** Read again: after Adjust keeps one here. */
	export const refresh = read;

	let confirming = $state<string | null>(null);
	async function letGo(key: string, go: () => Promise<void>) {
		if (confirming !== key) {
			confirming = key;
			setTimeout(() => {
				if (confirming === key) confirming = null;
			}, 4000);
			return;
		}
		confirming = null;
		await go().catch(() => {});
		await read();
	}
	const refusedCounted = $derived(counted.filter((q) => q.refused));
	async function countAgain() {
		await recount(
			refusedCounted.map((q) => q.counted.key),
			today
		).catch(() => {});
		await send();
	}
	const any = $derived(receipts.length + adjusts.length + counts.length + counted.length > 0);
	const waitingCounted = $derived(counted.filter((q) => !q.refused).length);
	/** Each piece of work just waiting, in a few words: one row for all of it. */
	const waiting = $derived([
		...receipts
			.filter((q) => !q.refused)
			.map(
				(q) =>
					`Received${q.receipt.shown.supplier ? ` from ${q.receipt.shown.supplier}` : ''}: ${q.receipt.shown.items.map((i) => i.name).join(', ')}`
			),
		...adjusts
			.filter((q) => !q.refused)
			.map(
				(q) =>
					`${q.adjust.shown.way === 'off' ? 'Take' : 'Put'} ${quantity(q.adjust.shown.qty)} ${q.adjust.shown.unit} ${q.adjust.shown.way}${material ? '' : ` ${q.adjust.shown.name}`}`
			),
		...(counts.length || waitingCounted
			? [`${waitingCounted} counted${counts.length ? ', on a count started here' : ''}`]
			: [])
	]);
</script>

{#snippet discard(key: string, go: () => Promise<void>)}
	<button type="button" class="btn sm" onclick={() => letGo(key, go)}>
		{confirming === key ? 'Tap again to discard' : 'Discard'}
	</button>
{/snippet}

{#if any}
	<section class="box" aria-labelledby="phone-h">
		<div class="box-h"><h2 class="box-t" id="phone-h">On this phone</h2></div>
		{#if waiting.length}
			<div class="box-row held">
				<span class="what">
					<span class="n">{waiting.length === 1 ? waiting[0] : `${waiting.length} things`}</span>
					{#if waiting.length > 1}<span class="sub">{waiting.join(' · ')}</span>{/if}
				</span>
				<span class="lab acc">Waiting to send</span>
			</div>
		{/if}
		{#each receipts.filter((q) => q.refused) as q (q.receipt.client_uuid)}
			{@const r = q.receipt.shown}
			<div class="box-row held" class:bad={q.refused}>
				<span class="what">
					<span class="n"
						>Received{r.supplier ? ` from ${r.supplier}` : ''} · {r.items.length}
						{r.items.length === 1 ? 'item' : 'items'}</span
					>
					<span class="sub">{r.items.map((i) => i.name).join(', ')} · {money(r.total)}</span>
					{#if q.refused}
						<span class="why"><Octicon name="alert" />Refused: {q.refused.detail}</span>
					{/if}
				</span>
				{#if q.refused}
					<span class="acts">
						<a
							class="btn sm pri"
							href={resolve(
								`/catalogue/receipts/new?fix=${encodeURIComponent(q.receipt.client_uuid)}`
							)}>Fix</a
						>
						{@render discard(q.receipt.client_uuid, () => discardReceipt(q.receipt.client_uuid))}
					</span>
				{/if}
			</div>
		{/each}
		{#each adjusts.filter((q) => q.refused) as q (q.adjust.client_uuid)}
			{@const a = q.adjust.shown}
			<div class="box-row held" class:bad={q.refused}>
				<span class="what">
					<span class="n"
						>{a.way === 'off' ? 'Take' : 'Put'}
						{quantity(a.qty)}
						{a.unit}
						{a.way === 'off' ? 'off' : 'on'}{material ? '' : ` ${a.name}`}</span
					>
					<span class="sub">{REASON_WORDS[a.reason as AdjustReason] ?? a.reason}</span>
					{#if q.refused}
						<span class="why"><Octicon name="alert" />Refused: {q.refused.detail}</span>
					{/if}
				</span>
				{#if q.refused}
					<span class="acts">
						{#if onfix}
							<button type="button" class="btn sm pri" onclick={() => onfix?.(q)}>Fix</button>
						{:else}
							<a
								class="btn sm pri"
								href={resolve(
									`/catalogue/materials/[id]?fix=${encodeURIComponent(q.adjust.client_uuid)}`,
									{ id: q.adjust.material_id }
								)}>Fix</a
							>
						{/if}
						{@render discard(q.adjust.client_uuid, () => discardAdjust(q.adjust.client_uuid))}
					</span>
				{/if}
			</div>
		{/each}
		{#if refusedCounted.length}
			<div class="box-row held bad">
				<span class="what">
					<span class="n">{refusedCounted.length} counted, not taken</span>
					<span class="sub"
						>{refusedCounted
							.map(
								(q) =>
									`${q.counted.shown.name}: ${quantity(q.counted.fields.counted || '0')} ${q.counted.shown.unit}`
							)
							.join(' · ')}</span
					>
					<span class="why"
						><Octicon name="alert" />Refused: {refusedCounted[0].refused?.detail}</span
					>
				</span>
				<span class="acts">
					<button type="button" class="btn sm pri" onclick={countAgain}>Put on a new count</button>
					{@render discard('counted', async () => {
						for (const q of refusedCounted) await discardCounted(q.counted.key);
					})}
				</span>
			</div>
		{/if}
	</section>
{/if}

<style>
	.held {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		min-height: 56px;
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
	.why {
		display: flex;
		gap: 6px;
		align-items: flex-start;
		font-size: 13px;
		color: var(--crit);
	}
	.acts {
		display: flex;
		gap: 8px;
		flex: 0 0 auto;
	}
	.lab {
		flex: 0 0 auto;
	}
</style>
