<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { KIND_FIELDS, parseAnswers } from '#lib/kind-fields.ts';
	import { parseAll } from '#lib/field-rules.ts';
	import { readJson, readProblem } from '#lib/json.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * A KIND OF SALE OF THE BUSINESS'S OWN: what it calls it, and whether each
	 * state it collects in taxes it, from that state's own rules -- none
	 * assumed. Made, it opens, to be given to the materials and services that
	 * are it.
	 */
	let { data }: PageProps = $props();
	const back = resolve('/settings/tax');

	let name = $state('');
	let answers = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	async function add() {
		const local = {
			...parseAll({ name: KIND_FIELDS.name }, { name }).errors,
			...parseAnswers(answers, data.states, (s) => `Whether ${stateName(s)} taxes it.`).errors
		};
		errors = local;
		saying = '';
		if (Object.keys(local).length) return;
		saving = true;
		const r = await fetch('/api/settings/tax/kinds', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { name }, taxed: answers })
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
		const made = (await readJson(r)) as { id: string };
		await goto(resolve('/settings/tax/kinds/[kind]', { kind: made.id }));
	}
	const show = (k: string) => errors[k] ?? '';
</script>

<Top title="New kind of sale" sub="Each state says whether it taxes it" {back} backLabel="Tax" />

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
			<div class="fc">
				<label class="fc-l" for="k-name">Name<span aria-hidden="true"> *</span></label>
				<input
					id="k-name"
					class="ti"
					autocomplete="off"
					required
					bind:value={name}
					aria-invalid={show('name') ? 'true' : undefined}
					aria-describedby={show('name') ? 'k-name-e' : 'k-name-c'}
				/>
				{#if show('name')}
					<p class="fc-e" id="k-name-e"><Octicon name="alert" />{show('name')}</p>
				{:else}
					<p class="fc-c" id="k-name-c">
						What it is, as a state might treat it apart: help desk, maintenance, consulting.
					</p>
				{/if}
			</div>
			{#if data.states.length}
				<fieldset class="answers">
					<legend class="fc-l">Taxed where the business collects</legend>
					<p class="fc-c">From each state’s own rules. Nothing is assumed.</p>
					{#each data.states as s (s)}
						{@const e = show(`taxed.${s}`)}
						<div class="fc">
							<label class="fc-l" for="k-{s}">{stateName(s)}</label>
							<select
								id="k-{s}"
								class="ti"
								bind:value={answers[s]}
								aria-invalid={e ? 'true' : undefined}
								aria-describedby={e ? `k-${s}-e` : undefined}
							>
								<option value="" disabled selected>Choose</option>
								<option value="true">Taxed</option>
								<option value="false">Not taxed</option>
							</select>
							{#if e}<p class="fc-e" id="k-{s}-e"><Octicon name="alert" />{e}</p>{/if}
						</div>
					{/each}
				</fieldset>
			{:else}
				<p class="fc-c">
					The business collects tax nowhere yet, so no state answers for it. Each one will, as it is
					collected in.
				</p>
			{/if}
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" {@attach busy(saving && 'Adding the kind')}
				>Add kind</button
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
	.answers {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	.answers .fc-c {
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
		margin: 0;
	}
</style>
