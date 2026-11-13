<script lang="ts">
	import { untrack } from 'svelte';
	import { readPrice } from '#lib/service-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { forInput } from '#lib/currency.ts';
	import Octicon from '#lib/Octicon.svelte';

	/**
	 * A price from a day: every client's, or one client's.
	 *
	 * It adds a row. The price in force is left as it was and moves to the
	 * service's history when this one starts, so what a job was worth before
	 * the change stays what it was worth.
	 *
	 * A Primer form in a dialog: each label above its field, what it means
	 * below; the dialog's button sends it (save).
	 */
	let {
		serviceId,
		unit,
		clients,
		today,
		preset = null,
		onsaved,
		onsaving
	}: {
		serviceId: string;
		unit: string;
		clients: { id: string; name: string }[];
		today: string;
		/** The price being changed, so its clients and figures start filled in. */
		preset?: { entity_id: string | null; rate: string; additional_rate: string } | null;
		onsaved: () => void;
		/** Told when it starts and stops being sent: the dialog's button says so. */
		onsaving?: (busy: boolean) => void;
	} = $props();

	const start = untrack(() => preset);
	let entity = $state<string | null>(start?.entity_id ?? null);
	let one = $state(Boolean(start?.entity_id));
	let rate = $state(forInput(start?.rate));
	let additional = $state(
		start && Number(start.additional_rate) > 0 ? forInput(start.additional_rate) : ''
	);
	let from = $state(untrack(() => today));
	let errors = $state<Record<string, string>>({});
	let saying = $state('');

	// Heads only change what a job costs when it is charged by the hour; a mile
	// or an entry is the same whoever is in the truck.
	const byTheHour = $derived(unit === 'hour');
	const per = $derived(unit === 'hour' ? 'an hour' : unit === 'mile' ? 'a mile' : 'each');

	/** Sent from the dialog it is in: its own button, not one of the form's. */
	let sending = false;
	export async function save() {
		if (sending) return;
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
		sending = true;
		onsaving?.(true);
		const r = await fetch(`/api/services/${serviceId}/prices`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		sending = false;
		onsaving?.(false);
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

{#snippet wrong(key: string)}
	{#if errors[key]}
		<p class="fc-e" id="p-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<div class="form">
	<fieldset class="fc">
		<legend class="fc-l">Clients</legend>
		<label class="rad">
			<input type="radio" name="p-who" value={false} bind:group={one} />
			<span><span class="rad-t">Every client</span></span>
		</label>
		<label class="rad">
			<input type="radio" name="p-who" value={true} bind:group={one} />
			<span><span class="rad-t">One client</span></span>
		</label>
	</fieldset>
	{#if one}
		<div class="fc">
			<label class="fc-l" for="p-client">Which client</label>
			<select
				id="p-client"
				class="ti"
				bind:value={entity}
				aria-invalid={errors.entity_id ? 'true' : undefined}
				aria-describedby={errors.entity_id ? 'p-entity_id-e' : undefined}
			>
				<option value={null}>Choose…</option>
				{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			{@render wrong('entity_id')}
		</div>
	{/if}

	<div class="fc">
		<label class="fc-l" for="p-rate">{byTheHour ? 'Rate, one person' : 'Rate'}</label>
		<span class="tv">
			<input
				id="p-rate"
				class="ti"
				inputmode="decimal"
				autocomplete="off"
				bind:value={rate}
				aria-invalid={errors.rate ? 'true' : undefined}
				aria-describedby={errors.rate ? 'p-rate-e' : undefined}
			/>
			<span class="tv-v" aria-hidden="true">{per}</span>
		</span>
		{@render wrong('rate')}
	</div>

	{#if byTheHour}
		<div class="fc">
			<label class="fc-l" for="p-more">Each additional person</label>
			<span class="tv">
				<input
					id="p-more"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={additional}
					aria-invalid={errors.additional_rate ? 'true' : undefined}
					aria-describedby={errors.additional_rate ? 'p-additional_rate-e' : 'p-more-c'}
				/>
				<span class="tv-v" aria-hidden="true">an hour</span>
			</span>
			{#if errors.additional_rate}
				{@render wrong('additional_rate')}
			{:else}
				<p class="fc-c" id="p-more-c">Empty charges the job the same however many work it.</p>
			{/if}
		</div>
	{/if}

	<div class="fc">
		<label class="fc-l" for="p-from">From</label>
		<input
			id="p-from"
			class="ti"
			type="date"
			bind:value={from}
			aria-invalid={errors.effective_from ? 'true' : undefined}
			aria-describedby={errors.effective_from ? 'p-effective_from-e' : 'p-from-c'}
		/>
		{#if errors.effective_from}
			{@render wrong('effective_from')}
		{:else}
			<p class="fc-c" id="p-from-c">
				Work from this day on is charged at it. An earlier day is allowed.
			</p>
		{/if}
	</div>

	{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.fc {
		max-width: 440px;
	}
	.tv {
		position: relative;
		display: block;
	}
	.tv .ti {
		padding-right: 72px;
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
</style>
