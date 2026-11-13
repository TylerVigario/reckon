<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import UnderlinePanels from '#lib/UnderlinePanels.svelte';
	import { Decimal } from '#lib/decimal.ts';
	import { dated, quantity } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { readCountLine, type Keep } from '#lib/count-fields.ts';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * A count. Being counted, it is a sheet in two tabs (#lib/UnderlinePanels):
	 * what is still to count, and what has been -- each material with what is
	 * on hand, and a box for how many are there, saved as it is left, so a
	 * count can stop and carry on. Apply puts each difference right, asking
	 * first; stock that moved since it was counted asks what to keep, as Odoo
	 * asks (#lib/count-fields). Applied, it says what was counted and what
	 * each difference moved and was worth.
	 */
	let { data }: PageProps = $props();
	const c = $derived(data.count);
	const open = $derived(c.applied_at === null);
	const lineOf = $derived(new Map(data.lines.map((l) => [l.material_id, l])));
	const toCount = $derived(data.sheet.filter((m) => !lineOf.has(m.id)));
	const counted = $derived(data.sheet.filter((m) => lineOf.has(m.id)));
	const adjustedOf = $derived(new Map(data.adjustments.map((a) => [a.material_id, a])));
	let part = $state('to');

	/** A figure as a box holds it: no trailing zeros. */
	const plain = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);
	/** What the count found against what the shelf said then: "−5 ft", "+2 ft", or none. */
	const found = (l: { counted: string; on_hand: string }) => Decimal.from(l.counted).sub(l.on_hand);

	// What is being typed, by material, until it is saved.
	let drafts = $state<Record<string, string>>({});
	let costs = $state<Record<string, string>>({});
	let wrong = $state<Record<string, string>>({});
	let saving = $state<Record<string, boolean>>({});

	type Row = (typeof data.sheet)[number];
	async function save(m: Row) {
		const line = lineOf.get(m.id);
		const raw = (drafts[m.id] ?? (line ? plain(line.counted) : '')).trim();
		const cost = (costs[m.id] ?? (line?.cost_each ? plain(line.cost_each) : '')).trim();
		if (
			raw === (line ? plain(line.counted) : '') &&
			cost === (line?.cost_each ? plain(line.cost_each) : '')
		)
			return;
		const endpoint = `/api/counts/${c.id}/lines/${m.id}`;
		let r: Response | null;
		if (raw === '') {
			saving[m.id] = true;
			r = await fetch(endpoint, { method: 'DELETE' }).catch(() => null);
		} else {
			const fields = { counted: raw, cost_each: cost };
			const why = readCountLine(fields, m.places).errors;
			if (Object.keys(why).length) return void (wrong[m.id] = why.counted ?? why.cost_each);
			saving[m.id] = true;
			r = await fetch(endpoint, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fields })
			}).catch(() => null);
		}
		if (!r || !r.ok) {
			saving[m.id] = false;
			const b = r ? await readProblem(r) : {};
			wrong[m.id] = r
				? (b.errors?.counted ?? b.errors?.cost_each ?? b.detail ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		delete wrong[m.id];
		await refreshAll();
		delete drafts[m.id];
		delete costs[m.id];
		saving[m.id] = false;
	}
	const leave = (e: KeyboardEvent) => {
		if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
	};

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

{#snippet sheetRow(m: Row)}
	{@const line = lineOf.get(m.id)}
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
					· {line.by}{moves ? ` · on hand was ${quantity(line.on_hand)} ${m.unit}` : ''}
				{:else}
					{quantity(m.on_hand)} {m.unit} on hand{m.active ? '' : ' · retired'}
				{/if}
			</span>
		</span>
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
				disabled={saving[m.id]}
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
		{/if}
	</div>
{/snippet}

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
	{#if problem && applying === 'idle'}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}
	{#if open}
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
			Only what is counted changes. Each is saved as it is typed, so the count can stop and carry
			on.
		</p>
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
	.cl {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		min-height: 64px;
		box-sizing: border-box;
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
