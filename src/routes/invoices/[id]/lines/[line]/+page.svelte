<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import {
		discardChange,
		enqueueChange,
		findChange,
		flush,
		waitingCount,
		type ChangeEntry,
		type QueuedChange
	} from '#lib/queue.ts';
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

	// WHAT THIS PHONE HAS FOR THE LINE: a change waiting to send, or one that ran
	// into something -- a field someone else changed too, or the line changed
	// after it was taken off here (#lib/line-conflict). The server cannot know
	// it yet, so it is read from the queue.
	let mine = $state<QueuedChange | null>(null);
	let waiting = $state(0);
	async function read() {
		try {
			mine = (await findChange(l.id)) ?? null;
			waiting = await waitingCount();
		} catch {
			mine = null;
		}
	}
	onMount(() => void read());
	const conflict = $derived(mine?.refused?.conflict ?? null);
	const collided = $derived(conflict?.what === 'collided' ? conflict : null);

	/** Made on a phone well before it arrived: a minute is the trip, and a clock a little off. */
	const madeHere = (made: string | null, at: string) =>
		made !== null && Date.parse(at) - Date.parse(made) > 60_000;
	/** A field's value, as the line's screen writes it. */
	function said(field: string, v: string): string {
		if (field === 'paid_by') return v ? (data.people[v] ?? 'Someone') : 'the business';
		if (v === '') return 'nothing';
		if (field === 'ex_tax_cost' || field === 'tax_paid') return money(v);
		if (field === 'qty') return `${quantity(v)}${l.unit ? ` ${l.unit}` : ''}`;
		if (field === 'site_id') return data.sites[v] ?? 'a site since removed';
		return `“${v}”`;
	}
	const LABEL: Record<string, string> = {
		description: 'Description',
		qty: 'How much',
		site_id: 'Where',
		bought_from: 'From',
		ex_tax_cost: 'Cost before tax',
		tax_paid: 'Tax paid',
		paid_by: 'Who paid'
	};

	// A collision is settled field by field: each picks one of the values it has
	// held, the phone's own among them, and starts on the phone's.
	let picks = $state<Record<string, string>>({});
	$effect(() => {
		if (!collided || !mine) return;
		const start: Record<string, string> = {};
		for (const [f, c] of Object.entries(collided.fields)) start[f] = c?.mine ?? '';
		picks = start;
	});
	/** Every value a field has held, oldest first, and the phone's last. */
	const choices = (f: string) => {
		const c = collided?.fields[f as keyof typeof collided.fields];
		if (!c) return [];
		const held = c.chain.map((h) => ({ ...h, mine: false }));
		if (!c.chain.some((h) => h.value === c.mine))
			held.push({
				value: c.mine,
				who: null,
				at: mine?.change.made_at ?? '',
				made_at: null,
				mine: true
			});
		return held;
	};
	let deciding = $state(false);
	/**
	 * Saves a decision on this phone. What is kept in state is a proxy, which
	 * the phone's database cannot store, so a plain copy is.
	 */
	async function decide(change: ChangeEntry) {
		try {
			await enqueueChange($state.snapshot(change), true);
			return true;
		} catch {
			why = 'This phone would not save that, so nothing is decided yet.';
			return false;
		}
	}
	async function keepPicks() {
		if (!collided || !mine) return;
		deciding = true;
		// The line as the server has it, with what merged from this phone, and the
		// picks: made against the save the server is at.
		const fields = { ...collided.server };
		for (const [f, side] of Object.entries(collided.from))
			if (side === 'phone') fields[f] = mine.change.fields[f] ?? '';
		Object.assign(fields, picks);
		if (
			await decide({
				...mine.change,
				version: collided.version,
				base: collided.server,
				fields
			})
		)
			await send();
		deciding = false;
	}
	/** Taken off here and changed since: off anyway, or kept. */
	async function offAnyway() {
		if (!mine) return;
		if (!(await decide({ ...mine.change, force: true }))) return;
		await send();
		await goto(back, { invalidateAll: true });
	}
	async function letGo() {
		await discardChange(l.id).catch(() => {});
		await read();
	}
	async function send() {
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		await invalidateAll();
		await read();
	}

	// Taking a line off is it gone from the draft, so it takes a second tap, and
	// the first one says so. It is saved on this phone first, as a change is.
	let confirming = $state(false);
	let why = $state('');
	async function takeOff() {
		if (!confirming) {
			confirming = true;
			setTimeout(() => (confirming = false), 4000);
			return;
		}
		why = '';
		try {
			await enqueueChange({
				line_id: l.id,
				invoice_id: l.invoice_id,
				act: 'remove',
				version: l.version,
				base: data.fields,
				fields: {},
				made_at: new Date().toISOString(),
				shown: {
					kind: l.kind as 'material' | 'bought' | 'paid_for',
					description: l.description,
					detail: '',
					qty: l.qty,
					unit: l.unit ?? '',
					unit_price: l.unit_price,
					amount: l.amount,
					taxable: l.taxable,
					tax_rate_pct: l.tax_rate_pct
				}
			});
		} catch {
			why = 'This phone would not save that, so the line is still on.';
			confirming = false;
			return;
		}
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		await goto(back, { invalidateAll: true });
	}
