<script lang="ts">
	import { untrack } from 'svelte';
	import { readCoverage } from '#lib/agreement-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import Octicon from '#lib/Octicon.svelte';

	/**
	 * A service on an agreement and its allotment: no limit, or a number of
	 * hours each period and a rule for the hours after them. The hours belong to
	 * the agreement, whether that is one site's or the whole client's. All of it
	 * saves together.
	 *
	 * There is no default allotment, so the hours box starts empty. Drawn as a
	 * Primer form in the row it adds to, each choice a radio.
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

{#snippet wrong(key: string)}
	{#if errors[key]}
		<p class="fc-e" id="c-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<div class="box-row form">
	{#if was}
		<p class="which">{was.service}</p>
	{:else}
		<div class="fc">
			<label class="fc-l" for="c-service">Service</label>
			<select
				id="c-service"
				class="ti"
				bind:value={serviceId}
				aria-invalid={errors.service ? 'true' : undefined}
				aria-describedby={errors.service ? 'c-service-e' : undefined}
			>
				<option value={null}>Choose…</option>
				{#each services as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
			</select>
			{@render wrong('service')}
		</div>
	{/if}

	<fieldset class="fc">
		<legend class="fc-l">Included</legend>
		<label class="rad">
			<input type="radio" name="c-allotment" value="unlimited" bind:group={allotment} />
			<span><span class="rad-t">Unlimited</span></span>
		</label>
		<label class="rad">
			<input type="radio" name="c-allotment" value="capped" bind:group={allotment} />
			<span
				><span class="rad-t">Capped</span><span class="rad-c">So many hours a period.</span></span
			>
		</label>
		{@render wrong('allotment')}
	</fieldset>

	{#if allotment === 'capped'}
		<div class="fc">
			<label class="fc-l" for="c-hours">Hours</label>
			<span class="tv">
				<input
					id="c-hours"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={hours}
					aria-invalid={errors.included_hours ? 'true' : undefined}
					aria-describedby={errors.included_hours ? 'c-included_hours-e' : undefined}
				/>
				<span class="tv-v" aria-hidden="true">a period</span>
			</span>
			{@render wrong('included_hours')}
		</div>
		<fieldset class="fc">
			<legend class="fc-l">Past the cap</legend>
			<label class="rad">
				<input type="radio" name="c-overage" value="bill" bind:group={overage} />
				<span><span class="rad-t">Billed</span></span>
			</label>
			<label class="rad">
				<input type="radio" name="c-overage" value="no_charge" bind:group={overage} />
				<span><span class="rad-t">No charge</span></span>
			</label>
			<label class="rad">
				<input type="radio" name="c-overage" value="deny" bind:group={overage} />
				<span><span class="rad-t">Refused</span></span>
			</label>
			{@render wrong('overage')}
		</fieldset>
	{/if}

	<div class="keep">
		<button type="button" class="btn pri" onclick={save} disabled={saving}>
			{saving ? 'Saving…' : was ? 'Save' : 'Cover it'}
		</button>
		<button type="button" class="btn" onclick={oncancel}>Cancel</button>
		{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
	</div>
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
		background: var(--surface);
	}
	.which {
		margin: 0;
		font-weight: 600;
	}
	.fc {
		max-width: 440px;
	}
	.tv {
		position: relative;
		display: block;
	}
	.tv .ti {
		padding-right: 88px;
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
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
</style>
