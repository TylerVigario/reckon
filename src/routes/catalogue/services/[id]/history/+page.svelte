<script lang="ts">
	import { clock, dated, datedAt, increment, todayIn } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import UnderlinePanels from '#lib/UnderlinePanels.svelte';
	import { SERVICE_DETAILS, serviceEvents, type ServiceDetail } from '#lib/service-history.ts';
	import { PAYS_FOR, paysWhat } from '#lib/pay-words.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * A service's History tab, in three parts of its own (#lib/UnderlinePanels):
	 * every price and every pay rule it has had -- scheduled, in force, or
	 * superseded, each with the days it covered -- and every save that changed
	 * what it is, newest first, with who made it (#lib/service-history).
	 */
	let { data }: PageProps = $props();
	const events = $derived(serviceEvents(data.changes));
	const who = (id: string | null) => (id ? (data.people[id] ?? 'Someone') : 'Someone');
	/** "9:50 AM", or "Oct 2, 2026, 9:50 AM" on another day. */
	const when = (at: string) => {
		const zone = personalZone();
		const ms = Date.parse(at);
		return todayIn(zone, ms) === todayIn(zone)
			? clock(ms, zone)
			: `${datedAt(ms, zone)}, ${clock(ms, zone)}`;
	};
	const UNIT_WORDS: Record<string, string> = { hour: 'Hour', mile: 'Mile', each: 'Each' };
	/** A detail's value, as its own row on Details says it. */
	function said(field: ServiceDetail, v: string | null): string {
		if (field === 'bill_to_nearest_seconds') return increment(v === null ? null : Number(v));
		if (v === null || v === '') return 'nothing';
		if (field === 'unit') return UNIT_WORDS[v] ?? v;
		if (field === 'minimum_charge') return money(v);
		if (field === 'time_tracked' || field === 'taxable') return v === 'true' ? 'Yes' : 'No';
		return `“${v}”`;
	}
	const text = (v: unknown) => (typeof v === 'string' ? v : null);
	let part = $state('prices');

	const per = (u: string) => (u === 'mile' ? 'a mile' : u === 'hour' ? 'an hour' : 'each');
	const STATE = {
		scheduled: { label: 'Scheduled', tone: 'acc' },
		current: { label: 'In force', tone: 'good' },
		superseded: { label: 'Superseded', tone: '' }
	} as const;

	/** The period a row was, is, or will be in force. */
	const span = (r: { state: string; effective_from: string; until: string | null }) =>
		r.state === 'scheduled'
			? `Takes over ${dated(r.effective_from)}`
			: r.state === 'current'
				? `Since ${dated(r.effective_from)}`
				: `${dated(r.effective_from)} – ${r.until ? dated(r.until) : 'now'}`;
</script>

<UnderlinePanels
	label="History"
	id="hist"
	bind:selected={part}
	tabs={[
		{ id: 'prices', label: 'All prices', count: data.prices.length },
		{ id: 'pay', label: 'All pay', count: data.rules.length },
		{ id: 'changes', label: 'Changes', count: events.length }
	]}
/>

<div
	role="tabpanel"
	id="hist-panel-prices"
	aria-labelledby="hist-tab-prices"
	hidden={part !== 'prices'}
>
	<section class="box" aria-labelledby="paid-h">
		<div class="box-h">
			<h2 class="box-t" id="paid-h">What the client paid</h2>
			<span class="count">{data.prices.length}</span>
		</div>
		{#each data.prices as p (p.id)}
			{@const st = STATE[p.state]}
			<div class="box-row line" class:past={p.state === 'superseded'}>
				<span class="what">
					<span class="n">{p.client ?? 'Every client'}</span>
					<span class="sub">
						{span(p)}{Number(p.additional_rate) > 0
							? ` · +${unitPrice(p.additional_rate)} for each additional person`
							: ''}
					</span>
				</span>
				{#if st}<span class="lab {st.tone}">{st.label}</span>{/if}
				<span class="end-fig">
					<span class="v">{unitPrice(p.rate)}</span>
					<span class="sub">{per(data.service.unit)}</span>
				</span>
			</div>
		{:else}
			<p class="box-row muted">Never priced.</p>
		{/each}
	</section>
	<p class="note">
		A superseded row still counts. Work is priced and paid by the rows in force on the day it was
		done, so a line from before a change keeps the figure it was worth then.
	</p>
</div>
<div role="tabpanel" id="hist-panel-pay" aria-labelledby="hist-tab-pay" hidden={part !== 'pay'}>
	<section class="box" aria-labelledby="rules-h">
		<div class="box-h">
			<h2 class="box-t" id="rules-h">Who was paid, and how</h2>
			<span class="count">{data.rules.length}</span>
		</div>
		{#each data.rules as r (r.id)}
			{@const w = paysWhat(r, { money, unitPrice })}
			{@const st = STATE[r.state]}
			<div class="box-row line" class:past={r.state === 'superseded'}>
				<span class="what">
					<span class="n">{r.payee} · {PAYS_FOR[r.pays_for]}</span>
					<span class="sub">{r.client ?? 'Every client'} · {span(r)}</span>
				</span>
				{#if st}<span class="lab {st.tone}">{st.label}</span>{/if}
				<span class="end-fig">
					<span class="v" class:muted={r.method === 'nothing'}>{w.v}</span>
					{#if w.x}<span class="sub">{w.x}</span>{/if}
				</span>
			</div>
		{:else}
			<p class="box-row muted">No pay rule, ever.</p>
		{/each}
	</section>
	<p class="note">
		A superseded row still counts. Work is priced and paid by the rows in force on the day it was
		done, so a line from before a change keeps the figure it was worth then.
	</p>
</div>
<div
	role="tabpanel"
	id="hist-panel-changes"
	aria-labelledby="hist-tab-changes"
	hidden={part !== 'changes'}
>
	<section class="box" aria-labelledby="changes-h">
		<div class="box-h">
			<h2 class="box-t" id="changes-h">Changes, newest first</h2>
			<span class="count">{events.length}</span>
		</div>
		{#each events as e, i (i)}
			<div class="box-row ev">
				{#if e.added}
					<span class="t">Added</span>
					<span class="sub"
						>{[text(e.added.name), UNIT_WORDS[text(e.added.unit) ?? '']]
							.filter(Boolean)
							.join(' · ')}</span
					>
				{/if}
				{#if e.removed}<span class="t">Deleted</span>{/if}
				{#if e.offered === false}<span class="t">Retired</span>{/if}
				{#if e.offered === true}<span class="t">Offered again</span>{/if}
				{#each e.changes as c (c.field)}
					<span class="t">
						{SERVICE_DETAILS[c.field]}:
						<span class="lt">{said(c.field, c.from)} → {said(c.field, c.to)}</span>
					</span>
				{/each}
				<span class="sub">{who(e.who)} · {when(e.at)}</span>
			</div>
		{:else}
			<p class="box-row muted">Nothing changed since history was kept.</p>
		{/each}
	</section>
</div>

<style>
	/* A part's box and its note, spaced as the screen spaces its own (.pad). */
	[role='tabpanel']:not([hidden]) {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.box-row {
		margin: 0;
	}
	.ev {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		overflow-wrap: anywhere;
	}
	.t {
		font-weight: 600;
	}
	.lt {
		font-weight: 400;
		color: var(--ink-2);
	}
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		box-sizing: border-box;
	}
	.line.past .n,
	.line.past .v {
		color: var(--ink-3);
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
	.lab {
		flex: 0 0 auto;
	}
	.end-fig {
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
</style>
