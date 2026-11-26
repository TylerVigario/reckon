<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { explainedAs, parseExemption, REASONS, supportedAs } from '#lib/exemption-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * A CLIENT'S EXEMPTION, as the certificate gives it (#lib/exemption-fields):
	 * the state it is claimed in, why, what supports it, and the kinds of sale
	 * it covers -- every kind, or those the certificate describes. Added, their
	 * lines on drafts in that state that it covers are untaxed, and Details shows
	 * it.
	 */
	let { data }: PageProps = $props();
	const details = $derived(resolve('/clients/[id]/details', { id: data.client.slug }));

	let claimed = $state(untrack(() => data.start));
	let reason = $state('');
	let explanation = $state('');
	let supported = $state('');
	let every = $state<'every' | 'some'>('every');
	let kinds = $state<string[]>([]);
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	function toggle(id: string) {
		kinds = kinds.includes(id) ? kinds.filter((k) => k !== id) : [...kinds, id];
	}

	async function add() {
		const fields = { state: claimed, reason, explanation, supported_by: supported };
		const covers = every === 'every' ? null : kinds;
		errors = parseExemption(fields, covers).errors;
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`/api/clients/${data.client.slug}/exemptions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields, kinds: covers })
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
		await goto(details);
	}
	const show = (k: string) => errors[k] ?? '';
</script>

<Top title="New exemption" sub={data.client.name} back={details} backLabel="Details" />

<div class="pad">
	<form
		class="box"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			void add();
		}}
	>
		<div class="box-row form">
			<p class="fc-c">As the certificate gives it. Each state’s is an exemption of its own.</p>
			<div class="fc">
				<label class="fc-l" for="x-state">State<span aria-hidden="true"> *</span></label>
				<select
					id="x-state"
					class="ti"
					bind:value={claimed}
					aria-invalid={show('state') ? 'true' : undefined}
					aria-describedby={show('state') ? 'x-state-e' : 'x-state-c'}
				>
					{#each data.states as s (s)}<option value={s}>{stateName(s)}</option>{/each}
				</select>
				{#if show('state')}
					<p class="fc-e" id="x-state-e"><Octicon name="alert" />{show('state')}</p>
				{:else}
					<p class="fc-c" id="x-state-c">
						Where it is claimed, of the states the business collects in.
					</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="x-reason">Why<span aria-hidden="true"> *</span></label>
				<select
					id="x-reason"
					class="ti"
					bind:value={reason}
					aria-invalid={show('reason') ? 'true' : undefined}
					aria-describedby={show('reason') ? 'x-reason-e' : undefined}
				>
					<option value="" disabled>Choose</option>
					{#each REASONS as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
				</select>
				{#if show('reason')}
					<p class="fc-e" id="x-reason-e"><Octicon name="alert" />{show('reason')}</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="x-explanation"
					>Explained{#if reason === 'other'}<span aria-hidden="true"> *</span>{/if}</label
				>
				<input
					id="x-explanation"
					class="ti"
					autocomplete="off"
					required={reason === 'other'}
					bind:value={explanation}
					aria-invalid={show('explanation') ? 'true' : undefined}
					aria-describedby={show('explanation') ? 'x-explanation-e' : 'x-explanation-c'}
				/>
				{#if show('explanation')}
					<p class="fc-e" id="x-explanation-e"><Octicon name="alert" />{show('explanation')}</p>
				{:else}
					<p class="fc-c" id="x-explanation-c">{explainedAs(reason)}</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="x-supported">Certificate<span aria-hidden="true"> *</span></label>
				<input
					id="x-supported"
					class="ti"
					autocomplete="off"
					required
					bind:value={supported}
					aria-invalid={show('supported_by') ? 'true' : undefined}
					aria-describedby={show('supported_by') ? 'x-supported-e' : 'x-supported-c'}
				/>
				{#if show('supported_by')}
					<p class="fc-e" id="x-supported-e"><Octicon name="alert" />{show('supported_by')}</p>
				{:else}
					<p class="fc-c" id="x-supported-c">{supportedAs(reason)}</p>
				{/if}
			</div>
			<fieldset class="fc covers">
				<legend class="fc-l">What it covers</legend>
				<label class="rad">
					<input type="radio" name="covers" value="every" bind:group={every} />
					<span>
						<span class="rad-t">Every kind of sale</span>
						<span class="rad-c">As a government’s or a charity’s does: whatever they buy.</span>
					</span>
				</label>
				<label class="rad">
					<input type="radio" name="covers" value="some" bind:group={every} />
					<span>
						<span class="rad-t">The kinds it describes</span>
						<span class="rad-c"
							>As a resale certificate covers the goods resold, and not the work.</span
						>
					</span>
				</label>
				{#if every === 'some'}
					<div class="kinds" role="group" aria-label="The kinds it covers">
						{#each data.kinds as k (k.id)}
							<label class="rad">
								<input
									type="checkbox"
									checked={kinds.includes(k.id)}
									onchange={() => toggle(k.id)}
								/>
								<span class="rad-t"
									>{k.name}{#if !k.active}<span class="rad-c"> · retired</span>{/if}</span
								>
							</label>
						{/each}
					</div>
				{/if}
				{#if show('kinds')}<p class="fc-e"><Octicon name="alert" />{show('kinds')}</p>{/if}
			</fieldset>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" {@attach busy(saving && 'Adding the exemption')}
				>Add exemption</button
			>
			<a class="btn" href={details}>Cancel</a>
			{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
		</div>
	</form>

	<p class="note">
		In force until it is ended. Their lines on drafts in {stateName(claimed)} that it covers are untaxed
		when it is added; an invoice that has gone out keeps what it was billed.
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
	.covers {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	.kinds {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-left: 24px;
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
