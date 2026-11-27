<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import FilingPeriodField from '#lib/FilingPeriodField.svelte';
	import { forInput } from '#lib/currency.ts';
	import { periodKey } from '#lib/filing-periods.ts';
	import { parsePayment } from '#lib/tax-filing-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * A PAYMENT to a state, as its agency gave it back (#lib/tax-filing-fields):
	 * the period it is for -- its return's, or one under way, as a prepayment
	 * is -- the day, the tax, and apart from it any penalty and interest.
	 */
	let { data }: PageProps = $props();
	const back = resolve('/reports/sales-tax');
	const where = $derived(stateName(data.state));
	const agency = $derived(data.agency ?? where);

	let start = $state(untrack(() => data.start?.start ?? ''));
	let end = $state(untrack(() => data.start?.end ?? ''));
	let paidOn = $state(untrack(() => data.today));
	let tax = $state(
		untrack(() => (data.start && Number(data.start.owing) > 0 ? forInput(data.start.owing) : ''))
	);
	let more = $state('');
	let reference = $state('');
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	const chosen = $derived(data.periods.find((p) => periodKey(p) === periodKey({ start, end })));

	async function record() {
		const fields = {
			period_start: start,
			period_end: end,
			paid_on: paidOn,
			tax,
			penalty_and_interest: more,
			reference
		};
		errors = parsePayment(fields).errors;
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`/api/sales-tax/${data.state}/payments`, {
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

<Top title="New payment" sub={where} {back} backLabel="Sales tax" />

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
			<p class="fc-c">From {agency}’s confirmation, once it was paid.</p>
			<FilingPeriodField id="p" periods={data.periods} bind:start bind:end {errors}>
				{#snippet caption()}
					{#if chosen && chosen.owing !== null}
						{Number(chosen.owing) > 0
							? `Its return leaves ${money(chosen.owing)} owing.`
							: 'Its return is paid.'}
					{:else if chosen}
						No return filed for it yet: a prepayment, say.
					{/if}
				{/snippet}
			</FilingPeriodField>
			<div class="fc">
				<label class="fc-l" for="p-paid">Paid on<span aria-hidden="true"> *</span></label>
				<input
					id="p-paid"
					class="ti"
					type="date"
					bind:value={paidOn}
					aria-invalid={show('paid_on') ? 'true' : undefined}
					aria-describedby={show('paid_on') ? 'p-paid-e' : undefined}
				/>
				{#if show('paid_on')}
					<p class="fc-e" id="p-paid-e"><Octicon name="alert" />{show('paid_on')}</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="p-tax">Tax</label>
				<input
					id="p-tax"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					placeholder="0"
					bind:value={tax}
					aria-invalid={show('tax') ? 'true' : undefined}
					aria-describedby={show('tax') ? 'p-tax-e' : 'p-tax-c'}
				/>
				{#if show('tax')}
					<p class="fc-e" id="p-tax-e"><Octicon name="alert" />{show('tax')}</p>
				{:else}
					<p class="fc-c" id="p-tax-c">The tax handed over, without penalty or interest.</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="p-more">Penalty and interest</label>
				<input
					id="p-more"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					placeholder="0"
					bind:value={more}
					aria-invalid={show('penalty_and_interest') ? 'true' : undefined}
					aria-describedby={show('penalty_and_interest') ? 'p-more-e' : 'p-more-c'}
				/>
				{#if show('penalty_and_interest')}
					<p class="fc-e" id="p-more-e"><Octicon name="alert" />{show('penalty_and_interest')}</p>
				{:else}
					<p class="fc-c" id="p-more-c">
						Paid with it, for filing or paying late: the business’s own cost, not tax it collected.
					</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="p-ref">Confirmation</label>
				<input
					id="p-ref"
					class="ti"
					autocomplete="off"
					bind:value={reference}
					aria-invalid={show('reference') ? 'true' : undefined}
					aria-describedby={show('reference') ? 'p-ref-e' : 'p-ref-c'}
				/>
				{#if show('reference')}
					<p class="fc-e" id="p-ref-e"><Octicon name="alert" />{show('reference')}</p>
				{:else}
					<p class="fc-c" id="p-ref-c">{agency}’s number for it.</p>
				{/if}
			</div>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" {@attach busy(saving && 'Recording the payment')}
				>Record payment</button
			>
			<a class="btn" href={back}>Cancel</a>
			{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
		</div>
	</form>
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
