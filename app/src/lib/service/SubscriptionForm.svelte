<script lang="ts">
	import { untrack } from 'svelte';
	import { readSubscription } from '$lib/service-fields';
	import { readProblem } from '$lib/json';

	/**
	 * How a service is sold on subscription: not at all, capped, or unlimited.
	 *
	 * The four terms save together because they are one decision -- a cap is
	 * its hours, its period and what happens past it, or it is not a cap. These
	 * are what an agreement starts from when it covers this service; an
	 * agreement already made keeps its own.
	 */
	let {
		serviceId,
		terms,
		onsaved
	}: {
		serviceId: string;
		terms: {
			basis: string;
			hours: string | null;
			period: string | null;
			overage: string | null;
		};
		onsaved: () => void;
	} = $props();

	// What the row holds, in the form's own terms, so an unchanged form offers
	// nothing to save. Moved on each save, because after one the row holds this.
	const held = (t: typeof terms) => ({
		basis: t.basis,
		hours: t.hours ? String(Number(t.hours)) : '',
		period: t.period ?? 'month',
		overage: t.overage ?? 'bill'
	});
	const first = untrack(() => held(terms));
	let was = $state(first);
	let basis = $state(first.basis);
	let hours = $state(first.hours);
	let period = $state(first.period);
	let overage = $state(first.overage);
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let status = $state<'idle' | 'saving' | 'ok'>('idle');

	const changed = $derived(
		basis !== was.basis ||
			(basis === 'capped' &&
				(hours !== was.hours || period !== was.period || overage !== was.overage))
	);

	async function save() {
		const fields = {
			subscription_basis: basis,
			subscription_hours: basis === 'capped' ? hours : '',
			subscription_period: basis === 'capped' ? period : '',
			subscription_overage: basis === 'capped' ? overage : ''
		};
		errors = readSubscription(fields).errors;
		saying = '';
		if (Object.keys(errors).length) return;
		status = 'saving';
		const r = await fetch(`/api/services/${serviceId}/subscription`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		if (!r) {
			status = 'idle';
			saying = 'Not saved — no connection.';
			return;
		}
		if (!r.ok) {
			status = 'idle';
			const b = await readProblem(r);
			errors = b.errors ?? {};
			saying = Object.keys(errors).length ? '' : (b.detail ?? b.title ?? 'That did not save.');
			return;
		}
		status = 'ok';
		was = { basis, hours, period, overage };
		onsaved();
	}
</script>

<div class="fld">
	<span class="lbl">Sold as a subscription</span>
	<div class="seg">
		<button type="button" class:on={basis === 'none'} onclick={() => (basis = 'none')}>No</button>
		<button type="button" class:on={basis === 'capped'} onclick={() => (basis = 'capped')}
			>Capped</button
		>
		<button type="button" class:on={basis === 'unlimited'} onclick={() => (basis = 'unlimited')}
			>Unlimited</button
		>
	</div>
</div>

{#if basis === 'capped'}
	<div class="fld">
		<label for="s-hours">Included</label>
		<span class="inp-wrap">
			<input id="s-hours" class="inp" inputmode="decimal" placeholder="2" bind:value={hours} />
			<span class="hint">hours</span>
		</span>
		{#if errors.subscription_hours}<small class="why">{errors.subscription_hours}</small>{/if}
	</div>
	<div class="fld">
		<label for="s-period">Every</label>
		<select id="s-period" class="inp" bind:value={period}>
			<option value="week">Week</option>
			<option value="month">Month</option>
			<option value="quarter">Quarter</option>
			<option value="year">Year</option>
		</select>
	</div>
	<div class="fld">
		<span class="lbl">Past the cap</span>
		<div class="seg">
			<button type="button" class:on={overage === 'bill'} onclick={() => (overage = 'bill')}
				>Billed</button
			>
			<button
				type="button"
				class:on={overage === 'no_charge'}
				onclick={() => (overage = 'no_charge')}>No charge</button
			>
			<button type="button" class:on={overage === 'deny'} onclick={() => (overage = 'deny')}
				>Refused</button
			>
		</div>
	</div>
{/if}

{#if saying}<p class="why">{saying}</p>{/if}
{#if changed || status !== 'idle'}
	<button type="button" class="btn pri" onclick={save} disabled={status === 'saving' || !changed}>
		{status === 'saving' ? 'Saving…' : status === 'ok' && !changed ? 'Saved' : 'Save subscription'}
	</button>
{/if}
<small class="note">
	What an agreement starts from when it covers this service. An agreement already made keeps its own
	terms.
</small>

<style>
	.lbl {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	.inp-wrap {
		position: relative;
		display: block;
	}
	.inp-wrap .hint {
		position: absolute;
		right: 14px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		color: var(--ink-3);
		font-family: var(--f-mono);
		pointer-events: none;
	}
	.note {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.why {
		color: var(--crit);
		margin: 0;
		font-size: 12.5px;
	}
</style>
