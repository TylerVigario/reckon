<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { parseField } from '#lib/settings-fields.ts';
	import { parseRegistrationField } from '#lib/registration-fields.ts';
	import { AUTHORITY, COLLECTABLE, stateName, type State } from '#lib/us-states.ts';
	import { readProblem } from '#lib/json.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * WHERE THE BUSINESS COLLECTS TAX: each state it is registered in, as a box
	 * of its own -- what it holds and from whom, how often it files, and in
	 * California the Reg 1701 election -- each changed in place (#lib/Detail).
	 * Then the year a return is cut to, which is the business's own. The rate
	 * is no setting: a site's is its area's, and the note under them says so.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.operator);
	const again = () => refreshAll();
	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	].map((m, i) => ({ value: String(i + 1), label: m }));

	// The states it could collect in and does not yet.
	const open = $derived(COLLECTABLE.filter((s) => !data.registrations.some((r) => r.state === s)));
	let adding = $state<State | ''>('');
	$effect(() => {
		if (!adding || !open.includes(adding)) adding = open[0] ?? '';
	});
	let working = $state<string | null>(null);
	let why = $state('');

	async function collect() {
		if (!adding) return;
		working = adding;
		why = '';
		const r = await fetch(`/api/settings/tax/${adding}`, { method: 'PUT' }).catch(() => null);
		working = null;
		if (!r?.ok) {
			why = r ? ((await readProblem(r))?.detail ?? 'Not saved.') : 'Not saved — no connection.';
			return;
		}
		await refreshAll();
	}

	// Stopping is said before it is done: a second tap stops it.
	let stopping = $state<string | null>(null);
	async function stop(state: string) {
		if (stopping !== state) {
			stopping = state;
			setTimeout(() => {
				if (stopping === state) stopping = null;
			}, 4000);
			return;
		}
		stopping = null;
		working = state;
		why = '';
		const r = await fetch(`/api/settings/tax/${state}`, { method: 'DELETE' }).catch(() => null);
		working = null;
		if (!r?.ok) {
			why = r ? ((await readProblem(r))?.detail ?? 'Not saved.') : 'Not saved — no connection.';
			return;
		}
		await refreshAll();
	}
</script>

<Top
	title="Tax"
	sub="Where it is collected, and how it is filed"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	{#each data.registrations as r (r.state)}
		{@const endpoint = `/api/settings/tax/${r.state}`}
		<section class="box" aria-labelledby="reg-{r.state}-h">
			<div class="box-h">
				<h2 class="box-t" id="reg-{r.state}-h">{stateName(r.state)}</h2>
				<button
					type="button"
					class="btn sm"
					onclick={() => stop(r.state)}
					{@attach busy(working === r.state && 'Stopping')}
					>{stopping === r.state ? 'Tap again to stop' : 'Stop collecting'}</button
				>
			</div>
			{#if stopping === r.state}
				<p class="box-row im warn" role="status">
					<Octicon name="alert" />Nothing billed in {stateName(r.state)} is taxed from then on. What was
					taxed there already keeps its tax.
				</p>
			{/if}
			<Detail
				name="held"
				label="Registration"
				value={r.held}
				placeholder="Seller's permit"
				{endpoint}
				validate={parseRegistrationField}
				onsaved={again}
			/>
			<Detail
				name="agency"
				label="Agency"
				value={r.agency}
				placeholder={AUTHORITY[r.state as State]?.short ?? 'Who the return goes to'}
				{endpoint}
				validate={parseRegistrationField}
				onsaved={again}
			/>
			<Detail
				name="filing_basis"
				label="Filed"
				value={r.filing_basis ?? ''}
				options={[
					{ value: '', label: 'Not set' },
					{ value: 'annual', label: 'Yearly' },
					{ value: 'quarterly', label: 'Quarterly' },
					{ value: 'monthly', label: 'Monthly' }
				]}
				{endpoint}
				validate={parseRegistrationField}
				onsaved={again}
			/>
			{#if r.state === 'CA'}
				<Detail
					name="claims_tax_paid_purchases_resold"
					label="Tax-paid purchases resold"
					value={r.claims_tax_paid_purchases_resold ? 'true' : 'false'}
					options={[
						{ value: 'true', label: 'Claimed: tax already paid comes off the measure' },
						{ value: 'false', label: 'Not claimed' }
					]}
					{endpoint}
					validate={parseRegistrationField}
					onsaved={again}
				>
					{#snippet caption()}An election, so it is recorded rather than worked out.{/snippet}
				</Detail>
			{/if}
		</section>
	{/each}

	{#if !data.registrations.length || open.length}
		<section class="box" aria-labelledby="collect-h">
			<div class="box-h">
				<h2 class="box-t" id="collect-h">
					{data.registrations.length ? 'Collect in another state' : 'Where it is collected'}
				</h2>
			</div>
			{#if !data.registrations.length}
				<p class="box-row none">Nowhere, so nothing is taxed.</p>
			{/if}
			{#if open.length}
				<form
					class="box-row add"
					onsubmit={(e) => {
						e.preventDefault();
						void collect();
					}}
				>
					<label class="fc-l" for="collect-in">State</label>
					<div class="pick">
						<select id="collect-in" class="ti" bind:value={adding}>
							{#each open as s (s)}<option value={s}>{stateName(s)}</option>{/each}
						</select>
						<button
							type="submit"
							class="btn"
							{@attach busy(working !== null && working === adding && 'Saving')}
							>Collect tax there</button
						>
					</div>
				</form>
			{/if}
		</section>
	{/if}
	{#if why}<p class="fc-e" role="alert"><Octicon name="alert" />{why}</p>{/if}

	<section class="box" aria-labelledby="year-h">
		<div class="box-h"><h2 class="box-t" id="year-h">Filing year</h2></div>
		<Detail
			name="fiscal_year_end_month"
			label="Year ends"
			value={o?.fiscal_year_end_month ? String(o.fiscal_year_end_month) : ''}
			options={[{ value: '', label: 'Not set' }, ...MONTHS]}
			shown={o?.fiscal_year_end_month
				? `The last day of ${MONTHS[o.fiscal_year_end_month - 1].label}`
				: 'Not set'}
			endpoint="/api/settings"
			validate={parseField}
			onsaved={again}
		/>
	</section>

	{#if data.registrations.some((r) => r.state === 'CA')}
		<p class="note">
			No rate is set here. Every California site’s rate is what CDTFA says for its address, asked as
			the site is made and kept in sync by the server.
		</p>
	{/if}
</div>

<style>
	.none {
		margin: 0;
		color: var(--fgColor-muted);
	}
	.add {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
	}
	.pick {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.pick select {
		flex: 1 1 12rem;
		min-width: 0;
	}
	/* Primer's inline message: an icon and a line, in the colour of what happened. */
	.im {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		font-size: 14px;
		line-height: 20px;
	}
	.im :global(svg) {
		margin-top: 2px;
	}
	.im.warn {
		color: var(--fgColor-attention);
	}
</style>
