<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import RecordHead from '#lib/RecordHead.svelte';
	import StockOnPhone from '#lib/StockOnPhone.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { enqueueAdjust, findAdjust, flush, waitingCount, type QueuedAdjust } from '#lib/queue.ts';
	import { onMount } from 'svelte';
	import { Decimal } from '#lib/decimal.ts';
	import { quantity } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { changeMaterial } from '#lib/material-change.ts';
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
	 * it sells at in a line under it, then its tabs -- Stock, Adjustments,
	 * Details and History, each its own address. Receive stock and Adjust are
	 * its actions; Adjust opens a dialog to take some off the shelf or put some
	 * on, how many, on which day, why, and a note (#lib/adjust-fields). Retire
	 * and Offer again are in its menu, retiring asking first.
	 *
	 * An adjustment is kept on the phone first and sent by the queue
	 * (#lib/queue), so it is made with no signal too; what is waiting, or was
	 * refused, is said above the tabs, with Fix reopening Adjust with it.
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
	/** The uuid it is made with: kept while it is fixed, so it is one adjustment. */
	let uuid = '';
	let onPhone = $state<{ refresh: () => Promise<void> }>();
	let waiting = $state(0);

	function adjust() {
		uuid = crypto.randomUUID();
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
	/** An adjustment the server refused, opened again in Adjust to be fixed. */
	function fix(q: QueuedAdjust) {
		const f = q.adjust.fields;
		uuid = q.adjust.client_uuid;
		way = f.way === 'on' ? 'on' : 'off';
		qty = f.qty ?? '';
		day = f.made_on ?? data.today;
		reason = (f.reason as AdjustReason) ?? 'used';
		costEach = f.cost_each ?? '';
		note = f.note ?? '';
		errors = q.refused?.errors ?? {};
		problem = q.refused && !Object.keys(errors).length ? q.refused.detail : '';
		open = true;
	}
	onMount(() => {
		void waitingCount().then(
			(n) => (waiting = n),
			() => {}
		);
		const id = page.url.searchParams.get('fix');
		if (id)
			void findAdjust(id).then(
				(q) => q && q.adjust.material_id === m.id && fix(q),
				() => {}
			);
	});

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
		// More than the shelf holds, as this screen knows it, is refused here;
		// the server says again, off the shelf as it is when it arrives.
		if (!errors.qty && way === 'off')
			try {
				if (Decimal.from(qty).gt(m.on_hand))
					errors.qty = `Only ${quantity(m.on_hand)} ${m.unit} of ${m.name} is on the shelf.`;
			} catch {
				/* not a figure; the rule above said so */
			}
		if (Object.keys(errors).length) return;
		saving = true;
		try {
			await enqueueAdjust({
				client_uuid: uuid,
				material_id: m.id,
				fields,
				made_at: new Date().toISOString(),
				shown: { name: m.name, unit: m.unit, way, qty, reason }
			});
		} catch {
			saving = false;
			return void (problem = 'This phone would not keep it, so it is not made.');
		}
		// A few seconds for the server to take it; no longer, on a weak signal.
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		const left = await findAdjust(uuid).catch(() => undefined);
		saving = false;
		if (left?.refused) {
			errors = left.refused.errors ?? {};
			if (!Object.keys(errors).length) problem = left.refused.detail;
			await onPhone?.refresh();
			return;
		}
		open = false;
		await onPhone?.refresh();
		await refreshAll();
	}

	let retiring = $state(false);
	let offering = $state(false);
	let failed = $state('');
	/**
	 * Offered or not, from the save the record is at, kept on the phone and
	 * sent as any change to it is (#lib/material-change).
	 */
	async function setOffered(active: boolean) {
		offering = true;
		failed = '';
		const came = await changeMaterial({
			kind: 'fields',
			material_id: m.id,
			version: m.version,
			base: { active: String(m.active) },
			fields: { active: String(active) },
			made_at: new Date().toISOString(),
			shown: { name: m.name }
		}).catch(() => null);
		offering = false;
		if (!came) failed = 'This phone would not keep it, so it is not changed.';
		else if (came.state === 'refused') failed = came.refused.detail;
		await refreshAll();
	}
	const menu = $derived(
		m.active
			? [{ label: 'Retire', onselect: (): void => void (retiring = true) }]
			: [{ label: 'Offer again', onselect: (): void => void setOffered(true) }]
	);

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
		},
		{
			href: resolve('/catalogue/materials/[id]/details', { id: m.id }),
			label: 'Details',
			current: page.route.id === '/catalogue/materials/[id]/details'
		},
		{
			href: resolve('/catalogue/materials/[id]/history', { id: m.id }),
			label: 'History',
			current: page.route.id === '/catalogue/materials/[id]/history'
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
		{#if m.active}
			<a class="btn sm pri" href={resolve(`/catalogue/receipts/new?material=${m.id}`)}>Receive</a>
		{/if}
		<ActionMenu label="Actions for {m.name}" items={menu} />
	{/snippet}
</Top>

<div class="pad primer">
	<OfflineBanner asOf={data.as_of} {waiting} />
	<RecordHead label="{m.name}’s record" {tabs}>
		{#snippet state()}
			{#if !m.active}<span class="lab warn">Retired</span>{/if}
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

	{#if !m.active}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t">Not offered for new lines</p>
				<p class="banner-d">
					It can’t be put on a draft or received. Offer it again from its menu.
				</p>
			</div>
		</div>
	{/if}
	<StockOnPhone bind:this={onPhone} material={m.id} today={data.today} onfix={fix} />
	{#if failed}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{failed}</p></div>
		</div>
	{/if}

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

<Dialog
	open={retiring}
	title="Retire {m.name}?"
	go="Retire"
	going="Retiring…"
	working={offering}
	ongo={async () => {
		await setOffered(false);
		retiring = false;
	}}
	onclose={() => (retiring = false)}
>
	<p>
		It can no longer be added to a draft or received, and it moves under Retired on Materials. Lines
		it is already on keep it{Number(m.on_hand) > 0
			? `, and the ${quantity(m.on_hand)} ${m.unit} on the shelf stay counted until adjusted off`
			: ''}.
	</p>
	<p>Offer it again to put it back as it was.</p>
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
