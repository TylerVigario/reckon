<script lang="ts">
	import { untrack } from 'svelte';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { readNewAgreement } from '#lib/agreement-fields.ts';
	import { readJson, readProblem } from '#lib/json.ts';
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	/**
	 * A new agreement: a client's, or one of its sites' -- what it charges, how
	 * often, and from when. What it covers is set on its own screen next: there
	 * is no default to start from. A Primer form, its action at the foot with
	 * Cancel beside it.
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

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (saving) return;
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

{#snippet wrong(key: string)}
	{#if errors[key]}
		<p class="fc-e" id="a-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<Top
	title="New agreement"
	sub="What it covers is set next"
	back={resolve('/catalogue/agreements')}
	backLabel="Agreements"
/>

<div class="pad primer">
	<form class="box" onsubmit={create} novalidate>
		<div class="box-row form">
			<div class="fc">
				<label class="fc-l" for="a-client">Client<span aria-hidden="true"> *</span></label>
				<select
					id="a-client"
					class="ti"
					bind:value={client}
					aria-invalid={errors.entity_id ? 'true' : undefined}
					aria-describedby={errors.entity_id ? 'a-entity_id-e' : undefined}
				>
					<option value={null}>Choose…</option>
					{#each data.clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
				{@render wrong('entity_id')}
			</div>

			{#if client}
				<div class="fc">
					<label class="fc-l" for="a-site">For</label>
					<select
						id="a-site"
						class="ti"
						bind:value={site}
						aria-invalid={errors.site_id ? 'true' : undefined}
						aria-describedby={errors.site_id ? 'a-site_id-e' : 'a-site-c'}
					>
						<option value="">The whole client</option>
						{#each sites as s (s.id)}<option value={s.id}>{s.label} only</option>{/each}
					</select>
					{#if errors.site_id}
						{@render wrong('site_id')}
					{:else}
						<p class="fc-c" id="a-site-c">
							{site
								? 'Work at this site. The client’s other sites are billed unless they have agreements of their own.'
								: 'Work at any of its sites, except one with an agreement of its own.'}
						</p>
					{/if}
				</div>
			{/if}

			<div class="fc">
				<label class="fc-l" for="a-price">Price<span aria-hidden="true"> *</span></label>
				<input
					id="a-price"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={price}
					aria-invalid={errors.price ? 'true' : undefined}
					aria-describedby={errors.price ? 'a-price-e' : undefined}
				/>
				{@render wrong('price')}
			</div>

			<div class="fc">
				<label class="fc-l" for="a-every">Every</label>
				<select id="a-every" class="ti" bind:value={interval}>
					<option value="weekly">Week</option>
					<option value="monthly">Month</option>
					<option value="quarterly">Quarter</option>
					<option value="annually">Year</option>
				</select>
			</div>

			<div class="fc">
				<label class="fc-l" for="a-starts">Starts<span aria-hidden="true"> *</span></label>
				<input
					id="a-starts"
					class="ti"
					type="date"
					bind:value={starts}
					aria-invalid={errors.starts_on ? 'true' : undefined}
					aria-describedby={errors.starts_on ? 'a-starts_on-e' : 'a-starts-c'}
				/>
				{#if errors.starts_on}
					{@render wrong('starts_on')}
				{:else}
					<p class="fc-c" id="a-starts-c">It is charged on this day of each period, in advance.</p>
				{/if}
			</div>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" disabled={saving}>
				{saving ? 'Creating…' : 'Create, then say what it covers'}
			</button>
			<a class="btn" href={resolve('/catalogue/agreements')}>Cancel</a>
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
