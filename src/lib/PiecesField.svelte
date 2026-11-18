<script lang="ts" module>
	/** One piece of a rate as it is typed: who levies it, and how much. */
	export type PieceDraft = { level: 'state' | 'local'; jurisdiction: string; rate_pct: string };

	/** A rate as it is kept, "6.8500", written as a person would type it: "6.85". */
	export const asTyped = (rate: string) => (rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate);
</script>

<script lang="ts">
	import Octicon from '#lib/Octicon.svelte';
	import { Decimal } from '#lib/decimal.ts';
	import { pct } from '#lib/format.ts';
	import { NO_STATE_TAX, type State } from '#lib/us-states.ts';

	/**
	 * A RATE, PIECE BY PIECE, as a state's own table lists it: who levies each
	 * share and how much -- the state's, then each local one -- and what they
	 * come to. Pieces are added and taken away here; what each may be is
	 * #lib/area-fields', and its complaints arrive keyed `pieces.2.rate_pct`.
	 */
	let {
		pieces = $bindable(),
		state,
		errors = {},
		id
	}: {
		pieces: PieceDraft[];
		state: State;
		errors?: Record<string, string>;
		id: string;
	} = $props();

	// Alaska's and Montana's taxes are local alone.
	const levels = $derived(
		NO_STATE_TAX.includes(state)
			? [{ value: 'local', label: 'Local' }]
			: [
					{ value: 'state', label: 'State' },
					{ value: 'local', label: 'Local' }
				]
	);
	const total = $derived.by(() => {
		try {
			return pieces.reduce((t, p) => t.add(p.rate_pct.trim() || '0'), Decimal.from('0'));
		} catch {
			return null;
		}
	});
	const add = () => (pieces = [...pieces, { level: 'local', jurisdiction: '', rate_pct: '' }]);
	const drop = (i: number) => (pieces = pieces.filter((_, j) => j !== i));
	const wrong = (i: number, f: string) => errors[`pieces.${i}.${f}`] ?? errors[`pieces.${i}`];
</script>

<fieldset class="fc pieces" aria-describedby="{id}-c">
	<legend class="fc-l">Who levies what<span aria-hidden="true"> *</span></legend>
	{#each pieces as p, i (i)}
		<div class="piece">
			<div class="who">
				<label class="fc-l sr" for="{id}-{i}-j">Who levies piece {i + 1}</label>
				<input
					id="{id}-{i}-j"
					class="ti"
					autocomplete="off"
					placeholder={p.level === 'state' ? 'The state' : 'County, city or district'}
					bind:value={p.jurisdiction}
					aria-invalid={wrong(i, 'jurisdiction') ? 'true' : undefined}
				/>
			</div>
			<div class="how">
				<label class="fc-l sr" for="{id}-{i}-l">Level of piece {i + 1}</label>
				<select
					id="{id}-{i}-l"
					class="ti"
					bind:value={p.level}
					aria-invalid={wrong(i, 'level') ? 'true' : undefined}
				>
					{#each levels as l (l.value)}<option value={l.value}>{l.label}</option>{/each}
				</select>
				<label class="fc-l sr" for="{id}-{i}-r">Rate of piece {i + 1}, percent</label>
				<span class="rate">
					<input
						id="{id}-{i}-r"
						class="ti"
						autocomplete="off"
						inputmode="decimal"
						placeholder="0.000"
						bind:value={p.rate_pct}
						aria-invalid={wrong(i, 'rate_pct') ? 'true' : undefined}
					/>
					<span aria-hidden="true">%</span>
				</span>
				<button
					type="button"
					class="btn gho sm"
					aria-label="Take away piece {i + 1}"
					disabled={pieces.length === 1}
					onclick={() => drop(i)}><Octicon name="x" /></button
				>
			</div>
			{#each ['jurisdiction', 'level', 'rate_pct'] as f (f)}
				{#if errors[`pieces.${i}.${f}`]}
					<p class="fc-e"><Octicon name="alert" />{errors[`pieces.${i}.${f}`]}</p>
				{/if}
			{/each}
		</div>
	{/each}
	<div class="foot">
		<button type="button" class="btn sm" onclick={add}>Add a piece</button>
		<span class="sum">{total ? `${pct(total.toString())} in all` : ''}</span>
	</div>
	{#if errors.pieces}
		<p class="fc-e"><Octicon name="alert" />{errors.pieces}</p>
	{:else}
		<p class="fc-c" id="{id}-c">
			As the state’s table lists them: the state’s share, then each county, city or district’s.
		</p>
	{/if}
</fieldset>

<style>
	.pieces {
		display: flex;
		flex-direction: column;
		gap: 12px;
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
	}
	.piece {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--borderColor-muted);
	}
	.how {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.how select {
		flex: 0 0 6.5rem;
	}
	.rate {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.rate input {
		min-width: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.sum {
		font-variant-numeric: tabular-nums;
		color: var(--fgColor-muted);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
