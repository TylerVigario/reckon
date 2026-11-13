<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import RecordHead from '#lib/RecordHead.svelte';
	import { Decimal } from '#lib/decimal.ts';
	import { quantity } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import {
		readAdjustment,
		REASON_WORDS,
		REASONS_FOR,
		type AdjustReason,
		type AdjustWay
	} from '#lib/adjust-fields.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	/**
	 * A material, as Primer draws a record: its name, what is on hand and what
	 * it sells at in a line under it, then its tabs -- Stock and Adjustments,
	 * each its own address. Receive stock and Adjust are its actions; Adjust
	 * opens a dialog to take some off the shelf or put some on, how many, on
	 * which day, why, and a note (#lib/adjust-fields).
	 */
	let { data, children }: LayoutProps = $props();
	const m = $derived(data.material);
	const per = $derived(m.unit === 'each' ? 'each' : `a ${m.unit}`);

	let open = $state(false);
	let way = $state<AdjustWay>('off');
	let qty = $state('');
	let day = $state('');
	let reason = $state<AdjustReason>('used');
	let costEach = $state('');
	let note = $state('');
	let errors = $state<Record<string, string>>({});
	let problem = $state('');
	let saving = $state(false);

	function adjust() {
		way = 'off';
		qty = '';
		day = data.today;
		reason = 'used';
		costEach = '';
		note = '';
		errors = {};
		problem = '';
		open = true;
	}
	// The reason follows the way: a find is only put on.
	$effect(() => {
		if (!REASONS_FOR[way].includes(reason)) reason = REASONS_FOR[way][0];
	});
	/** What it leaves on the shelf, as a count: no figure that might not be what is written off. */
	const leaves = $derived.by(() => {
		try {
			const n = Decimal.from(qty);
			if (!n.gt(0)) return null;
			const on = Decimal.from(m.on_hand);
			const after = way === 'off' ? on.sub(n) : on.add(n);
			return after.lt(0) ? null : after.toString();
		} catch {
			return null;
		}
	});

	async function send() {
		const fields = {
			way,
			qty,
			made_on: day,
			reason,
			note,
			cost_each: way === 'on' ? costEach : ''
		};
		errors = readAdjustment(fields, m.places).errors;
		problem = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`/api/materials/${m.id}/adjustments`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		saving = false;
		if (!r) return void (problem = 'Not saved — no connection.');
		if (!r.ok) {
			const b = await readProblem(r);
			errors = b.errors ?? {};
			if (!Object.keys(errors).length) problem = b.detail ?? 'That did not save.';
			return;
		}
		open = false;
		await refreshAll();
	}

	const tabs = $derived([
		{
			href: resolve('/catalogue/materials/[id]', { id: m.id }),
			label: 'Stock',
			current: page.route.id === '/catalogue/materials/[id]'
		},
		{
			href: resolve('/catalogue/materials/[id]/adjustments', { id: m.id }),
			label: 'Adjustments',
			count: data.adjusted,
			current: page.route.id === '/catalogue/materials/[id]/adjustments'
		}
	]);
</script>

{#snippet wrong(key: string)}
	{#if errors[key]}
		<p class="fc-e" id="a-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<Top title={m.name} back={resolve('/catalogue/materials')} backLabel="Materials">
	{#snippet actions()}
		<button type="button" class="btn sm" onclick={adjust}>Adjust</button>
		<a class="btn sm pri" href={resolve(`/catalogue/receipts/new?material=${m.id}`)}>Receive</a>
	{/snippet}
</Top>

<div class="pad primer">
	<RecordHead label="{m.name}’s record" {tabs}>
		{#snippet state()}
			<span class="muted">
				{[
					`${quantity(m.on_hand)} ${m.unit} on hand`,
					m.price ? `sells at ${unitPrice(m.price)} ${per}` : null,
					m.brand,
					m.sku
				]
					.filter(Boolean)
					.join(' · ')}
			</span>
		{/snippet}
	</RecordHead>

	{@render children()}
</div>

<Dialog
	{open}
	title="Adjust {m.name}"
	go={way === 'off' ? 'Take it off' : 'Put it on'}
	going="Saving…"
	working={saving}
	ongo={send}
	onclose={() => (open = false)}
>
	<fieldset class="fc">
		<legend class="fc-l">Stock</legend>
		<label class="rad">
			<input type="radio" name="a-way" value="off" bind:group={way} />
			<span><span class="rad-t">Take some off</span></span>
		</label>
		<label class="rad">
			<input type="radio" name="a-way" value="on" bind:group={way} />
			<span><span class="rad-t">Put some on</span></span>
		</label>
	</fieldset>
	<div class="pair">
		<div class="fc">
			<label class="fc-l" for="a-qty">How many<span aria-hidden="true"> *</span></label>
			<span class="tv">
				<input
					id="a-qty"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={qty}
					aria-invalid={errors.qty ? 'true' : undefined}
					aria-describedby={errors.qty ? 'a-qty-e' : 'a-qty-c'}
				/>
				<span class="tv-v" aria-hidden="true">{m.unit}</span>
			</span>
			{#if errors.qty}
				{@render wrong('qty')}
			{:else}
				<p class="fc-c" id="a-qty-c">
					{leaves !== null
						? `Leaves ${quantity(leaves)} ${m.unit} on the shelf.`
						: `${quantity(m.on_hand)} ${m.unit} on the shelf now.`}
				</p>
			{/if}
		</div>
		<div class="fc">
			<label class="fc-l" for="a-day">Day<span aria-hidden="true"> *</span></label>
			<input
				id="a-day"
				class="ti"
				type="date"
				max={data.today}
				bind:value={day}
				aria-invalid={errors.made_on ? 'true' : undefined}
				aria-describedby={errors.made_on ? 'a-made_on-e' : undefined}
			/>
			{@render wrong('made_on')}
		</div>
	</div>
	<fieldset class="fc">
		<legend class="fc-l">Why</legend>
		{#each REASONS_FOR[way] as r (r)}
			<label class="rad">
				<input type="radio" name="a-why" value={r} bind:group={reason} />
				<span><span class="rad-t">{REASON_WORDS[r]}</span></span>
			</label>
		{/each}
		{@render wrong('reason')}
	</fieldset>
	{#if way === 'on'}
		<div class="fc">
			<label class="fc-l" for="a-cost">Cost each, before tax</label>
			<input
				id="a-cost"
				class="ti"
				inputmode="decimal"
				autocomplete="off"
				bind:value={costEach}
				aria-invalid={errors.cost_each ? 'true' : undefined}
				aria-describedby={errors.cost_each ? 'a-cost_each-e' : 'a-cost-c'}
			/>
			{#if errors.cost_each}
				{@render wrong('cost_each')}
			{:else}
				<p class="fc-c" id="a-cost-c">
					{m.ex_tax
						? `Empty is what one on the shelf is worth now: ${unitPrice(m.ex_tax)} ${per}.`
						: 'Nothing is on the shelf to go by: say what one cost.'}
				</p>
			{/if}
		</div>
	{/if}
	<div class="fc">
		<label class="fc-l" for="a-note">Note</label>
		<input
			id="a-note"
			class="ti"
			autocomplete="off"
			bind:value={note}
			aria-invalid={errors.note ? 'true' : undefined}
			aria-describedby={errors.note ? 'a-note-e' : undefined}
		/>
		{@render wrong('note')}
	</div>
	{#if problem}<p class="fc-e"><Octicon name="alert" />{problem}</p>{/if}
</Dialog>

<style>
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: 20px;
	}
	.tv {
		position: relative;
		display: block;
	}
	.tv .ti {
		padding-right: 56px;
	}
	.tv-v {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		color: var(--ink-3);
		pointer-events: none;
	}
</style>
