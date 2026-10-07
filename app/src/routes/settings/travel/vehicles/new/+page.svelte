<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { parseAll } from '#lib/field-rules.ts';
	import { VEHICLE_FIELDS } from '#lib/vehicle-fields.ts';
	import { vehicleWords } from '#lib/pay-words.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	let { data }: PageProps = $props();

	let name = $state('');
	// Whoever is adding it, as most vehicles are somebody's own; null is the business's.
	let owner = $state<string | null>(
		untrack(() => (data.people.some((p) => p.id === data.me) ? data.me : null))
	);
	let saving = $state(false);
	let problem = $state('');
	const ownerName = $derived(data.people.find((p) => p.id === owner)?.name ?? null);
	const pays = $derived(
		vehicleWords(ownerName, owner ? (data.terms[owner] ?? []) : [], { money, unitPrice })
	);

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
		await goto(resolve('/settings/travel'));
	}
</script>

<Top
	title="Add a vehicle"
	sub="Its owner is who its miles pay"
	back={resolve('/settings/travel')}
	backLabel="Travel"
/>

<div class="pad">
	<div class="rows form">
		<div class="fld">
			<label for="v-name">Name</label>
			<input
				id="v-name"
				class="inp"
				placeholder="What you call it"
				bind:value={name}
				onkeydown={(e) => e.key === 'Enter' && add()}
			/>
		</div>

		<div class="fld">
			<span class="lbl">Whose</span>
			<div class="seg">
				{#each data.people as p (p.id)}
					<button
						type="button"
						class:on={owner === p.id}
						aria-pressed={owner === p.id}
						onclick={() => (owner = p.id)}>{p.name.split(' ')[0]}</button
					>
				{/each}
				<button
					type="button"
					class:on={owner === null}
					aria-pressed={owner === null}
					onclick={() => (owner = null)}>The business</button
				>
			</div>
			<small class="lt">{pays}</small>
		</div>

		<button class="btn pri blk" type="button" onclick={add} disabled={saving || !name.trim()}
			>Add the vehicle</button
		>
		{#if problem}<p class="why bad">{problem}</p>{/if}

		<p class="aside">
			Whose it is decides who its miles pay, not who drives it, and it never changes: one that
			changes hands is retired and added again.
		</p>
	</div>
</div>

<style>
	.form {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 15px;
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	.why {
		margin: 0;
	}
	.why.bad {
		color: var(--crit);
	}
	.aside {
		margin: 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
