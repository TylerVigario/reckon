<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { NEW_SERVICE_FIELDS } from '#lib/service-fields.ts';
	import { parseAll } from '#lib/field-rules.ts';
	import { readJson, readProblem } from '#lib/json.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * A new service: what it is called, and what it is charged per. Everything
	 * else -- its price, and whom it pays -- is set on its own screen, which is
	 * where this goes next.
	 */
	let name = $state('');
	let unit = $state('hour');
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	const UNITS = [
		{ v: 'hour', l: 'Hour', c: 'Timed, and billed to the minute unless you say otherwise.' },
		{ v: 'mile', l: 'Mile', c: 'Charged by the distance a trip assigns it.' },
		{
			v: 'each',
			l: 'Each',
			c: 'A flat rate: the same charge for each entry, however long it took.'
		}
	];

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (saving) return;
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
		await goto(resolve('/catalogue/services/[id]', { id: made.id }));
	}
</script>

<Top
	title="New service"
	sub="Priced on the next screen"
	back={resolve('/catalogue/services')}
	backLabel="Services"
/>

<div class="pad primer">
	<form class="box" onsubmit={create} novalidate>
		<div class="box-row form">
			<div class="fc">
				<label class="fc-l" for="n-name">Name<span aria-hidden="true"> *</span></label>
				<input
					id="n-name"
					class="ti"
					autocomplete="off"
					bind:value={name}
					aria-invalid={errors.name ? 'true' : undefined}
					aria-describedby={errors.name ? 'n-name-e' : undefined}
				/>
				{#if errors.name}<p class="fc-e" id="n-name-e">
						<Octicon name="alert" />{errors.name}
					</p>{/if}
			</div>
			<fieldset class="fc">
				<legend class="fc-l">Charged per</legend>
				{#each UNITS as u (u.v)}
					<label class="rad">
						<input type="radio" name="unit" value={u.v} bind:group={unit} />
						<span><span class="rad-t">{u.l}</span><span class="rad-c">{u.c}</span></span>
					</label>
				{/each}
				{#if errors.unit}<p class="fc-e"><Octicon name="alert" />{errors.unit}</p>{/if}
			</fieldset>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" disabled={saving}
				>{saving ? 'Creating…' : 'Create and price it'}</button
			>
			<a class="btn" href={resolve('/catalogue/services')}>Cancel</a>
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
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--surface-2);
	}
</style>
