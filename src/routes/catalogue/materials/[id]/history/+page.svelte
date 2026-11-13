<script lang="ts">
	import { clock, dated, datedAt, percent, todayIn } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { DETAILS, materialEvents, type Detail } from '#lib/material-history.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * A material's History tab: every save that changed what it is or what it
	 * sells at, newest first, as one Primer box -- who made it, and when.
	 */
	let { data }: PageProps = $props();
	const events = $derived(materialEvents(data.rows));
	const m = $derived(data.material);
	const per = $derived(m.unit === 'each' ? 'each' : `a ${m.unit}`);

	const who = (id: string | null) => (id ? (data.people[id] ?? 'Someone') : 'Someone');
	/** "9:50 AM", or "Oct 2, 2026, 9:50 AM" on another day. */
	const when = (at: string) => {
		const zone = personalZone();
		const ms = Date.parse(at);
		return todayIn(zone, ms) === todayIn(zone)
			? clock(ms, zone)
			: `${datedAt(ms, zone)}, ${clock(ms, zone)}`;
	};
	/** A detail's value, as its own row on Details says it. */
	function said(field: Detail, v: string | null): string {
		if (v === null || v === '') return 'nothing';
		if (field === 'taxable') return v === 'true' ? 'Yes' : 'No';
		if (field === 'unit_id') return data.units[v] ?? 'a unit since removed';
		return `“${v}”`;
	}
	const markup = (v: string | null) => (v === null ? 'the business’s' : percent(v));
	const text = (v: unknown) =>
		typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
</script>

<section class="box" aria-labelledby="changes-h">
	<div class="box-h">
		<h2 class="box-t" id="changes-h">Changes, newest first</h2>
		<span class="count">{events.length}</span>
	</div>
	{#each events as e, i (i)}
		<div class="box-row ev">
			{#if e.added}
				{@const unit = text(e.added.unit_id)}
				<span class="t">Added</span>
				<span class="sub">
					{[
						text(e.added.name),
						unit ? `counted in ${data.units[unit] ?? 'a unit since removed'}` : null
					]
						.filter(Boolean)
						.join(' · ')}
				</span>
			{/if}
			{#if e.offered === false}<span class="t">Retired</span>{/if}
			{#if e.offered === true}<span class="t">Offered again</span>{/if}
			{#each e.changes as c (c.field)}
				<span class="t">
					{DETAILS[c.field]}:
					<span class="lt">{said(c.field, c.from)} → {said(c.field, c.to)}</span>
				</span>
			{/each}
			{#if e.markup}
				<span class="t">
					Markup: <span class="lt">{markup(e.markup.from)} → {markup(e.markup.to)}</span>
				</span>
			{/if}
			{#if e.priced}
				<span class="t">
					{#if e.priced.price !== null}
						Sells at {unitPrice(e.priced.price)} {per}
					{:else}
						Sells at its markup again
					{/if}
					<span class="lt">from {dated(e.priced.from)}</span>
				</span>
			{/if}
			<span class="sub">{who(e.who)} · {when(e.at)}</span>
		</div>
	{:else}
		<p class="box-row muted">Nothing changed yet.</p>
	{/each}
</section>

<style>
	.ev {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.t {
		font-weight: 600;
	}
	.lt {
		font-weight: 400;
		color: var(--ink-2);
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
</style>
