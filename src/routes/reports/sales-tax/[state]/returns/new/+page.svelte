<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import FilingPeriodField from '#lib/FilingPeriodField.svelte';
	import { Decimal } from '#lib/decimal.ts';
	import { currencyPlaces } from '#lib/currency.ts';
	import { dated } from '#lib/format.ts';
	import { periodKey } from '#lib/filing-periods.ts';
	import { keptAs, parseReturn } from '#lib/tax-filing-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * A RETURN FILED with a state, as its agency gave it back
	 * (#lib/tax-filing-fields): the period, the day, what it says the period
	 * owes, what it kept for filing on time, and what was paid with it -- a
	 * payment of its own, on the day. One for a period filed already is its
	 * amended return.
	 */
	let { data }: PageProps = $props();
	const back = resolve('/reports/sales-tax');
	const where = $derived(stateName(data.state));
	const agency = $derived(data.agency ?? where);

	let start = $state(untrack(() => data.start?.start ?? ''));
	let end = $state(untrack(() => data.start?.end ?? ''));
	let filedOn = $state(untrack(() => data.today));
	let tax = $state('');
	let kept = $state('');
	let paid = $state('');
	let paidTyped = $state(false);
	let reference = $state('');
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	const chosen = $derived(data.periods.find((p) => periodKey(p) === periodKey({ start, end })));
	// What is left to pay on it, as typed so far, after what was paid for it
	// already: what "paid with it" starts from until somebody types there.
	const left = $derived.by(() => {
		try {
			const owed = Decimal.from(tax || '0')
				.sub(kept || '0')
				.sub(chosen?.paid ?? '0');
			return owed.gt('0') ? owed.toFixed(currencyPlaces()) : '0';
		} catch {
			return '';
		}
	});
	$effect(() => {
		if (!paidTyped) paid = left === '0' ? '' : left;
	});

	async function record() {
		const fields = {
			period_start: start,
			period_end: end,
			filed_on: filedOn,
			tax,
			kept,
			paid,
			reference
		};
		errors = parseReturn(fields).errors;
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`/api/sales-tax/${data.state}/returns`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(fields)
		}).catch(() => null);
		saving = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			errors = p?.errors ?? {};
			saying = !p
				? 'Not saved — no connection.'
				: Object.keys(errors).length
					? ''
					: (p.detail ?? 'That did not save.');
			return;
		}
		await goto(back);
	}
	const show = (k: string) => errors[k] ?? '';
</script>

<Top title="New return" sub={where} {back} backLabel="Sales tax" />

<div class="pad">
	<form
		class="box"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			void record();
		}}
	>
		<div class="box-row form">
			<p class="fc-c">From {agency}’s confirmation, once it was filed.</p>
			<FilingPeriodField id="r" periods={data.periods} bind:start bind:end {errors}>
				{#snippet caption()}
					{#if chosen?.filedOn}
						Filed already, {dated(chosen.filedOn)}: this is its amended return, and stands in its
						place.
					{:else if chosen}
						Collected for it: {money(chosen.collected)}{#if Number(chosen.credit) > 0}, less {money(
								chosen.credit
							)} already paid on goods resold{/if}.
					{/if}
				{/snippet}
			</FilingPeriodField>
			<div class="fc">
				<label class="fc-l" for="r-filed">Filed on<span aria-hidden="true"> *</span></label>
				<input
					id="r-filed"
					class="ti"
					type="date"
					bind:value={filedOn}
					aria-invalid={show('filed_on') ? 'true' : undefined}
					aria-describedby={show('filed_on') ? 'r-filed-e' : undefined}
				/>
				{#if show('filed_on')}
					<p class="fc-e" id="r-filed-e"><Octicon name="alert" />{show('filed_on')}</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="r-tax">Tax on the return<span aria-hidden="true"> *</span></label>
				<input
					id="r-tax"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={tax}
					aria-invalid={show('tax') ? 'true' : undefined}
					aria-describedby={show('tax') ? 'r-tax-e' : 'r-tax-c'}
				/>
				{#if show('tax')}
					<p class="fc-e" id="r-tax-e"><Octicon name="alert" />{show('tax')}</p>
				{:else}
					<p class="fc-c" id="r-tax-c">
						What it says the period owes, before prepayments, penalty and interest{data.state ===
						'CA'
							? ': line 21, Net tax'
							: ''}.
					</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="r-kept">Kept for filing on time</label>
				<input
					id="r-kept"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					placeholder="0"
					bind:value={kept}
					aria-invalid={show('kept') ? 'true' : undefined}
					aria-describedby={show('kept') ? 'r-kept-e' : 'r-kept-c'}
				/>
				{#if show('kept')}
					<p class="fc-e" id="r-kept-e"><Octicon name="alert" />{show('kept')}</p>
				{:else}
					<p class="fc-c" id="r-kept-c">{keptAs(data.state)}</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="r-paid">Paid with it</label>
				<input
					id="r-paid"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					placeholder="0"
					bind:value={paid}
					oninput={() => (paidTyped = true)}
					aria-invalid={show('paid') ? 'true' : undefined}
					aria-describedby={show('paid') ? 'r-paid-e' : 'r-paid-c'}
				/>
				{#if show('paid')}
					<p class="fc-e" id="r-paid-e"><Octicon name="alert" />{show('paid')}</p>
				{:else}
					<p class="fc-c" id="r-paid-c">
						The tax paid on the day it was filed{chosen && Number(chosen.paid) > 0
							? `, after the ${money(chosen.paid)} paid for it already`
							: ''}. Empty where it is paid later.
					</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="r-ref">Confirmation</label>
				<input
					id="r-ref"
					class="ti"
					autocomplete="off"
					bind:value={reference}
					aria-invalid={show('reference') ? 'true' : undefined}
					aria-describedby={show('reference') ? 'r-ref-e' : 'r-ref-c'}
				/>
				{#if show('reference')}
					<p class="fc-e" id="r-ref-e"><Octicon name="alert" />{show('reference')}</p>
				{:else}
					<p class="fc-c" id="r-ref-c">{agency}’s number for it.</p>
				{/if}
			</div>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" {@attach busy(saving && 'Recording the return')}
				>Record return</button
			>
			<a class="btn" href={back}>Cancel</a>
			{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
		</div>
	</form>

	<p class="note">
		What was paid with it is a payment of its own, so one paid later, or in parts, is recorded as it
		was. Tax collected beyond what the return says stays held: it goes to {where}, or back to
		whoever it was collected from.
	</p>
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fc {
		max-width: 440px;
	}
	.form > .fc-c {
		margin: 0;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--bgColor-muted);
	}
	.keep .fc-e {
		flex: 1 0 100%;
	}
</style>
