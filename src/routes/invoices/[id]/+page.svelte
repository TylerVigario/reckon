<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Decimal } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import {
		changesHeld,
		discardChange,
		discardLine,
		enqueueChange,
		flush,
		linesHeld,
		waitingCount,
		type QueuedChange,
		type QueuedLine
	} from '#lib/queue.ts';
	import { draftTotals } from '#lib/draft-totals.ts';
	import { warm } from '#lib/warm.ts';
	import { clock, datedAt, day, monthOf, pct, quantity, rateParts } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { data }: PageProps = $props();

	const i = $derived(data.invoice);
	/** The kinds of line added by hand, which open on a screen of their own. */
	const BY_HAND: string[] = ['material', 'bought', 'paid_for'];

	// LINES ON THIS PHONE: added here and waiting to send, or sent and refused.
	// Read from the queue on mount -- the server cannot know them yet -- and
	// again whenever the queue sends, when what it took comes back as the
	// server's own lines.
	let onPhone = $state<QueuedLine[]>([]);
	// Changes made on this phone to lines the server has, by line.
	let changes = $state<QueuedChange[]>([]);
	const changeOf = $derived(new Map(changes.map((q) => [q.change.line_id, q])));
	// A change to a line someone took off while this phone was offline: put it
	// back with the change, or let the change go.
	const putBack = $derived(changes.filter((q) => q.refused?.conflict?.what === 'removed'));
	let stored = $state('');
	async function restore(q: QueuedChange) {
		// A plain copy: what is kept in state is a proxy, which the phone's
		// database cannot store.
		try {
			await enqueueChange({ ...$state.snapshot(q.change), act: 'restore' }, true);
		} catch {
			stored = 'This phone would not save that, so the line is not put back yet.';
			return;
		}
		await send();
		await invalidateAll();
	}
	async function letChangeGo(q: QueuedChange) {
		await discardChange(q.change.line_id).catch(() => {});
		await read();
	}
	let waiting = $state(0);
	async function read() {
		try {
			const [all, count, mine] = await Promise.all([
				linesHeld(),
				waitingCount(),
				changesHeld(i.id)
			]);
			// Its own, by its id or by the uuid it was started with on a phone.
			onPhone = all.filter((q) => [i.id, i.client_uuid].includes(q.line.invoice_id));
			changes = mine;
			waiting = count;
		} catch {
			/* a phone that will not open its queue shows the server's lines alone */
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
	const pending = $derived(onPhone.filter((q) => !q.refused));
	const kept = $derived(onPhone.filter((q) => q.refused));

	// Letting go of a refused line is it gone for good, so it takes a second
	// tap, and the first one says so.
	let confirming = $state<string | null>(null);
	async function letGo(id: string) {
		if (confirming !== id) {
			confirming = id;
			setTimeout(() => {
				if (confirming === id) confirming = null;
			}, 4000);
			return;
		}
		confirming = null;
		await discardLine(id).catch(() => {});
		await read();
	}

	// THE TOTALS, with what is on this phone in them (#lib/draft-totals).
	// Nothing waiting, and they are the server's own figures.
	// A change waiting on this phone counts as made; a line taken off here, as
	// gone.
	const waitingChanges = $derived(changes.filter((q) => !q.refused));
	const t = $derived(
		pending.length === 0 && waitingChanges.length === 0
			? data.totals
			: {
					...data.totals,
					...draftTotals(
						[
							...data.lines.flatMap((l) => {
								const c = changeOf.get(l.id);
								if (c && !c.refused && c.change.act === 'remove') return [];
								const shown = c && !c.refused && c.change.act === 'change' ? c.change.shown : null;
								return [
									{
										kind: l.kind,
										amount: shown?.amount ?? l.amount,
										taxable: shown?.taxable ?? l.taxable,
										rate: shown?.tax_rate_pct ?? l.tax_rate_pct
									}
								];
							}),
							...pending.map((q) => ({
								kind: q.line.shown.kind,
								amount: q.line.shown.amount,
								taxable: q.line.shown.taxable,
								rate: q.line.shown.tax_rate_pct
							}))
						],
						data.rounding,
						data.places
					)
				}
	);

	// Reg 1701: the measure is what was sold taxable, less what was already
	// taxed when it was bought. What is left is the markup. The server's
	// figures, which take in a line once it arrives.
	const r = $derived(data.totals);
	const netTaxable = $derived(
		Decimal.from(r.taxable_measure).sub(r.resold).toFixed(currencyPlaces())
	);
	const dueOnReturn = $derived(r.due_on_return);

	// The rate and the two obligations inside it: a return allocates the
	// state's share and the district tax separately, so the invoice that
	// charged them says which is which.
	const made = (x: {
		rate_pct: string | null;
		state_rate_pct: string | null;
		district_rate_pct: string | null;
	}) => `${pct(x.rate_pct)} (${rateParts(x.state_rate_pct, x.district_rate_pct)})`;

	// The schema's own words for what a line is. A label that says "goods" over
	// a taxed labour line is the page asserting something the data did not.
	const KIND: Record<string, string> = {
		service: 'services',
		material: 'goods',
		recurring: 'the retainer',
		adjustment: 'adjustments',
		bought: 'goods',
		paid_for: 'expenses'
	};
	const listed = (kinds: string[]) => {
		const words = [...new Set(kinds.map((k) => KIND[k] ?? k))];
		if (words.length === 0) return '';
		if (words.length === 1) return words[0];
		return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
	};

	// THE CLIENT'S LINK, once it is sent: copied, or handed to the phone's share
	// sheet. What sending did with it arrives as ?link=, and is said once.
	let handed = $state(page.url.searchParams.get('link'));
	let canShare = $state(false);
	onMount(() => (canShare = typeof navigator.share === 'function'));
	async function copyLink() {
		if (!i.link) return;
		await navigator.clipboard
			.writeText(i.link)
			.then(() => (handed = 'copied'))
			.catch(() => {});
	}
	async function shareLink() {
		if (!i.link) return;
		await navigator
			.share({ title: `Invoice ${i.number}`, url: i.link })
			.then(() => (handed = 'shared'))
			.catch(() => {});
	}

	const period = $derived(i.period_start ? monthOf(i.period_start) : null);
	const sub = $derived([i.who, period].filter(Boolean).join(' · '));
	const title = $derived(i.status === 'draft' ? `Draft ${i.number}` : i.number);
</script>

<Top {title} {sub} back={resolve('/invoices')} backLabel="Invoices">
	{#snippet actions()}
		{#if i.status === 'draft'}
			<a class="btn sm" href={resolve('/invoices/[id]/add', { id: i.id })}>Add a line</a>
			<a class="btn pri sm" href={resolve('/invoices/[id]/send', { id: i.id })}>Send</a>
		{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#each data.movedIn as m (m.number)}
		<p class="why">
			{m.number} went out{m.sent_at
				? ` at ${clock(m.sent_at, personalZone())} on ${datedAt(m.sent_at, personalZone())}`
				: ''}
			while {m.lines === 1 ? 'a line' : `${m.lines} lines`} added to it on a phone {m.lines === 1
				? 'was'
				: 'were'} on the way. {m.lines === 1 ? 'It' : 'They'} could not join it, so this draft was started
			for {i.who}, and took the next number when it reached the server.
		</p>
	{/each}
	{#each data.movedOut as m (m.id)}
		<p class="why">
			{m.lines === 1 ? 'A line' : `${m.lines} lines`} added to this on a phone after it went out
			{m.lines === 1 ? 'is' : 'are'} on
			<a href={resolve('/invoices/[id]', { id: m.id })}>{m.number}</a>.
		</p>
	{/each}
	{#if stored}<p class="why">{stored}</p>{/if}
	{#if putBack.length}
		<div class="sec">
			<div class="sec-h"><h2>Taken off while this phone was offline</h2></div>
			<div class="rows">
				{#each putBack as q (q.change.line_id)}
					{@const gone = q.refused?.conflict}
					<div class="rec crit">
						<div class="rec-m">
							<div class="rec-t">{q.change.shown.description}</div>
							<div class="rec-s refusal">
								{gone?.what === 'removed' ? (gone.by ?? 'Someone') : 'Someone'} took it off{gone?.what ===
								'removed'
									? ` at ${clock(gone.at, personalZone())}`
									: ''}. Your change to it waits on this phone.
							</div>
							<div class="acts">
								<button class="btn sm pri" onclick={() => restore(q)}
									>Put it back, with your change</button
								>
								<button class="btn sm gho" onclick={() => letChangeGo(q)}>Let your change go</button
								>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
	{#if kept.length}
		<div class="sec">
			<div class="sec-h"><h2>Not added</h2></div>
			<div class="rows">
				{#each kept as q (q.line.client_uuid)}
					{@const l = q.line.shown}
					<div class="rec crit">
						<div class="rec-m">
							<div class="rec-t">{l.description}</div>
							<div class="rec-s">{l.detail} · {money(l.amount)}</div>
							<div class="rec-s refusal">
								Refused: {q.refused?.detail} It is kept on this phone until it is fixed or let go.
							</div>
							<div class="acts">
								<a
									class="btn sm pri"
									href={`${resolve('/invoices/[id]/add', { id: i.id })}?fix=${encodeURIComponent(q.line.client_uuid)}`}
									>Fix</a
								>
								<button class="btn sm gho" onclick={() => letGo(q.line.client_uuid)}>
									{confirming === q.line.client_uuid ? 'Tap again to discard' : 'Discard'}
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="tiles">
		{#if i.status === 'draft'}
			<div class="tile">
				<span class="k">Due</span>
				<span class="v">{money(t.due)}</span>
				<span class="s"
					>{i.terms ? `Net ${i.terms}` : i.due_on ? day(i.due_on) : 'no terms set'}</span
				>
			</div>
		{:else}
			<!-- Paid is what is owed coming to nothing, not a status (0028). -->
			<div class="tile">
				<span class="k">Owed</span>
				<span class="v" class:good={Number(data.totals.owed) === 0}>{money(data.totals.owed)}</span>
				<span class="s">
					{Number(data.totals.owed) === 0 ? 'Paid' : `of ${money(data.totals.due)}`}
				</span>
			</div>
		{/if}
		<div class="tile">
			<span class="k">Status</span>
			<span class="v sm {i.status === 'draft' ? 'warn' : i.status === 'void' ? 'crit' : 'good'}">
				{i.status === 'draft' ? 'Draft' : i.status === 'void' ? 'Voided' : 'Sent'}
			</span>
			<span class="s">
				{i.status === 'draft'
					? `Assembled ${clock(i.assembled, personalZone())}`
					: `${day(i.issued_on)} · due ${day(i.due_on)}`}
			</span>
		</div>
	</div>

	{#if i.link}
		<div class="sec">
			<div class="sec-h"><h2>The client's link</h2></div>
			<div class="rows">
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t link-text">{i.link.replace(/^https?:\/\//, '')}</div>
						<div class="rec-s">
							{handed === 'copied'
								? 'Sent, and the link is copied.'
								: handed === 'shared'
									? 'Sent, and the link is shared.'
									: handed === 'sent'
										? 'Sent. Share the link from here.'
										: 'Opens without signing in. Anyone with it can see this invoice.'}
						</div>
						<div class="acts">
							<button type="button" class="btn sm" onclick={copyLink}>Copy</button>
							{#if canShare}
								<button type="button" class="btn sm" onclick={shareLink}>Share</button>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="sec">
		<div class="sec-h"><h2>Lines</h2></div>
		<div class="rows">
			{#each data.lines as l (l.id)}
				{#if l.trip_leg_id}
					<a class="rec link" href={resolve('/trips')}>
						<div class="rec-m">
							<div class="rec-t">{l.description}</div>
							{#if l.detail}<div class="rec-s">{l.detail}</div>{/if}
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(l.amount)}</span>
							<span class="rec-x">{quantity(l.qty)} × {quantity(l.unit_price)}</span>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{:else if BY_HAND.includes(l.kind)}
					{@const c = changeOf.get(l.id)}
					<!-- Added by hand: its own screen has its receipt, what it billed,
					     its history, and -- on a draft -- changing it or taking it off. -->
					<a
						class="rec link"
						href={resolve('/invoices/[id]/lines/[line]', { id: i.id, line: l.id })}
					>
						<div class="rec-m">
							<div class="rec-t">{l.description}</div>
							{#if l.detail}<div class="rec-s">{l.detail}{l.taxable ? ' · taxable' : ''}</div>{/if}
							{#if l.receipt || l.moved_from || c}
								<div class="rec-c">
									{#if l.receipt}<span class="chip">Receipt</span>{/if}
									{#if l.moved_from}<span class="chip">Moved from {l.moved_from}</span>{/if}
									{#if c?.refused?.conflict?.what === 'collided'}
										<span class="chip warn"><span class="dot"></span>Changed in two places</span>
									{:else if c?.refused?.conflict?.what === 'changed'}
										<span class="chip warn"
											><span class="dot"></span>Taken off here, changed since</span
										>
									{:else if c?.refused}
										<span class="chip crit"><span class="dot"></span>Change refused</span>
									{:else if c?.change.act === 'remove'}
										<span class="chip acc"><span class="dot"></span>Taken off on this phone</span>
									{:else if c}
										<span class="chip acc"><span class="dot"></span>Changed on this phone</span>
									{/if}
								</div>
							{/if}
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(l.amount)}</span>
							<span class="rec-x">
								{quantity(l.qty)}{l.unit ? ` ${l.unit}` : ''} × {quantity(l.unit_price)}
							</span>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{:else}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{l.description}</div>
							{#if l.detail}<div class="rec-s">{l.detail}{l.taxable ? ' · taxable' : ''}</div>{/if}
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(l.amount)}</span>
							<span class="rec-x">
								{quantity(l.qty)}{l.unit ? ` ${l.unit}` : ''} × {quantity(l.unit_price)}
							</span>
						</div>
					</div>
				{/if}
			{/each}

			{#each pending as q (q.line.client_uuid)}
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
			{/each}

			{#if Number(t.untaxed) > 0}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t lt">
							{listed(t.untaxed_kinds) || 'Untaxed'} — not taxable
						</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">{money(t.untaxed)}</span></div>
				</div>
			{/if}

			{#if Number(t.tax) > 0}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t lt">
							Sales tax{t.district ? ` · ${t.district} ${made(t)}` : ''}{listed(t.taxed_kinds)
								? ` on ${listed(t.taxed_kinds)}`
								: ''}
						</div>
						{#if data.lines.find((l) => l.taxable && l.where_from)}
							<div class="rec-s">
								From {data.lines.find((l) => l.taxable && l.where_from)?.where_from}, where the work
								happened
							</div>
						{/if}
					</div>
					<div class="rec-n"><span class="rec-v mut">{money(t.tax)}</span></div>
				</div>
			{/if}

			<div class="rec tot">
				<div class="rec-m"><div class="rec-t">Due</div></div>
				<div class="rec-n"><span class="rec-v">{money(t.due)}</span></div>
			</div>
		</div>
	</div>

	{#if Number(r.taxable_measure) > 0}
		<div class="sec">
			<div class="sec-h"><h2>What this does to the return</h2></div>
			<div class="rows">
				{#if pending.length}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-s">
								Without the {pending.length === 1 ? 'line' : `${pending.length} lines`} on this phone:
								worked out again when {pending.length === 1 ? 'it reaches' : 'they reach'} the server.
							</div>
						</div>
					</div>
				{/if}
				<div class="rec">
					<div class="rec-m"><div class="rec-t">Taxable measure</div></div>
					<div class="rec-n"><span class="rec-v">{money(r.taxable_measure)}</span></div>
				</div>
				{#if Number(r.resold) > 0}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">Less tax-paid purchases resold</div>
							<div class="rec-s">The ex-tax cost, stored on the line</div>
						</div>
						<div class="rec-n"><span class="rec-v">−{money(r.resold)}</span></div>
					</div>
				{/if}
				<div class="rec">
					<div class="rec-m"><div class="rec-t">Net taxable — the markup</div></div>
					<div class="rec-n"><span class="rec-v">{money(netTaxable)}</span></div>
				</div>
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Due on the return</div></div>
					<div class="rec-n"><span class="rec-v">{money(dueOnReturn)}</span></div>
				</div>
			</div>
		</div>
	{/if}

	{#if data.takenOff.length}
		<div class="sec">
			<div class="sec-h"><h2>Taken off</h2></div>
			<div class="rows">
				{#each data.takenOff as g (g.id)}
					<a
						class="rec link"
						href={resolve('/invoices/[id]/lines/[line]/history', { id: i.id, line: g.id })}
					>
						<div class="rec-m">
							<div class="rec-t">{g.description}</div>
							<div class="rec-s">
								{g.who ?? 'Someone'} · {datedAt(g.at, personalZone())}, {clock(
									g.at,
									personalZone()
								)}
							</div>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Why the server would not take a line, in its words. */
	.refusal {
		margin-top: 6px;
		color: var(--crit);
	}
	.acts {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.link-text {
		font-family: var(--f-mono);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
</style>
