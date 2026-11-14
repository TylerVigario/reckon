<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Octicon from './Octicon.svelte';
	import UnderlinePanels from './UnderlinePanels.svelte';
	import { Decimal } from './decimal.ts';
	import { quantity } from './format.ts';
	import { readCountLine } from './count-fields.ts';
	import { warm } from './warm.ts';
	import { enqueueCounted, flush, stockHeld, type QueuedCounted } from './queue.ts';

	/**
	 * A COUNT BEING COUNTED, as a sheet in two tabs (#lib/UnderlinePanels): what
	 * is still to count, and what has been -- each material with what is on
	 * hand, and a box for how many are there. Each figure is kept on this phone
	 * as it is left and sent by the queue (#lib/queue), with what the shelf said
	 * here, so a count goes on with no signal and stops and carries on; one
	 * still on the phone says so. A figure taken back, emptied, takes the
	 * material off the count.
	 *
	 * The count is the server's, by its id, or one started on this phone, by
	 * the uuid it was started with (`count`). What the server has counted on it
	 * comes as `lines`; what is on this phone is put over it.
	 */
	type Row = {
		id: string;
		name: string;
		unit: string;
		places: number;
		active: boolean;
		on_hand: string;
	};
	type Line = {
		material_id: string;
		counted: string;
		on_hand: string;
		cost_each: string | null;
		by: string;
	};
	let {
		count,
		sheet,
		lines,
		onwaiting
	}: {
		count: string;
		sheet: Row[];
		lines: Line[];
		/** Told how many figures on this count are still on this phone, each time it looks. */
		onwaiting?: (n: number) => void;
	} = $props();

	let held = $state<QueuedCounted[]>([]);
	async function read() {
		try {
			held = (await stockHeld()).counted.filter((q) => q.counted.count === count);
		} catch {
			/* a phone that will not open its queue shows the server's alone */
		}
		onwaiting?.(held.filter((q) => !q.refused).length);
	}
	async function send() {
		const sent = await flush().catch(() => null);
		// The server's figures first, so one that arrived is not shown uncounted between.
		if (sent && sent.sent + sent.refused > 0) {
			await invalidateAll();
			warm();
		}
		await read();
	}
	onMount(() => {
		void read().then(send);
		const back = () => void send();
		addEventListener('online', back);
		return () => removeEventListener('online', back);
	});

	const heldOf = $derived(new Map(held.map((q) => [q.counted.material_id, q])));
	const serverOf = $derived(new Map(lines.map((l) => [l.material_id, l])));
	/** What is counted of a material: on this phone first, then the server's. */
	function lineOf(m: Row): (Line & { here: boolean }) | undefined {
		const q = heldOf.get(m.id);
		if (q && !q.refused) {
			const f = q.counted.fields;
			if (f.counted === '') return undefined;
			return {
				material_id: m.id,
				counted: f.counted,
				on_hand: f.on_hand || m.on_hand,
				cost_each: f.cost_each || null,
				by: 'On this phone',
				here: true
			};
		}
		const l = serverOf.get(m.id);
		return l ? { ...l, here: false } : undefined;
	}
	const toCount = $derived(sheet.filter((m) => !lineOf(m)));
	const counted = $derived(sheet.filter((m) => lineOf(m)));
	let part = $state('to');

	/** A figure as a box holds it: no trailing zeros. */
	const plain = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);
	/** What the count found against what the shelf said then. */
	const found = (l: { counted: string; on_hand: string }) => Decimal.from(l.counted).sub(l.on_hand);

	// What is being typed, by material, until it is kept.
	let drafts = $state<Record<string, string>>({});
	let costs = $state<Record<string, string>>({});
	let wrong = $state<Record<string, string>>({});

	async function save(m: Row) {
		const line = lineOf(m);
		const raw = (drafts[m.id] ?? (line ? plain(line.counted) : '')).trim();
		const cost = (costs[m.id] ?? (line?.cost_each ? plain(line.cost_each) : '')).trim();
		if (
			raw === (line ? plain(line.counted) : '') &&
			cost === (line?.cost_each ? plain(line.cost_each) : '')
		)
			return;
		if (raw !== '') {
			const why = readCountLine({ counted: raw, cost_each: cost }, m.places).errors;
			if (Object.keys(why).length) return void (wrong[m.id] = why.counted ?? why.cost_each);
		}
		try {
			await enqueueCounted({
				count,
				material_id: m.id,
				// What the shelf says on this screen, against which what moved since is told.
				fields: { counted: raw, cost_each: cost, on_hand: m.on_hand },
				made_at: new Date().toISOString(),
				shown: { name: m.name, unit: m.unit }
			});
		} catch {
			return void (wrong[m.id] = 'This phone would not keep it, so it is not counted.');
		}
		delete wrong[m.id];
		delete drafts[m.id];
		delete costs[m.id];
		await read();
		await Promise.race([send(), new Promise((r) => setTimeout(r, 4000))]);
	}
	const leave = (e: KeyboardEvent) => {
		if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
	};
