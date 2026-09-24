<script lang="ts">
	import { untrack } from 'svelte';
	import { readPrice } from '$lib/service-fields';
	import { readProblem } from '$lib/json';

	/**
	 * A price from a day: every client's, or one client's.
	 *
	 * It adds a row. The price in force is left as it was and moves to the
	 * service's history when this one starts, so what a job was worth before
	 * the change stays what it was worth.
	 */
	let {
		serviceId,
		unit,
		clients,
		today,
		preset = null,
		onsaved,
		oncancel
	}: {
		serviceId: string;
		unit: string;
		clients: { id: string; name: string }[];
		today: string;
		/** The price being changed, so its clients and figures start filled in. */
		preset?: { entity_id: string | null; rate: string; additional_rate: string } | null;
		onsaved: () => void;
		oncancel: () => void;
	} = $props();

	const start = untrack(() => preset);
	let entity = $state<string | null>(start?.entity_id ?? null);
	let one = $state(Boolean(start?.entity_id));
	let rate = $state(start?.rate ?? '');
	let additional = $state(start && Number(start.additional_rate) > 0 ? start.additional_rate : '');
	let from = $state(untrack(() => today));
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	// Heads only change what a job costs when it is charged by the hour; a mile
	// or an entry is the same whoever is in the truck.
	const byTheHour = $derived(unit === 'hour');
	const per = $derived(unit === 'hour' ? 'an hour' : unit === 'mile' ? 'a mile' : 'each');

	async function save() {
		const fields = {
			entity_id: one ? (entity ?? '') : '',
			rate,
			additional_rate: byTheHour ? additional : '',
			effective_from: from
		};
		const local = readPrice(fields);
		if (one && !entity) local.errors.entity_id = 'Which client.';
		errors = local.errors;
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`/api/services/${serviceId}/prices`, {
			method: 'POST',
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
	<div class="fld">
		<span class="lbl">Clients</span>
		<div class="seg">
			<button type="button" class:on={!one} onclick={() => (one = false)}>Every client</button>
			<button type="button" class:on={one} onclick={() => (one = true)}>One client</button>
		</div>
	</div>
	{#if one}
		<div class="fld">
			<label for="p-client">Which client</label>
			<select id="p-client" class="inp" bind:value={entity}>
				<option value={null}>Choose…</option>
				{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			{#if errors.entity_id}<small class="why">{errors.entity_id}</small>{/if}
		</div>
	{/if}

	<div class="fld">
		<label for="p-rate">{byTheHour ? 'Rate — one person' : 'Rate'}</label>
		<span class="inp-wrap">
			<input id="p-rate" class="inp" inputmode="decimal" placeholder="80.00" bind:value={rate} />
			<span class="hint">{per}</span>
		</span>
		{#if errors.rate}<small class="why">{errors.rate}</small>{/if}
	</div>

	{#if byTheHour}
		<div class="fld">
			<label for="p-more">Each additional person</label>
			<span class="inp-wrap">
				<input
					id="p-more"
					class="inp"
					inputmode="decimal"
					placeholder="nothing extra"
					bind:value={additional}
				/>
				<span class="hint">an hour</span>
			</span>
			{#if errors.additional_rate}<small class="why">{errors.additional_rate}</small>
			{:else}<small>Empty charges the job the same however many work it.</small>{/if}
		</div>
	{/if}

	<div class="fld">
		<label for="p-from">From</label>
		<input id="p-from" class="inp" type="date" bind:value={from} />
		{#if errors.effective_from}<small class="why">{errors.effective_from}</small>
		{:else}<small>Work from this day on is charged at it. An earlier day is allowed.</small>{/if}
	</div>

	{#if saying}<p class="why">{saying}</p>{/if}

	<div class="btnrow">
		<button type="button" class="btn" onclick={oncancel}>Cancel</button>
		<button type="button" class="btn pri" onclick={save} disabled={saving}>
			{saving ? 'Saving…' : 'Save price'}
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
	.why {
		color: var(--crit);
		margin: 0;
	}
	.fld small.why {
		color: var(--crit);
	}
</style>
