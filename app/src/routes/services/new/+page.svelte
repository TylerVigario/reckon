<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { NEW_SERVICE_FIELDS } from '$lib/service-fields';
	import { parseAll } from '$lib/field-rules';
	import { readJson, readProblem } from '$lib/json';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * A new service: what it is called, and what it is charged per. Everything
	 * else -- its price, whom it pays, whether it is sold on subscription -- is
	 * set on its own screen, which is where this goes next.
	 */
	let name = $state('');
	let unit = $state('hour');
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	const UNITS = [
		{ v: 'hour', l: 'Hour' },
		{ v: 'mile', l: 'Mile' },
		{ v: 'each', l: 'Each' }
	];

	async function create() {
		const fields = { name, unit };
		errors = parseAll(NEW_SERVICE_FIELDS, fields).errors;
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch('/api/services', {
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
		const made = (await readJson(r)) as { id?: string };
		if (!made.id) {
			saying = 'Saved, but the server did not say where it went.';
			return;
		}
		await goto(resolve('/services/[id]', { id: made.id }));
	}
</script>

<Top
	title="New service"
	sub="Priced on the next screen"
	back={resolve('/services')}
	backLabel="Services"
/>

<div class="pad">
	<div class="sec">
		<div class="rows inset">
			<div class="fld">
				<label for="n-name">Name</label>
				<input id="n-name" class="inp" placeholder="On-site work" bind:value={name} />
				{#if errors.name}<small class="why">{errors.name}</small>{/if}
			</div>
			<div class="fld">
				<span class="lbl">Charged per</span>
				<div class="seg">
					{#each UNITS as u (u.v)}
						<button type="button" class:on={unit === u.v} onclick={() => (unit = u.v)}>{u.l}</button
						>
					{/each}
				</div>
				<small>
					{unit === 'hour'
						? 'Timed, and billed to the minute unless you say otherwise.'
						: unit === 'mile'
							? 'Charged by the distance a trip assigns it.'
							: 'A flat rate: the same charge for each entry, however long it took.'}
				</small>
			</div>
			{#if saying}<p class="why">{saying}</p>{/if}
			<button type="button" class="btn pri blk" onclick={create} disabled={saving}>
				{saving ? 'Creating…' : 'Create and price it'}
			</button>
		</div>
	</div>
</div>

<style>
	.lbl {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	small {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.why {
		color: var(--crit);
		margin: 0;
	}
</style>