</script>

{#snippet sheetRow(m: Row)}
	{@const line = lineOf(m)}
	{@const refused = heldOf.get(m.id)?.refused}
	{@const moves = line && !Decimal.from(line.on_hand).eq(m.on_hand)}
	<div class="box-row cl">
		<span class="what">
			<label class="n" for="c-{m.id}">{m.name}</label>
			<span class="sub">
				{#if line}
					{@const d = found(line)}
					{d.isZero()
						? 'Matches'
						: `${d.lt(0) ? '−' : '+'}${quantity((d.lt(0) ? d.neg() : d).toString())} ${m.unit}`}
					{line.here ? '' : `· ${line.by}`}{moves
						? ` · on hand was ${quantity(line.on_hand)} ${m.unit}`
						: ''}
				{:else}
					{quantity(m.on_hand)} {m.unit} on hand{m.active ? '' : ' · retired'}
				{/if}
			</span>
		</span>
		{#if line?.here}<span class="lab acc">On this phone</span>{/if}
		{#if moves}<span class="lab warn">Moved since</span>{/if}
		<span class="tv">
			<input
				id="c-{m.id}"
				class="ti"
				inputmode="decimal"
				autocomplete="off"
				style="padding-right: calc({m.unit.length}ch + 24px)"
				value={drafts[m.id] ?? (line ? plain(line.counted) : '')}
				oninput={(e) => (drafts[m.id] = e.currentTarget.value)}
				onchange={() => save(m)}
				onkeydown={leave}
				aria-invalid={wrong[m.id] ? 'true' : undefined}
				aria-describedby={wrong[m.id] ? `c-${m.id}-e` : undefined}
			/>
			<span class="tv-v" aria-hidden="true">{m.unit}</span>
		</span>
		{#if line && Number(m.on_hand) === 0 && Number(line.counted) > 0}
			<span class="cost">
				<label class="sub" for="c-{m.id}-cost">None on the shelf to cost it by: cost each</label>
				<input
					id="c-{m.id}-cost"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					value={costs[m.id] ?? (line.cost_each ? plain(line.cost_each) : '')}
					oninput={(e) => (costs[m.id] = e.currentTarget.value)}
					onchange={() => save(m)}
					onkeydown={leave}
				/>
			</span>
		{/if}
		{#if wrong[m.id]}
			<p class="fc-e full" id="c-{m.id}-e"><Octicon name="alert" />{wrong[m.id]}</p>
		{:else if refused}
			<p class="fc-e full"><Octicon name="alert" />Not counted: {refused.detail}</p>
		{/if}
	</div>
{/snippet}

<UnderlinePanels
	label="This count"
	id="count"
	bind:selected={part}
	tabs={[
		{ id: 'to', label: 'To count', count: toCount.length },
		{ id: 'done', label: 'Counted', count: counted.length }
	]}
/>
<div role="tabpanel" id="count-panel-to" aria-labelledby="count-tab-to" hidden={part !== 'to'}>
	<section class="box" aria-label="To count">
		{#each toCount as m (m.id)}
			{@render sheetRow(m)}
		{:else}
			<p class="box-row muted">Everything has been counted. Apply puts the shelf right.</p>
		{/each}
	</section>
</div>
<div
	role="tabpanel"
	id="count-panel-done"
	aria-labelledby="count-tab-done"
	hidden={part !== 'done'}
>
	<section class="box" aria-label="Counted">
		{#each counted as m (m.id)}
			{@render sheetRow(m)}
		{:else}
			<p class="box-row muted">Nothing counted yet. Type how many are there, under To count.</p>
		{/each}
	</section>
</div>
<p class="note">
	Only what is counted changes. Each is kept as it is typed, with a signal or without, so the count
	can stop and carry on.
</p>

<style>
	.box-row {
		margin: 0;
	}
	.cl {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		min-height: 64px;
		box-sizing: border-box;
	}
	.what {
		flex: 1 1 10rem;
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
	.tv {
		position: relative;
		flex: 0 0 8.5rem;
	}
	.tv .ti {
		text-align: right;
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
	.cost {
		flex: 1 1 100%;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}
	.cost .ti {
		flex: 0 0 8.5rem;
		text-align: right;
	}
	.full {
		flex: 1 1 100%;
	}
</style>
