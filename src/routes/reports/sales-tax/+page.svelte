<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { reportTabs } from '#lib/section-tabs.ts';
	import { Decimal } from '#lib/decimal.ts';
	import { dated, periodSaid } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { money } from '#lib/money.svelte.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * Each state's sales tax (#lib/server/sales-tax): what was collected there
	 * for somebody else, and who levied it; what has been handed over; and what
	 * is still held, which the home page adds up. Then each period's returns and
	 * payments, the latest first, each taken off from its menu, asking first.
	 */
	let { data }: PageProps = $props();

	type State = (typeof data.states)[number];
	type Period = State['periods'][number];

	const shares = (s: State) =>
		s.levied.map((p) => `${money(p.amount)} ${p.jurisdiction}`).join(' · ');

	// What a period's return said, and each payment, a line each, in parts that
	// wrap between them: a confirmation number is never split.
	const filed = (r: Period['returns'][number]) =>
		[
			`Filed ${dated(r.filed_on)}`,
			`${money(r.tax)} on the return`,
			Number(r.kept) > 0 ? `${money(r.kept)} kept` : null,
			r.amended ? 'amended since' : null,
			r.reference
		].filter((x) => x !== null);
	const paid = (p: Period['payments'][number]) =>
		[
			`Paid ${dated(p.paid_on)}`,
			Number(p.tax) > 0 ? money(p.tax) : null,
			Number(p.penalty_and_interest) > 0
				? `${money(p.penalty_and_interest)} penalty and interest`
				: null,
			p.reference
		].filter((x) => x !== null);

	/** What a period leaves owing, as its return stands. */
	const owing = (p: Period) => {
		if (p.owing === null) return { v: null, says: 'No return yet' };
		const o = Number(p.owing);
		if (o > 0) return { v: p.owing, says: 'owing' };
		if (o < 0) return { v: Decimal.from(p.owing).neg().toString(), says: 'paid over' };
		return { v: null, says: 'Paid' };
	};

	/** Taking a return or a payment off: asked first. */
	let asking = $state<{
		state: string;
		kind: 'returns' | 'payments';
		id: string;
		what: string;
	} | null>(null);
	let working = $state(false);
	let problem = $state('');
	async function takeOff() {
		if (!asking) return;
		const { state, kind, id } = asking;
		working = true;
		problem = '';
		const r = await fetch(`/api/sales-tax/${state}/${kind}/${id}`, { method: 'DELETE' }).catch(
			() => null
		);
		working = false;
		asking = null;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			problem = r
				? (Object.values(p?.errors ?? {})[0] ?? p?.detail ?? 'Not taken off.')
				: 'Not taken off — no connection.';
			return;
		}
		await refreshAll();
	}
	const menu = (state: string, p: Period) => [
		...p.returns.map((r) => ({
			label: `Take off the return filed ${dated(r.filed_on)}`,
			danger: true,
			onselect: () =>
				void (asking = {
					state,
					kind: 'returns',
					id: r.id,
					what: `the return filed ${dated(r.filed_on)}`
				})
		})),
		...p.payments.map((x) => ({
			label: `Take off the payment of ${dated(x.paid_on)}`,
			danger: true,
			onselect: () =>
				void (asking = {
					state,
					kind: 'payments',
					id: x.id,
					what: `the payment of ${dated(x.paid_on)}`
				})
		}))
	];
</script>

