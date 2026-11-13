<script lang="ts">
	import Dialog from '#lib/Dialog.svelte';
	import PriceForm from '#lib/service/PriceForm.svelte';
	import { dated } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * A service's Prices tab: every client's price and each client's own, in
	 * force or scheduled, and the agreements that cover it instead of an hourly
	 * price. A price is added or changed in a dialog (#lib/service/PriceForm);
	 * one in force since today asks before it is taken back.
	 */
	let { data }: PageProps = $props();
	const s = $derived(data.service);
	const per = $derived(s.unit === 'hour' ? 'an hour' : s.unit === 'mile' ? 'a mile' : 'each');

	type Price = (typeof data.prices)[number];
	let editing = $state<{ preset: Price | null } | null>(null);
	let form = $state<PriceForm>();
	let saving = $state(false);
	let problem = $state('');

	const when = (r: { state: string; effective_from: string }) =>
		r.state === 'scheduled'
			? `Takes over ${dated(r.effective_from)}`
			: `Since ${dated(r.effective_from)}`;
	// A row can be taken back until the day it starts has passed: a scheduled
	// change, or one entered by mistake today. After that it is history.
	const takeable = (r: { state: string; effective_from: string }) =>
		r.state === 'scheduled' || r.effective_from === data.today;

	// One that started today has already priced today's work, and taking it
	// back re-figures that work, so it asks. A scheduled one has touched
	// nothing yet, and goes at one tap.
	let taking = $state<Price | null>(null);
	let takingBack = $state(false);
	async function takeBack(p: Price) {
		problem = '';
		takingBack = true;
		const r = await fetch(`/api/services/${s.id}/prices/${p.id}`, { method: 'DELETE' }).catch(
			() => null
		);
		takingBack = false;
		taking = null;
		if (!r?.ok)
			problem = r
				? ((await readProblem(r)).detail ?? 'That was not taken back.')
				: 'Not taken back — no connection.';
		else await refreshAll();
	}
	async function saved() {
		editing = null;
		await refreshAll();
	}
</script>

{#if problem}<p class="fc-e">{problem}</p>{/if}

<section class="box" aria-labelledby="prices-h">
	<div class="box-h">
		<h2 class="box-t" id="prices-h">What the client pays</h2>
		<button type="button" class="btn sm" onclick={() => (editing = { preset: null })}
			>{data.prices.length ? 'Add a price' : 'Price it'}</button
		>
	</div>
	{#each data.prices as p (p.id)}
		<div class="box-row line">
			<span class="what">
				<span class="n">{p.client ?? 'Every client'}</span>
				<span class="sub">
					{when(p)}{s.unit === 'hour'
						? Number(p.additional_rate) > 0
							? ` · +${unitPrice(p.additional_rate)} for each additional person`
							: ' · the same however many work it'
						: ''}
				</span>
			</span>
			{#if p.state === 'scheduled'}<span class="lab acc">Scheduled</span>{/if}
			<span class="fig">
				<span class="v">{unitPrice(p.rate)}</span>
				<span class="sub">{per}</span>
			</span>
			<span class="acts">
				{#if p.state === 'current'}
					<button type="button" class="btn sm" onclick={() => (editing = { preset: p })}
						>Change</button
					>
				{/if}
				{#if takeable(p)}
					<button
						type="button"
						class="btn sm"
						onclick={() => (p.state === 'scheduled' ? takeBack(p) : (taking = p))}>Take back</button
					>
				{/if}
			</span>
		</div>
	{/each}
	{#each data.covered as c (c.agreement_id)}
		<a class="box-row line" href={resolve('/catalogue/agreements/[id]', { id: c.agreement_id })}>
			<span class="what">
				<span class="n">{c.who} · {c.site ?? 'the whole client'}</span>
				<span class="sub">Covered by their agreement: not billed by the hour</span>
			</span>
			<span class="lab acc">Retainer</span>
			<span class="fig">
				<span class="v">{c.allotment === 'unlimited' ? 'Unlimited' : c.hours}</span>
				{#if c.allotment !== 'unlimited'}<span class="sub">hours</span>{/if}
			</span>
		</a>
	{/each}
	{#if data.prices.length === 0 && data.covered.length === 0}
		<p class="box-row muted">Not priced yet: nothing can be billed under it.</p>
	{/if}
</section>

<Dialog
	open={editing !== null}
	title={editing?.preset
		? `Change ${editing.preset.client ?? 'every client'}’s price`
		: 'Add a price'}
	go="Save price"
	going="Saving…"
	working={saving}
	ongo={() => void form?.save()}
	onclose={() => (editing = null)}
>
	{#if editing}
		{#key editing.preset?.id ?? 'new'}
			<PriceForm
				bind:this={form}
				onsaving={(busy) => (saving = busy)}
				serviceId={s.id}
				unit={s.unit}
				clients={data.clients}
				today={data.today}
				preset={editing.preset}
				onsaved={saved}
			/>
		{/key}
	{/if}
</Dialog>

<Dialog
	open={taking !== null}
	title="Take back {taking ? unitPrice(taking.rate) : ''} {per}?"
	go="Take back"
	going="Taking back…"
	working={takingBack}
	tone="danger"
	ongo={() => taking && takeBack(taking)}
	onclose={() => (taking = null)}
>
	<p>
		It has been in force since today. Today’s work not yet billed goes back to the price before it,
		if there was one. It isn’t kept anywhere: to have it again, it is entered again.
	</p>
</Dialog>

<style>
	.box-row {
		margin: 0;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		min-height: 64px;
		box-sizing: border-box;
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
	.lab {
		flex: 0 0 auto;
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
		font-family: var(--f-mono);
		font-weight: 600;
	}
	.acts {
		flex: 1 0 100%;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.acts:empty {
		display: none;
	}
	.fc-e {
		margin: 0;
	}
</style>
