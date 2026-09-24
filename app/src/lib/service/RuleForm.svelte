<script lang="ts">
	import { untrack } from 'svelte';
	import { readRule } from '$lib/service-fields';
	import { readProblem } from '$lib/json';

	/**
	 * A pay rule from a day: whom it pays, for what, how, and for which clients.
	 *
	 * Like a price, it adds a row. A change to a rule in force is a rule for the
	 * same payee and the same clients from a later day, which is why "Change"
	 * opens this with the scope already chosen.
	 */
	type Rule = {
		role_id: string | null;
		user_id: string | null;
		entity_id: string | null;
		pays_for: string;
		method: string;
		amount: string | null;
	};

	let {
		serviceId,
		roles,
		people,
		clients,
		today,
		preset = null,
		onsaved,
		oncancel
	}: {
		serviceId: string;
		roles: { id: string; name: string }[];
		people: { id: string; name: string }[];
		clients: { id: string; name: string }[];
		today: string;
		preset?: Rule | null;
		onsaved: () => void;
		oncancel: () => void;
	} = $props();

	const start = untrack(() => preset);
	let who = $state<'role' | 'person'>(start?.user_id ? 'person' : 'role');
	let roleId = $state<string | null>(start?.role_id ?? untrack(() => roles[0]?.id ?? null));
	let userId = $state<string | null>(start?.user_id ?? null);
	let paysFor = $state(start?.pays_for ?? 'time');
	let method = $state(start?.method ?? 'per_hour');
	let amount = $state(start?.amount ? String(Number(start.amount)) : '');
	let one = $state(Boolean(start?.entity_id));
	let entity = $state<string | null>(start?.entity_id ?? null);
	let from = $state(untrack(() => today));
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	const FOR = [
		{ v: 'time', l: 'Their time' },
		{ v: 'covered_time', l: 'Retainer time' },
		{ v: 'vehicle', l: 'Their vehicle' }
	];
	const HOW = [
		{ v: 'per_hour', l: 'Per hour worked' },
		{ v: 'percent', l: '% of the charge' },
		{ v: 'fixed', l: 'Fixed per entry' },
		{ v: 'nothing', l: 'Nothing' }
	];
	// Time a retainer covers is paid as a share of it -- a percentage, or
	// nothing -- because it was never billed by the hour to take a rate from.
	const allowed = (m: string) => paysFor !== 'covered_time' || m === 'percent' || m === 'nothing';
	$effect(() => {
		if (!allowed(method)) method = 'percent';
	});
	const unitOf = $derived(
		method === 'per_hour'
			? 'an hour'
			: method === 'percent'
				? paysFor === 'covered_time'
					? '% of the retainer'
					: '% of the charge'
				: 'an entry'
	);

	async function save() {
		const fields = {
			role_id: who === 'role' ? (roleId ?? '') : '',
			user_id: who === 'person' ? (userId ?? '') : '',
			entity_id: one ? (entity ?? '') : '',
			pays_for: paysFor,
			method,
			amount: method === 'nothing' ? '' : amount,
			effective_from: from
		};
		const local = readRule(fields);
		if (one && !entity) local.errors.entity_id = 'Which client.';
		errors = local.errors;
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(`/api/services/${serviceId}/rules`, {
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
		onsaved();
	}
</script>

<div class="form">
	<div class="fld">
		<span class="lbl">Who</span>
		<div class="seg">
			<button type="button" class:on={who === 'role'} onclick={() => (who = 'role')}>A role</button>
			<button type="button" class:on={who === 'person'} onclick={() => (who = 'person')}
				>One person</button
			>
		</div>
	</div>
	<div class="fld">
		{#if who === 'role'}
			<label for="r-role">Role</label>
			<select id="r-role" class="inp" bind:value={roleId}>
				{#each roles as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
			</select>
			{#if errors.role_id}<small class="why">{errors.role_id}</small>{/if}
		{:else}
			<label for="r-user">Person</label>
			<select id="r-user" class="inp" bind:value={userId}>
				<option value={null}>Choose…</option>
				{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			{#if errors.user_id}<small class="why">{errors.user_id}</small>{/if}
		{/if}
	</div>

	<div class="fld">
		<span class="lbl">For</span>
		<div class="seg">
			{#each FOR as f (f.v)}
				<button type="button" class:on={paysFor === f.v} onclick={() => (paysFor = f.v)}
					>{f.l}</button
				>
			{/each}
		</div>
	</div>

	<div class="fld">
		<span class="lbl">How</span>
		<div class="seg four">
			{#each HOW as h (h.v)}
				<button
					type="button"
					class:on={method === h.v}
					disabled={!allowed(h.v)}
					onclick={() => (method = h.v)}>{h.l}</button
				>
			{/each}
		</div>
		{#if errors.method}<small class="why">{errors.method}</small>{/if}
	</div>

	{#if method !== 'nothing'}
		<div class="fld">
			<label for="r-amount">Amount</label>
			<span class="inp-wrap">
				<input
					id="r-amount"
					class="inp"
					inputmode="decimal"
					placeholder={method === 'percent' ? '100' : '50.00'}
					bind:value={amount}
				/>
				<span class="hint">{unitOf}</span>
			</span>
			{#if errors.amount}<small class="why">{errors.amount}</small>{/if}
		</div>
	{/if}

	<div class="fld">
		<span class="lbl">Clients</span>
		<div class="seg">
			<button type="button" class:on={!one} onclick={() => (one = false)}>Every client</button>
			<button type="button" class:on={one} onclick={() => (one = true)}>One client</button>
		</div>
	</div>
	{#if one}
		<div class="fld">
			<label for="r-client">Which client</label>
			<select id="r-client" class="inp" bind:value={entity}>
				<option value={null}>Choose…</option>
				{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			{#if errors.entity_id}<small class="why">{errors.entity_id}</small>{/if}
		</div>
	{/if}

	<div class="fld">
		<label for="r-from">From</label>
		<input id="r-from" class="inp" type="date" bind:value={from} />
		{#if errors.effective_from}<small class="why">{errors.effective_from}</small>{/if}
	</div>

	<p class="note">
		<b>Per hour worked</b> is counted to the second. <b>% of the charge</b> is of the whole line,
		before tax — and for retainer time, of what the retainer charged that month, split by each
		person's share of its hours. <b>Fixed per entry</b> is the same however long it took.
		<b>Nothing</b> lets a narrower rule switch a wider one off. The narrowest rule that has started pays:
		one client's before every client's, one person's before their role's.
	</p>

	{#if saying}<p class="why">{saying}</p>{/if}

	<div class="btnrow">
		<button type="button" class="btn" onclick={oncancel}>Cancel</button>
		<button type="button" class="btn pri" onclick={save} disabled={saving}>
			{saving ? 'Saving…' : 'Save rule'}
		</button>
	</div>
</div>

<style>
	.form {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		border-top: 1px solid var(--line-soft);
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	/* Four choices at phone width, two by two. */
	.seg.four {
		display: grid;
		grid-template-columns: 1fr 1fr;
	}
	.seg.four button {
		border-bottom: 1px solid var(--line);
	}
	.seg.four button:nth-child(2n) {
		border-right: 0;
	}
	.seg.four button:nth-last-child(-n + 2) {
		border-bottom: 0;
	}
	.seg button:disabled {
		color: var(--ink-faint);
		cursor: not-allowed;
	}
	.inp-wrap {
		position: relative;
		display: block;
	}
	.inp-wrap .hint {
		position: absolute;
		right: 14px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		color: var(--ink-3);
		font-family: var(--f-mono);
		pointer-events: none;
	}
	.note {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ink-3);
	}
	.note b {
		color: var(--ink-2);
		font-weight: 600;
	}
	.why {
		color: var(--crit);
		margin: 0;
	}
	.fld small.why {
		font-size: 12.5px;
	}
</style>