{#snippet parts(said: string[])}
	<span class="sub parts"
		>{#each said as part, i (i)}<span class="part">{part}</span>{/each}</span
	>
{/snippet}

<Top title="Reports" back={resolve('/more')} backLabel="More" />

<div class="pad">
	<UnderlineNav label="Reports" items={reportTabs('sales-tax', data)} />

	{#if problem}<p class="im crit" role="alert"><Octicon name="alert" />{problem}</p>{/if}

	{#each data.states as s (s.state)}
		<section class="box" aria-labelledby="held-{s.state}">
			<div class="box-h">
				<h2 class="box-t" id="held-{s.state}">{stateName(s.state)}</h2>
				<span class="sub">collected for the state</span>
			</div>
			<div class="box-row line">
				<span class="what">
					<span class="n">Collected from clients</span>
					{#if s.levied.length}<span class="sub">{shares(s)}</span>{/if}
				</span>
				<span class="v">{money(s.collected)}</span>
			</div>
			{#if Number(s.credit) > 0}
				<div class="box-row line">
					<span class="what">
						<span class="n">Tax already paid on goods resold</span>
						<span class="sub">Reg 1701: it comes off the return, so it is not owed twice</span>
					</span>
					<span class="v muted">−{money(s.credit)}</span>
				</div>
			{/if}
			{#if Number(s.kept) > 0}
				<div class="box-row line">
					<span class="what">
						<span class="n">Kept for filing on time</span>
						<span class="sub">As its returns say: the business’s own</span>
					</span>
					<span class="v muted">−{money(s.kept)}</span>
				</div>
			{/if}
			<div class="box-row line">
				<span class="what">
					<span class="n">Handed over</span>
					<span class="sub"
						>{s.periods.length
							? `For ${s.periods.length} ${s.periods.length === 1 ? 'period' : 'periods'}`
							: 'Nothing filed or paid yet'}</span
					>
				</span>
				<span class="v muted">{Number(s.handedOver) > 0 ? '−' : ''}{money(s.handedOver)}</span>
			</div>
			<div class="box-row line tot">
				{#if Number(s.held) < 0}
					<span class="what">
						<span class="n">Handed over beyond what was collected</span>
						<span class="sub"
							>Owed back by {stateName(s.state)}, or set against what is next due</span
						>
					</span>
					<span class="v">{money(Decimal.from(s.held).neg().toString())}</span>
				{:else}
					<span class="what">
						<span class="n">Still held</span>
						<span class="sub">Not the business’s money to spend</span>
					</span>
					<span class="v">{money(s.held)}</span>
				{/if}
			</div>
			{#if Number(s.penaltyAndInterest) > 0}
				<p class="box-row aside">
					Penalty and interest paid, {money(s.penaltyAndInterest)}, are the business’s own cost, not
					tax held.
				</p>
			{/if}
		</section>

		<section class="box" aria-labelledby="filed-{s.state}">
			<div class="box-h">
				<h2 class="box-t" id="filed-{s.state}">Returns and payments</h2>
			</div>
			{#if s.state === 'CA' && data.scheduleA}
				<a class="box-row line" href={resolve('/reports/schedule-a')}>
					<span class="what">
						<span class="n">Schedule A</span>
						<span class="sub">The filing year’s return by district, and what to look at first</span>
					</span>
				</a>
			{/if}
			{#each s.periods as p (p.start + p.end)}
				{@const o = owing(p)}
				<div class="box-row line period">
					<span class="what">
						<span class="n">{periodSaid(p)}</span>
						{#each p.returns as r (r.id)}{@render parts(filed(r))}{/each}
						{#each p.payments as x (x.id)}{@render parts(paid(x))}{/each}
					</span>
					<span class="fig">
						{#if o.v !== null}<span class="v">{money(o.v)}</span>{/if}
						<span class="sub">{o.says}</span>
					</span>
					<ActionMenu label="Actions for {periodSaid(p)}" items={menu(s.state, p)} />
				</div>
			{:else}
				<p class="box-row none">Nothing filed or paid in {stateName(s.state)} yet.</p>
			{/each}
			<div class="box-row acts">
				<a
					class="btn sm"
					href={resolve('/reports/sales-tax/[state]/returns/new', { state: s.state })}
					>Record a return</a
				>
				<a
					class="btn sm"
					href={resolve('/reports/sales-tax/[state]/payments/new', { state: s.state })}
					>Record a payment</a
				>
			</div>
		</section>
	{/each}

	<p class="note">
		Tax collected is the state’s, held until it is handed over. A return filed again for its period
		is its amended return, and stands in its place; what was paid for the period counts towards it.
	</p>
</div>

<Dialog
	open={asking !== null}
	title={asking?.kind === 'returns' ? 'Take the return off?' : 'Take the payment off?'}
	go="Take it off"
	going="Taking it off"
	tone="danger"
	{working}
	ongo={takeOff}
	onclose={() => (asking = null)}
>
	{#if asking}
		<p>
			Recorded by mistake, {asking.what} goes, as if it never was. Its history keeps what it said.
		</p>
	{/if}
</Dialog>

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
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
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
	.aside,
	.none {
		margin: 0;
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.parts {
		display: flex;
		flex-wrap: wrap;
		column-gap: 0.35em;
	}
	.part {
		white-space: nowrap;
	}
	.part:not(:last-child)::after {
		content: ' ·';
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	/* Primer's inline message: an icon and a line, in the colour of what happened. */
	.im {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0 0 12px;
		font-size: 14px;
		line-height: 20px;
	}
	.im :global(svg) {
		margin-top: 2px;
	}
	.im.crit {
		color: var(--fgColor-danger);
	}
</style>
