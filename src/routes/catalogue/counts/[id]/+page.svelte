<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import CountSheet from '#lib/CountSheet.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { Decimal } from '#lib/decimal.ts';
	import { flush, stockHeld } from '#lib/queue.ts';
	import { dated, quantity } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { type Keep } from '#lib/count-fields.ts';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * A count. Being counted, it is a sheet (#lib/CountSheet), counted with a
	 * signal or without. Apply puts each difference right, asking first, once
	 * everything counted on this phone has arrived; stock that moved since it
	 * was counted asks what to keep, as Odoo asks (#lib/count-fields). Applied,
	 * it says what was counted and what each difference moved and was worth.
	 */
	let { data }: PageProps = $props();
	const c = $derived(data.count);
	const open = $derived(c.applied_at === null);
	const lineOf = $derived(new Map(data.lines.map((l) => [l.material_id, l])));
	const counted = $derived(data.sheet.filter((m) => lineOf.has(m.id)));
	const adjustedOf = $derived(new Map(data.adjustments.map((a) => [a.material_id, a])));
	/** How many figures on this count are still on this phone. */
	let waiting = $state(0);

	/** What the count found against what the shelf said then. */
	const found = (l: { counted: string; on_hand: string }) => Decimal.from(l.counted).sub(l.on_hand);

	// Applying: asked first; moved stock asks what to keep.
	type Moved = {
		material_id: string;
		name: string;
		unit: string;
		counted: string;
		was: string;
		now: string;
	};
	let applying = $state<'idle' | 'asking' | 'moved'>('idle');
	let working = $state(false);
	let moved = $state<Moved[]>([]);
	let keep = $state<Keep>('counted');
	let problem = $state('');
	const short = $derived(data.lines.filter((l) => found(l).lt(0)).length);
	const over = $derived(data.lines.filter((l) => found(l).gt(0)).length);
	async function apply() {
		working = true;
		problem = '';
		// What is counted here goes first; a count is applied as the server has it.
		await flush().catch(() => null);
		const left = await stockHeld().then(
			(h) => h.counted.filter((q) => q.counted.count === c.id && !q.refused).length,
			() => 0
		);
		if (left > 0) {
			working = false;
			return void (problem =
				'Some of what was counted on this phone has not arrived yet. Apply it once it has.');
		}
		const r = await fetch(`/api/counts/${c.id}/apply`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(applying === 'moved' ? { keep } : {})
		}).catch(() => null);
		working = false;
		if (!r) return void (problem = 'Not applied — no connection.');
		if (r.ok) {
			applying = 'idle';
			return void (await refreshAll());
		}
		const b = (await readProblem(r)) as { detail?: string; moved?: Moved[] };
		if (r.status === 409 && b.moved?.length) {
			moved = b.moved;
			keep = 'counted';
			applying = 'moved';
			return;
		}
		problem = b.detail ?? 'It was not applied.';
	}

	let deleting = $state<'idle' | 'asking' | 'working'>('idle');
	async function remove() {
		deleting = 'working';
		const r = await fetch(`/api/counts/${c.id}`, { method: 'DELETE' }).catch(() => null);
		if (r?.ok) return void (await goto(resolve('/catalogue/materials')));
		deleting = 'idle';
		problem = r
			? ((await readProblem(r)).detail ?? 'It was not deleted.')
			: 'Not deleted — no connection.';
	}
</script>

<Top
	title="Count"
	sub={open
		? `${dated(c.counted_on)} · started by ${c.by}`
		: `${dated(c.counted_on)} · applied by ${c.applied_by}`}
	back={resolve('/catalogue/materials')}
	backLabel="Materials"
>
	{#snippet actions()}
		{#if open}
			<button
				type="button"
				class="btn sm pri"
				disabled={data.lines.length === 0}
				onclick={() => {
					problem = '';
					applying = 'asking';
				}}>Apply</button
			>
			<ActionMenu
				label="Actions for this count"
				items={[
					{ label: 'Delete this count', danger: true, onselect: () => void (deleting = 'asking') }
				]}
			/>
		{/if}
	{/snippet}
</Top>

<div class="pad primer">
	<OfflineBanner asOf={data.as_of} {waiting} />
	{#if problem && applying === 'idle'}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}
	{#if open}
		<CountSheet
			count={c.id}
			sheet={data.sheet}
			lines={data.lines}
			onwaiting={(n) => (waiting = n)}
		/>
	{:else}
		<section class="box" aria-labelledby="counted-h">
			<div class="box-h">
				<h2 class="box-t" id="counted-h">What was counted</h2>
				<span class="count">{data.lines.length}</span>
			</div>
			{#each counted as m (m.id)}
				{@const line = lineOf.get(m.id)!}
				{@const a = adjustedOf.get(m.id)}
				<div class="box-row done">
					<span class="what">
						<span class="n">{m.name}</span>
						<span class="sub">
							Counted {quantity(line.counted)}
							{m.unit} · the shelf said {quantity(line.on_hand)}
							{m.unit} · {line.by}
						</span>
					</span>
					<span class="fig">
						{#if a}
							<span class="v" class:off={a.way === 'off'}
								>{a.way === 'off' ? '−' : '+'}{quantity(a.qty)} {m.unit}</span
							>
							<span class="sub">{money(a.worth)}</span>
						{:else}
							<span class="muted">Matched</span>
						{/if}
					</span>
				</div>
			{/each}
		</section>
		<p class="note">
			Each difference is an adjustment on its material, marked Counted. Applied
			{dated(c.applied_at!.slice(0, 10))}; a count stays as it was applied.
		</p>
	{/if}
</div>

<Dialog
	open={applying !== 'idle'}
	title={applying === 'moved' ? 'Moved since it was counted' : 'Apply this count?'}
	go="Apply"
	going="Applying…"
	{working}
	ongo={apply}
	onclose={() => (applying = 'idle')}
>
	{#if applying === 'moved'}
		<ul class="moved">
			{#each moved as x (x.material_id)}
				<li>
					<strong>{x.name}</strong>: counted {quantity(x.counted)}
					{x.unit} when the shelf said {quantity(x.was)}
					{x.unit}; it says {quantity(x.now)}
					{x.unit} now.
				</li>
			{/each}
		</ul>
		<fieldset class="fc">
			<legend class="fc-l">Keep</legend>
			<label class="rad">
				<input type="radio" name="c-keep" value="counted" bind:group={keep} />
				<span
					><span class="rad-t">What was counted</span><span class="rad-c"
						>The shelf becomes what was counted.</span
					></span
				>
			</label>
			<label class="rad">
				<input type="radio" name="c-keep" value="difference" bind:group={keep} />
				<span
					><span class="rad-t">The difference found</span><span class="rad-c"
						>What the count found short or over is applied to what the shelf says now.</span
					></span
				>
			</label>
		</fieldset>
	{:else}
		<p>
			{data.lines.length} counted: {short} short, {over} over, {data.lines.length - short - over}
			matching. What is short comes off at what it cost; what is over goes on at what one on the shelf
			is worth now.
		</p>
		<p>Once applied, a count stays as it is. An adjustment puts any of it right after.</p>
	{/if}
	{#if problem}<p class="fc-e"><Octicon name="alert" />{problem}</p>{/if}
</Dialog>

<Dialog
	open={deleting !== 'idle'}
	title="Delete this count?"
	go="Delete"
	going="Deleting…"
	working={deleting === 'working'}
	tone="danger"
	ongo={remove}
	onclose={() => (deleting = 'idle')}
>
	<p>What was counted on it goes with it. Nothing on the shelf changes.</p>
</Dialog>

<style>
	.box-row {
		margin: 0;
	}
	.done {
		display: flex;
		align-items: center;
		gap: 12px;
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
	.v.off {
		color: var(--crit);
	}
	.moved {
		margin: 0;
		padding-left: 1.2em;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
