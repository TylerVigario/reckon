<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { eventsOf, FIELDS, type Change } from '#lib/line-history.ts';
	import { clock, datedAt, pct, quantity, todayIn } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const events = $derived(eventsOf(data.rows));
	// What it is called and counted in: as it is, or as it was when it was
	// taken off.
	const whole = $derived(events.flatMap((e) => (e.what === 'changed' ? [] : [e.was])));
	/** A value the line was written down with: text, or a number as JSON keeps one. */
	const text = (v: unknown) =>
		typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
	const name = $derived(data.line?.description ?? text(whole.at(-1)?.description) ?? 'A line');
	const unit = $derived(data.line?.unit ?? text(whole.at(-1)?.unit) ?? '');
	const of = $derived(`${data.draft.status === 'draft' ? 'Draft ' : ''}${data.draft.number}`);

	const who = (id: string | null) => (id ? (data.people[id] ?? 'Someone') : 'Someone');
	/** "9:50 AM", or "Oct 2, 2026, 9:50 AM" on another day. */
	const when = (at: string) => {
		const zone = personalZone();
		const ms = Date.parse(at);
		return todayIn(zone, ms) === todayIn(zone)
			? clock(ms, zone)
			: `${datedAt(ms, zone)}, ${clock(ms, zone)}`;
	};
	/** A value as the line's own screen writes it. */
	function said(field: Change['field'], v: string | null): string {
		const is = FIELDS[field].is;
		if (is === 'person') return v ? who(v) : 'the business';
		if (v === null || v === '') return 'nothing';
		if (is === 'money') return money(v);
		if (is === 'price') return unitPrice(v);
		if (is === 'quantity') return `${quantity(v)}${unit ? ` ${unit}` : ''}`;
		if (is === 'rate') return pct(v);
		if (is === 'site') return data.sites[v] ?? 'a site since removed';
		if (is === 'receipt') return 'a receipt';
		return `“${v}”`;
	}
	/** What it was when it was added, in a few words. */
	const summary = (was: Record<string, unknown>) => {
		const qty = text(was.qty);
		const price = text(was.unit_price);
		const amount = text(was.amount);
		const site = text(was.site_id);
		const counted = text(was.unit);
		return [
			text(was.description),
			qty !== null && price !== null
				? `${quantity(qty)}${counted ? ` ${counted}` : ''} × ${unitPrice(price)}`
				: null,
			amount !== null ? money(amount) : null,
			site !== null ? (data.sites[site] ?? null) : null
		]
			.filter(Boolean)
			.join(' · ');
	};
</script>

<Top
	title="History"
	sub={`${name} · ${of}`}
	back={data.line
		? resolve('/invoices/[id]/lines/[line]', { id: data.draft.id, line: data.line.id })
		: resolve('/invoices/[id]', { id: data.draft.id })}
	backLabel={data.line ? 'The line' : data.draft.number}
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>Oldest first</h2></div>
		<div class="rows">
			{#if events.length === 0 || events[0].what !== 'added'}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t lt">Added before lines kept their history</div>
					</div>
				</div>
			{/if}
			{#each events as e, i (i)}
				<div class="rec" class:gone={e.what === 'removed'}>
					<div class="rec-m">
						{#if e.what === 'added'}
							<div class="rec-t">Added</div>
							<div class="rec-s">{summary(e.was)}</div>
						{:else if e.what === 'removed'}
							<div class="rec-t">Taken off the draft</div>
							<div class="rec-s">{summary(e.was)}</div>
						{:else}
							{#each e.changes as c (c.field)}
								<div class="rec-t">
									{FIELDS[c.field].label}:
									<span class="lt">{said(c.field, c.from)} → {said(c.field, c.to)}</span>
								</div>
							{/each}
						{/if}
						<div class="rec-s who">{who(e.who)} · {when(e.at)}</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.who {
		margin-top: 4px;
	}
	.gone .rec-t {
		color: var(--crit);
	}
</style>
