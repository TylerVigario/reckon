<script lang="ts">
	import { untrack } from 'svelte';
	import { readCoverage } from '#lib/agreement-fields.ts';
	import { readProblem } from '#lib/json.ts';

	/**
	 * A service on an agreement and its allotment: no limit, or a number of
	 * hours each period and a rule for the hours after them. The hours belong to
	 * the agreement, whether that is one site's or the whole client's. All of it
	 * saves together.
	 *
	 * There is no default allotment, so the hours box starts empty.
	 */
	let {
		agreementId,
		services,
		preset = null,
		onsaved,
		oncancel
	}: {
		agreementId: string;
		/** What can be chosen. A change keeps its service; a new one picks. */
		services: { id: string; name: string }[];
		preset?: {
			service_id: string;
			service: string;
			allotment: string;
			included_hours: string | null;
			overage: string | null;
		} | null;
		onsaved: () => void;
		oncancel: () => void;
	} = $props();

	const was = untrack(() => preset);
	let serviceId = $state<string | null>(was?.service_id ?? null);
	let allotment = $state(was?.allotment ?? '');
	let hours = $state(was?.included_hours ? String(Number(was.included_hours)) : '');
	let overage = $state(was?.overage ?? '');
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	async function save() {
		const fields = {
			allotment,
			included_hours: allotment === 'capped' ? hours : '',
			overage: allotment === 'capped' ? overage : ''
		};
		errors = readCoverage(fields).errors;
		if (!allotment) errors = { ...errors, allotment: 'Unlimited, or capped?' };
		if (allotment === 'capped' && !overage)
			errors = { ...errors, overage: 'What happens past the hours?' };
		if (!serviceId) errors = { ...errors, service: 'Which service.' };
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`/api/agreements/${agreementId}/coverage/${serviceId}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		saving = false;
		if (!r) {
			saying = 'Not saved — no connection.';
			return;
		}
		if (!r.ok) {
			const b = await readProblem(r);
			errors = b.errors ?? {};
			saying = Object.keys(errors).length ? '' : (b.detail ?? b.title ?? 'That did not save.');
			return;
		}
		onsaved();
	}
</script>

<div class="form">
	{#if was}
		<p class="which">{was.service}</p>
	{:else}
		<div class="fld">
			<label for="c-service">Service</label>
			<select id="c-service" class="inp" bind:value={serviceId}>
				<option value={null}>Choose…</option>
				{#each services as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
			</select>
			{#if errors.service}<small class="why">{errors.service}</small>{/if}
		</div>
	{/if}

	<div class="fld">
		<span class="lbl">Included</span>
		<div class="seg">
			<button
				type="button"
				class:on={allotment === 'unlimited'}
				onclick={() => (allotment = 'unlimited')}>Unlimited</button
			>
			<button type="button" class:on={allotment === 'capped'} onclick={() => (allotment = 'capped')}
				>Capped</button
			>
		</div>
		{#if errors.allotment}<small class="why">{errors.allotment}</small>{/if}
	</div>

	{#if allotment === 'capped'}
		<div class="fld">
			<label for="c-hours">Hours</label>
			<span class="inp-wrap">
				<input id="c-hours" class="inp" inputmode="decimal" bind:value={hours} />
				<span class="hint">a period</span>
			</span>
			{#if errors.included_hours}<small class="why">{errors.included_hours}</small>{/if}
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
			{#if errors.overage}<small class="why">{errors.overage}</small>{/if}
		</div>
	{/if}

	{#if saying}<p class="why">{saying}</p>{/if}

	<div class="btnrow">
		<button type="button" class="btn" onclick={oncancel}>Cancel</button>
		<button type="button" class="btn pri" onclick={save} disabled={saving}>
			{saving ? 'Saving…' : was ? 'Save' : 'Cover it'}
		</button>
	</div>
</div>

<style>
	.form {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		border-top: 1px solid var(--line-soft);
	}
	.which {
		margin: 0;
		font-weight: 600;
	}
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
	.fld small {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.why,
	.fld small.why {
		color: var(--crit);
		margin: 0;
	}
</style>
