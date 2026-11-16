<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { parseAll } from '#lib/field-rules.ts';
	import { VEHICLE_FIELDS } from '#lib/vehicle-fields.ts';
	import { vehicleWords } from '#lib/pay-words.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { busy } from '#lib/busy.svelte.ts';
	/**
	 * A vehicle, added: what it is called, and whose it is, which decides who
	 * its miles pay, not who drives it, and never changes.
	 */
	let { data }: PageProps = $props();

	let name = $state('');
	// Whoever is adding it, as most vehicles are somebody's own; null is the business's.
	let owner = $state<string | null>(
		untrack(() => (data.people.some((p) => p.id === data.me) ? data.me : null))
	);
	let saving = $state(false);
	let problem = $state('');
	/** Who each choice of owner its miles pay, said under it. */
	const pays = (id: string | null, name: string | null) =>
		vehicleWords(name, id ? (data.terms[id] ?? []) : [], { money, unitPrice });
	const back = resolve('/settings/vehicles');

	async function add() {
		const fields = { name, owner_id: owner ?? '' };
		const local = parseAll(VEHICLE_FIELDS, fields).errors;
		problem = local.name ?? local.owner_id ?? '';
		if (problem) return;
		saving = true;
		const r = await fetch('/api/vehicles', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		saving = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			problem = p
				? (p.errors?.name ?? p.errors?.owner_id ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		await goto(back);
	}
</script>

<Top title="Add vehicle" {back} backLabel="Vehicles" />

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
				<label class="fc-l" for="v-name">Name<span aria-hidden="true"> *</span></label>
				<input
					id="v-name"
					class="ti"
					autocomplete="off"
					required
					placeholder="What you call it"
					bind:value={name}
				/>
			</div>
			<fieldset class="fc">
				<legend class="fc-l">Whose</legend>
				{#each data.people as p (p.id)}
					<label class="rad">
						<input type="radio" name="owner" value={p.id} bind:group={owner} />
						<span>
							<span class="rad-t">{p.name}’s</span>
							<span class="rad-c">{pays(p.id, p.name)}</span>
						</span>
					</label>
				{/each}
				<label class="rad">
					<input type="radio" name="owner" value={null} bind:group={owner} />
					<span>
						<span class="rad-t">The business’s</span>
						<span class="rad-c">{pays(null, null)}</span>
					</span>
				</label>
				<p class="fc-c">It never changes: one that changes hands is retired and added again.</p>
			</fieldset>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" {@attach busy(saving && 'Adding the vehicle')}
				>Add vehicle</button
			>
			<a class="btn" href={back}>Cancel</a>
			{#if problem}<p class="fc-e"><Octicon name="alert" />{problem}</p>{/if}
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