</script>

<Top title={l.description} {sub} {back} backLabel={l.number}>
	{#snippet actions()}
		{#if draft && byHand && !conflict}
			<a
				class="btn sm"
				href={resolve('/invoices/[id]/lines/[line]/change', { id: l.invoice_id, line: l.id })}
				>Change</a
			>
		{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if why}<p class="why">{why}</p>{/if}

	{#if collided && mine}
		<p class="why">
			{collided.by ?? 'Someone'} changed this line{collided.at ? ` at ${when(collided.at)}` : ''} while
			this phone was offline. {Object.keys(collided.from).length
				? `${Object.keys(collided.from).length === 1 ? 'One field' : `${Object.keys(collided.from).length} fields`} merged on ${Object.keys(collided.from).length === 1 ? 'its' : 'their'} own; `
				: ''}{Object.keys(collided.fields).length === 1
				? 'one needs a choice'
				: `${Object.keys(collided.fields).length} need a choice`}. Until it is made, your change
			waits on this phone.
		</p>
		{#each Object.entries(collided.from) as [f, side] (f)}
			<div class="sec">
				<div class="sec-h">
					<h2>{LABEL[f] ?? f}</h2>
					<span class="sp"></span>
					<span class="chip good"><span class="dot"></span>Merged</span>
				</div>
				<div class="rows">
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">
								{said(
									f,
									side === 'phone' ? (mine.change.fields[f] ?? '') : (collided.server[f] ?? '')
								)}
							</div>
							<div class="rec-s">
								{side === 'phone'
									? 'Only you changed it, on this phone'
									: `Only ${collided.by ?? 'they'} changed it`}
							</div>
						</div>
					</div>
				</div>
			</div>
		{/each}
		{#each Object.keys(collided.fields) as f (f)}
			<div class="sec">
				<div class="sec-h">
					<h2>{LABEL[f] ?? f} — pick one</h2>
					<span class="sp"></span>
					<span class="chip warn"><span class="dot"></span>Both changed</span>
				</div>
				<div class="rows" role="radiogroup" aria-label={LABEL[f] ?? f}>
					{#each choices(f) as c (c.value)}
						<button
							type="button"
							class="rec pick"
							class:on={picks[f] === c.value}
							role="radio"
							aria-checked={picks[f] === c.value}
							onclick={() => (picks = { ...picks, [f]: c.value })}
						>
							<span class="radio" aria-hidden="true"></span>
							<span class="rec-m">
								<span class="rec-t">{said(f, c.value)}</span>
								<span class="rec-s"
									>{c.mine
										? 'You · on this phone'
										: `${c.who ?? 'Someone'} · ${madeHere(c.made_at, c.at) ? `made ${when(c.made_at!)} on a phone · arrived ${when(c.at)}` : when(c.at)}`}{c.value ===
									collided.fields[f as keyof typeof collided.fields]?.base
										? ' · where both started'
										: ''}</span
								>
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}
		<div class="rows">
			<a
				class="rec link"
				href={resolve('/invoices/[id]/lines/[line]/history', { id: l.invoice_id, line: l.id })}
			>
				<div class="rec-m">
					<div class="rec-t">The whole history</div>
					<div class="rec-s">Every value this line has held, and who set it</div>
				</div>
				<span class="arw" aria-hidden="true">›</span>
			</a>
		</div>
		<div class="btnrow">
			<button class="btn pri blk" disabled={deciding} onclick={keepPicks}>Keep these</button>
			<a class="btn blk" href={back}>Later</a>
		</div>
	{:else if conflict?.what === 'changed' && mine}
		<p class="why">
			{conflict.by ?? 'Someone'} changed this line{conflict.at ? ` at ${when(conflict.at)}` : ''},
			after it was taken off on this phone.
		</p>
		<div class="btnrow">
			<button class="btn pri blk" onclick={offAnyway}>Take it off anyway</button>
			<button class="btn blk" onclick={letGo}>Keep it</button>
		</div>
	{:else if mine?.refused}
		<p class="why">
			Refused: {mine.refused.detail} Your change is kept on this phone until it is fixed or let go.
		</p>
		<button class="btn blk" onclick={letGo}>Let the change go</button>
	{:else if mine}
		<p class="lt waits">
			{mine.change.act === 'remove'
				? 'Taken off on this phone: it goes from the draft when it reaches the server.'
				: 'A change made on this phone waits to send.'}
		</p>
	{/if}
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

	{#if draft && byHand && !conflict && mine?.change.act !== 'remove'}
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
	.waits {
		margin: 0 0 14px;
	}
	.btnrow {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 16px 0;
	}
	.btnrow > * {
		box-sizing: border-box;
		width: 100%;
		text-align: center;
	}
	button.rec.pick {
		width: 100%;
		text-align: left;
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		cursor: pointer;
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.pick .rec-m,
	.pick .rec-t,
	.pick .rec-s {
		display: block;
	}
	.pick .radio {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid var(--line);
		flex: none;
	}
	.pick.on .radio {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 4px var(--card);
		background: var(--accent);
	}
	.pick.on {
		background: var(--accent-wash);
	}
</style>
