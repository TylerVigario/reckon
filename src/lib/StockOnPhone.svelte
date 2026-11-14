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
		discardMaterialChange,
		discardReceipt,
		discardService,
		flush,
		keepMine,
		materialChangesHeld,
		QUEUE_CHANGED,
		recount,
		servicesHeld,
		stockHeld,
		type QueuedAdjust,
		type QueuedCount,
		type QueuedCounted,
		type QueuedMaterialChange,
		type QueuedReceipt,
		type QueuedService
	} from './queue.ts';

	/**
	 * CATALOGUE WORK ON THIS PHONE (#lib/queue): receipts, adjustments, counts,
	 * changes to materials and services added here, waiting to send, and any
	 * the server refused -- kept, with its reason, until it is fixed or let go;
	 * nothing at all when there is none. A change to something someone else
	 * changed meanwhile asks which to keep. Letting go is for good, so it takes
	 * a second tap. Sends what is waiting when it opens and whenever the phone
	 * is back online, reads again whenever the queue changes, and fetches the
	 * screen again once something arrives.
	 *
	 * On Materials and Services, all of it; on a material's screen
	 * (`material`), its own adjustments and changes alone.
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
	let changes = $state<QueuedMaterialChange[]>([]);
	let services = $state<QueuedService[]>([]);
	async function read() {
		try {
			const [h, c, sv] = await Promise.all([
				stockHeld(),
				materialChangesHeld(material),
				material ? Promise.resolve([] as QueuedService[]) : servicesHeld()
			]);
			receipts = material ? [] : h.receipts;
			adjusts = material ? h.adjusts.filter((q) => q.adjust.material_id === material) : h.adjusts;
			counts = material ? [] : h.counts;
			counted = material ? [] : h.counted;
			changes = c;
			services = sv;
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
		const again = () => void read();
		addEventListener('online', back);
		addEventListener(QUEUE_CHANGED, again);
		return () => {
			removeEventListener('online', back);
			removeEventListener(QUEUE_CHANGED, again);
		};
	});
	/** Read again: after Adjust keeps one here. */
	export const refresh = read;
	/** Keep this change over theirs, and send it again. */
	async function mine(q: QueuedMaterialChange) {
		await keepMine(q.change.key).catch(() => {});
		await send();
	}
	/** What a change of a material says, in a few words. */
	const changeWords = (q: QueuedMaterialChange) =>
		q.change.kind === 'price'
			? 'What it sells at'
			: Object.keys(q.change.fields)
					.map((f) => FIELD_WORDS[f] ?? f)
					.join(', ');
	const FIELD_WORDS: Record<string, string> = {
		name: 'Name',
		brand: 'Brand',
		sku: 'SKU',
		unit_id: 'Counted in',
		taxable: 'Taxed',
		active: 'Offered'
	};
	/** A value as a person reads it. */
	const said = (v: unknown) =>
		v === null || v === undefined || v === ''
			? 'nothing'
			: typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
				? `“${String(v)}”`
				: 'another price';

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
			: []),
		// On a material's own screen, its Details says what of it waits.
		...changes
			.filter((q) => !q.refused && !material)
			.map((q) => `${changeWords(q)} of ${q.change.shown.name} changed`),
		...services.filter((q) => !q.refused).map((q) => `${q.service.fields.name}, a new service`)
	]);
	/** Whether there is a row to show: what waits, and anything refused. */
	const any = $derived(
		waiting.length > 0 ||
			receipts.some((q) => q.refused) ||
			adjusts.some((q) => q.refused) ||
			counted.some((q) => q.refused) ||
			changes.some((q) => q.refused) ||
			services.some((q) => q.refused)
	);
</script>

{#snippet discard(key: string, go: () => Promise<void>, label = 'Discard')}
	<button type="button" class="btn sm" onclick={() => letGo(key, go)}>
		{confirming === key ? `Tap again to ${label.toLowerCase()}` : label}
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
		{#each changes.filter((q) => q.refused) as q (q.change.key)}
			{@const c = q.refused?.conflict}
			<div class="box-row held bad">
				<span class="what">
					<span class="n">{changeWords(q)} of {q.change.shown.name}</span>
					{#if c}
						<span class="sub"
							>Yours: {q.change.kind === 'price' ? 'another price' : said(q.change.fields[c.field])} ·
							theirs: {said(c.theirs)}</span
						>
					{/if}
					<span class="why"
						><Octicon name="alert" />{c
							? `${c.by ?? 'Someone'} changed it meanwhile.`
							: `Refused: ${q.refused?.detail}`}</span
					>
				</span>
				<span class="acts">
					{#if c}
						<button type="button" class="btn sm pri" onclick={() => mine(q)}>Keep mine</button>
						{@render discard(
							q.change.key,
							() => discardMaterialChange(q.change.key),
							'Keep theirs'
						)}
					{:else}
						<a
							class="btn sm pri"
							href={resolve('/catalogue/materials/[id]/details', { id: q.change.material_id })}
							>Fix</a
						>
						{@render discard(q.change.key, () => discardMaterialChange(q.change.key))}
					{/if}
				</span>
			</div>
		{/each}
		{#each services.filter((q) => q.refused) as q (q.service.client_uuid)}
			<div class="box-row held bad">
				<span class="what">
					<span class="n">{q.service.fields.name}, a new service</span>
					<span class="why"><Octicon name="alert" />Refused: {q.refused?.detail}</span>
				</span>
				<span class="acts">
					<a
						class="btn sm pri"
						href={resolve(
							`/catalogue/services/new?fix=${encodeURIComponent(q.service.client_uuid)}`
						)}>Fix</a
					>
					{@render discard(q.service.client_uuid, () => discardService(q.service.client_uuid))}
				</span>
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
