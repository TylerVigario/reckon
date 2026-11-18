<script lang="ts">
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { Decimal } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import {
		changesHeld,
		discardChange,
		discardLine,
		enqueueChange,
		flush,
		linesHeld,
		notKept,
		waitingCount,
		type QueuedChange,
		type QueuedLine
	} from '#lib/queue.ts';
	import { draftTotals } from '#lib/draft-totals.ts';
	import { warm } from '#lib/warm.ts';
	import { clock, datedAt, day, levied, monthOf, pct, quantity } from '#lib/format.ts';
	import type { TaxPiece } from '#lib/server/db/tax-pieces.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { opens } from '#lib/access.ts';

	let { data }: PageProps = $props();

	// Someone with Field adds lines and changes the ones they added (#lib/access).
	const field = $derived(data.user?.access === 'field');

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
		} catch (e) {
			stored = notKept(e, 'This phone would not save that, so the line is not put back yet.');
			return;
		}
		await send();
		await refreshAll();
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
			await refreshAll();
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
		r.resold === null
			? null
			: Decimal.from(r.taxable_measure).sub(r.resold).toFixed(currencyPlaces())
	);
	const dueOnReturn = $derived(r.due_on_return);

	// The rate and who levied each piece of it: a return allocates each
	// separately, so the invoice that charged them says which is which.
	const made = (x: { rate_pct: string | null; pieces: TaxPiece[] | null }) =>
		x.pieces ? `${pct(x.rate_pct)} (${levied(x.pieces)})` : pct(x.rate_pct);

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
			{#if opens(data.user?.access, '/invoices/[id]/send')}
				<a class="btn pri sm" href={resolve('/invoices/[id]/send', { id: i.id })}>Send</a>
			{/if}
		{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#each data.movedIn as m (m.number)}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t why">
					{m.number} went out{m.sent_at
						? ` at ${clock(m.sent_at, personalZone())} on ${datedAt(m.sent_at, personalZone())}`
						: ''}
					while {m.lines === 1 ? 'a line' : `${m.lines} lines`} added to it on a phone {m.lines ===
					1
						? 'was'
						: 'were'} on the way. {m.lines === 1 ? 'It' : 'They'} could not join it, so this draft was
					started for {i.who}, and took the next number when it reached the server.
				</p>
			</div>
		</div>
	{/each}
	{#each data.movedOut as m (m.id)}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t why">
					{m.lines === 1 ? 'A line' : `${m.lines} lines`} added to this on a phone after it went out
					{m.lines === 1 ? 'is' : 'are'} on
					<a href={resolve('/invoices/[id]', { id: m.id })}>{m.number}</a>.
				</p>
			</div>
		</div>
	{/each}
	{#if stored}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t why">{stored}</p></div>
		</div>
	{/if}

	<div class="state">
		{#if i.status === 'draft'}
			<span class="lab warn">Draft</span>
			<span class="muted">
				{money(t.due)} due · {i.terms
					? `net ${i.terms}`
					: i.due_on
						? day(i.due_on)
						: 'no terms set'} · assembled {clock(i.assembled, personalZone())}
			</span>
		{:else}
			<!-- Paid is what is owed coming to nothing, not a status (0028). -->
			{#if i.status === 'void'}
				<span class="lab crit">Voided</span>
			{:else if Number(data.totals.owed) === 0}
				<span class="lab good">Paid</span>
			{:else}
				<span class="lab good">Sent</span>
			{/if}
			<span class="muted">
				{Number(data.totals.owed) === 0
					? `${money(data.totals.due)} paid`
					: `${money(data.totals.owed)} owed of ${money(data.totals.due)}`} · {day(i.issued_on)} · due
				{day(i.due_on)}
			</span>
		{/if}
	</div>

	{#if putBack.length}
		<section class="box" aria-labelledby="back-h">
			<div class="box-h">
				<h2 class="box-t" id="back-h">Taken off while this phone was offline</h2>
			</div>
			{#each putBack as q (q.change.line_id)}
				{@const gone = q.refused?.conflict}
				<div class="box-row held">
					<span class="n">{q.change.shown.description}</span>
					<p class="refusal">
						{gone?.what === 'removed' ? (gone.by ?? 'Someone') : 'Someone'} took it off{gone?.what ===
						'removed'
							? ` at ${clock(gone.at, personalZone())}`
							: ''}. Your change to it waits on this phone.
					</p>
					<div class="acts">
						<button class="btn sm pri" onclick={() => restore(q)}
							>Put it back, with your change</button
						>
						<button class="btn sm" onclick={() => letChangeGo(q)}>Let your change go</button>
					</div>
				</div>
			{/each}
		</section>
	{/if}
	{#if kept.length}
		<section class="box" aria-labelledby="kept-h">
			<div class="box-h"><h2 class="box-t" id="kept-h">Not added</h2></div>
			{#each kept as q (q.line.client_uuid)}
				{@const l = q.line.shown}
				<div class="box-row held">
					<span class="n">{l.description}</span>
					<span class="sub">{l.detail} · {money(l.amount)}</span>
					<p class="refusal">
						Refused: {q.refused?.detail} It is kept on this phone until it is fixed or let go.
					</p>
					<div class="acts">
						<a
							class="btn sm pri"
							href={resolve(`/invoices/[id]/add?fix=${encodeURIComponent(q.line.client_uuid)}`, {
								id: i.id
							})}>Fix</a
						>
						<button class="btn sm" onclick={() => letGo(q.line.client_uuid)}>
							{confirming === q.line.client_uuid ? 'Tap again to discard' : 'Discard'}
						</button>
					</div>
				</div>
			{/each}
		</section>
	{/if}

	{#if i.link}
		<section class="box" aria-labelledby="link-h">
			<div class="box-h"><h2 class="box-t" id="link-h">The client’s link</h2></div>
			<div class="box-row held">
				<span class="link-text">{i.link.replace(/^https?:\/\//, '')}</span>
				<span class="sub">
					{handed === 'copied'
						? 'Sent, and the link is copied.'
						: handed === 'shared'
							? 'Sent, and the link is shared.'
							: handed === 'sent'
								? 'Sent. Share the link from here.'
								: 'Opens without signing in. Anyone with it can see this invoice.'}
				</span>
				<div class="acts">
					<button type="button" class="btn sm" onclick={copyLink}>Copy</button>
					{#if canShare}
						<button type="button" class="btn sm" onclick={shareLink}>Share</button>
					{/if}
				</div>
			</div>
		</section>
	{/if}

	<section class="box" aria-labelledby="lines-h">
		<div class="box-h"><h2 class="box-t" id="lines-h">Lines</h2></div>
		{#each data.lines as l (l.id)}
			{#if l.trip_leg_id}
				<a class="box-row line" href={resolve('/trips')}>
					<span class="what">
						<span class="n">{l.description}</span>
						{#if l.detail}<span class="sub">{l.detail}</span>{/if}
					</span>
					<span class="fig">
						<span class="v">{money(l.amount)}</span>
						<span class="sub">{quantity(l.qty)} × {quantity(l.unit_price)}</span>
					</span>
				</a>
			{:else if BY_HAND.includes(l.kind)}
				{@const c = changeOf.get(l.id)}
				<!-- Added by hand: its own screen has its receipt, what it billed,
				     its history, and -- on a draft -- changing it or taking it off. -->
				<a
					class="box-row line"
					href={resolve('/invoices/[id]/lines/[line]', { id: i.id, line: l.id })}
				>
					<span class="what">
						<span class="n">{l.description}</span>
						{#if l.detail}<span class="sub">{l.detail}{l.taxable ? ' · taxable' : ''}</span>{/if}
						{#if l.receipt || l.moved_from || c || (field && l.mine)}
							<span class="labs">
								{#if field && l.mine}<span class="lab">Added by you</span>{/if}
								{#if l.receipt}<span class="lab">Receipt</span>{/if}
								{#if l.moved_from}<span class="lab">Moved from {l.moved_from}</span>{/if}
								{#if c?.refused?.conflict?.what === 'collided'}
									<span class="lab warn">Changed in two places</span>
								{:else if c?.refused?.conflict?.what === 'changed'}
									<span class="lab warn">Taken off here, changed since</span>
								{:else if c?.refused}
									<span class="lab crit">Change refused</span>
								{:else if c?.change.act === 'remove'}
									<span class="lab acc">Taken off on this phone</span>
								{:else if c}
									<span class="lab acc">Changed on this phone</span>
								{/if}
							</span>
						{/if}
					</span>
					<span class="fig">
						<span class="v">{money(l.amount)}</span>
						<span class="sub"
							>{quantity(l.qty)}{l.unit ? ` ${l.unit}` : ''} × {quantity(l.unit_price)}</span
						>
					</span>
				</a>
			{:else}
				<div class="box-row line">
					<span class="what">
						<span class="n">{l.description}</span>
						{#if l.detail}<span class="sub">{l.detail}{l.taxable ? ' · taxable' : ''}</span>{/if}
					</span>
					<span class="fig">
						<span class="v">{money(l.amount)}</span>
						<span class="sub"
							>{quantity(l.qty)}{l.unit ? ` ${l.unit}` : ''} × {quantity(l.unit_price)}</span
						>
					</span>
				</div>
			{/if}
		{/each}

		{#each pending as q (q.line.client_uuid)}
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
		{/each}

		{#if Number(t.untaxed) > 0}
			<div class="box-row line">
				<span class="what"
					><span class="sub">{listed(t.untaxed_kinds) || 'Untaxed'}, not taxable</span></span
				>
				<span class="v muted">{money(t.untaxed)}</span>
			</div>
		{/if}

		{#if Number(t.tax) > 0}
			<div class="box-row line">
				<span class="what">
					<span class="sub">
						Sales tax{t.area ? ` · ${t.area} ${made(t)}` : ''}{listed(t.taxed_kinds)
							? ` on ${listed(t.taxed_kinds)}`
							: ''}
					</span>
					{#if data.lines.find((l) => l.taxable && l.where_from)}
						<span class="sub">
							From {data.lines.find((l) => l.taxable && l.where_from)?.where_from}, where the work
							happened
						</span>
					{/if}
				</span>
				<span class="v muted">{money(t.tax)}</span>
			</div>
		{/if}

		<div class="box-row line tot">
			<span class="what"><span class="n">Due</span></span>
			<span class="v">{money(t.due)}</span>
		</div>
	</section>

	{#if Number(r.taxable_measure) > 0 && r.due_on_return !== null}
		<section class="box" aria-labelledby="return-h">
			<div class="box-h"><h2 class="box-t" id="return-h">What this does to the return</h2></div>
			{#if pending.length}
				<p class="box-row sub">
					Without the {pending.length === 1 ? 'line' : `${pending.length} lines`} on this phone: worked
					out again when {pending.length === 1 ? 'it reaches' : 'they reach'} the server.
				</p>
			{/if}
			<div class="box-row line">
				<span class="what"><span class="n">Taxable measure</span></span>
				<span class="v">{money(r.taxable_measure)}</span>
			</div>
			{#if Number(r.resold) > 0}
				<div class="box-row line">
					<span class="what">
						<span class="n">Less tax-paid purchases resold</span>
						<span class="sub">The ex-tax cost, stored on the line</span>
					</span>
					<span class="v">−{money(r.resold)}</span>
				</div>
			{/if}
			<div class="box-row line">
				<span class="what"><span class="n">Net taxable: the markup</span></span>
				<span class="v">{money(netTaxable)}</span>
			</div>
			<div class="box-row line tot">
				<span class="what"><span class="n">Due on the return</span></span>
				<span class="v">{money(dueOnReturn)}</span>
			</div>
		</section>
	{/if}

	{#if data.takenOff.length}
		<section class="box" aria-labelledby="off-h">
			<div class="box-h"><h2 class="box-t" id="off-h">Taken off</h2></div>
			{#each data.takenOff as g (g.id)}
				<a
					class="box-row line"
					href={resolve('/invoices/[id]/lines/[line]/history', { id: i.id, line: g.id })}
				>
					<span class="what">
						<span class="n">{g.description}</span>
						<span class="sub">
							{g.who ?? 'Someone'} · {datedAt(g.at, personalZone())}, {clock(g.at, personalZone())}
						</span>
					</span>
				</a>
			{/each}
		</section>
	{/if}
</div>

<style>
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.held {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
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
		color: var(--fgColor-muted);
	}
	p.sub {
		margin: 0;
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
		text-align: right;
	}
	.v {
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.tot {
		background: var(--bgColor-muted);
	}
	/* Why the server would not take a line, in its words. */
	.refusal {
		margin: 0;
		color: var(--fgColor-danger);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 6px;
	}
	.link-text {
		font-family: var(--fontStack-monospace);
		font-size: 13px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
</style>
