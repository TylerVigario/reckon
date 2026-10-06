<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Decimal, Ratio, sum } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { discardLine, flush, held, linesHeld, type QueuedLine } from '#lib/queue.ts';
	import { roundTax } from '#lib/tax-rounding.ts';
	import { warm } from '#lib/warm.ts';
	import { clock, day, monthOf, pct, quantity, rateParts } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const i = $derived(data.invoice);

	// LINES ON THIS PHONE: added here and waiting to send, or sent and refused.
	// Read from the queue on mount -- the server cannot know them yet -- and
	// again whenever the queue sends, when what it took comes back as the
	// server's own lines.
	let onPhone = $state<QueuedLine[]>([]);
	let waiting = $state(0);
	async function read() {
		try {
			const [mine, all, time] = await Promise.all([linesHeld(i.id), linesHeld(), held()]);
			onPhone = mine;
			waiting = all.filter((q) => !q.refused).length + time.waiting;
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

	// THE TOTALS, with what is on this phone in them: the server's lines and the
	// phone's, taxed by the rounding the server's own lines were. A line from
	// stock is costed when it arrives, so with one on the phone this is what the
	// draft will come to as near as the phone can say. Nothing waiting, and they
	// are the server's own figures.
	const t = $derived.by(() => {
		const server = data.totals;
		if (pending.length === 0) return server;
		const all = [
			...data.lines.map((l) => ({
				kind: l.kind,
				amount: l.amount,
				taxable: l.taxable,
				rate: l.tax_rate_pct
			})),
			...pending.map((q) => ({
				kind: q.line.shown.kind,
				amount: q.line.shown.amount,
				taxable: q.line.shown.taxable,
				rate: q.line.shown.tax_rate_pct
			}))
		];
		const taxed = all.filter((l) => l.taxable);
		const untaxed = sum(all.filter((l) => !l.taxable).map((l) => l.amount));
		const measure = sum(taxed.map((l) => l.amount));
		const tax =
			roundTax(
				taxed.map((l) => ({ rate: l.rate, tax: Ratio.of(l.amount).mul(l.rate).div(100) })),
				data.rounding,
				data.places
			) ?? Decimal.ZERO;
		return {
			...server,
			untaxed: untaxed.toFixed(data.places),
			tax: tax.toFixed(data.places),
			due: untaxed.add(measure).add(tax).toFixed(data.places),
			untaxed_kinds: [...new Set(all.filter((l) => !l.taxable).map((l) => l.kind))],
			taxed_kinds: [...new Set(taxed.map((l) => l.kind))]
		};
	});

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

	const period = $derived(i.period_start ? monthOf(i.period_start) : null);
	const sub = $derived([i.who, period].filter(Boolean).join(' · '));
	const title = $derived(i.status === 'draft' ? `Draft ${i.number}` : i.number);
</script>

<Top {title} {sub} back={resolve('/invoices')} backLabel="Invoices">
	{#snippet actions()}
		{#if i.status === 'draft'}
			<a class="btn sm" href={resolve('/invoices/[id]/add', { id: i.id })}>Add a line</a>
			<span class="btn pri sm">Send</span>
		{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
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
		<div class="tile">
			<span class="k">Due</span>
			<span class="v">{money(t.due)}</span>
			<span class="s">{i.terms ? `Net ${i.terms}` : i.due_on ? day(i.due_on) : 'no terms set'}</span
			>
		</div>
		<div class="tile">
			<span class="k">Status</span>
			<span class="v sm {i.status === 'draft' ? 'warn' : 'good'}">
				{i.status === 'draft' ? 'Draft' : 'Sent'}
			</span>
			<span class="s">
				{i.status === 'draft'
					? `Assembled ${clock(i.assembled, personalZone())}`
					: `Sent ${day(i.sent_on)}`}
			</span>
		</div>
	</div>

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
				{:else}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{l.description}</div>
							{#if l.detail}<div class="rec-s">{l.detail}{l.taxable ? ' · taxable' : ''}</div>{/if}
							{#if l.receipt}
								<div class="rec-s">
									<a href={resolve('/invoices/[id]/lines/[line]/receipt', { id: i.id, line: l.id })}
										>The receipt</a
									>
								</div>
							{/if}
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
</style>
