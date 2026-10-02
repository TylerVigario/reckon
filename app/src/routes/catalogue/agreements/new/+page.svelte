<script lang="ts">
	import { untrack } from 'svelte';
	import Top from '#lib/Top.svelte';
	import { readNewAgreement } from '#lib/agreement-fields.ts';
	import { readJson, readProblem } from '#lib/json.ts';
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	/**
	 * A new agreement: a client's, or one of its sites' -- what it charges, how
	 * often, and from when. What it covers is set on its own screen next: there
	 * is no default to start from.
	 */
	let client = $state<string | null>(untrack(() => data.chosen));
	let site = $state('');
	let price = $state('');
	let interval = $state('monthly');
	let starts = $state(untrack(() => data.today));
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	const sites = $derived(data.clients.find((c) => c.id === client)?.sites ?? []);
	// A site belongs to one client, so choosing another client starts over.
	let seeded = $state<string | null>(untrack(() => data.chosen));
	$effect(() => {
		if (client !== seeded) {
			site = '';
			seeded = client;
		}
	});

	async function create() {
		const fields = {
			entity_id: client ?? '',
			site_id: site,
			price,
			billing_interval: interval,
			starts_on: starts
		};
		errors = readNewAgreement(fields).errors;
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch('/api/agreements', {
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
		if (made.id) await goto(resolve('/catalogue/agreements/[id]', { id: made.id }));
		else saying = 'Saved, but the server did not say where it went.';
	}
</script>

<Top
	title="New agreement"
	sub="What it covers is set next"
	back={resolve('/catalogue/agreements')}
	backLabel="Agreements"
/>

<div class="pad">
	<div class="sec">
		<div class="rows inset">
			<div class="fld">
				<label for="a-client">Client</label>
				<select id="a-client" class="inp" bind:value={client}>
					<option value={null}>Choose…</option>
					{#each data.clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
				{#if errors.entity_id}<small class="why">{errors.entity_id}</small>{/if}
			</div>

			{#if client}
				<div class="fld">
					<label for="a-site">For</label>
					<select id="a-site" class="inp" bind:value={site}>
						<option value="">The whole client</option>
						{#each sites as s (s.id)}<option value={s.id}>{s.label} only</option>{/each}
					</select>
					{#if errors.site_id}<small class="why">{errors.site_id}</small>
					{:else}<small
							>{site
								? 'Work at this site. The client’s other sites are billed unless they have agreements of their own.'
								: 'Work at any of its sites, except one with an agreement of its own.'}</small
						>{/if}
				</div>
			{/if}

			<div class="fld">
				<label for="a-price">Price</label>
				<input
					id="a-price"
					class="inp"
					inputmode="decimal"
					placeholder="150.00"
					bind:value={price}
				/>
				{#if errors.price}<small class="why">{errors.price}</small>{/if}
			</div>

			<div class="fld">
				<label for="a-every">Every</label>
				<select id="a-every" class="inp" bind:value={interval}>
					<option value="weekly">Week</option>
					<option value="monthly">Month</option>
					<option value="quarterly">Quarter</option>
					<option value="annually">Year</option>
				</select>
			</div>

			<div class="fld">
				<label for="a-starts">Starts</label>
				<input id="a-starts" class="inp" type="date" bind:value={starts} />
				{#if errors.starts_on}<small class="why">{errors.starts_on}</small>
				{:else}<small>It is charged on this day of each period, in advance.</small>{/if}
			</div>

			{#if saying}<p class="why">{saying}</p>{/if}
			<button type="button" class="btn pri blk" onclick={create} disabled={saving}>
				{saving ? 'Creating…' : 'Create, then say what it covers'}
			</button>
		</div>
	</div>
</div>

<style>
	small {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.why,
	small.why {
		color: var(--crit);
		margin: 0;
	}
</style>
