<script lang="ts">
	import { untrack } from 'svelte';
	import { readRule } from '#lib/service-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import Octicon from '#lib/Octicon.svelte';

	/**
	 * A pay rule from a day: whom it pays, for what, how, and for which clients.
	 *
	 * Like a price, it adds a row. A change to a rule in force is a rule for the
	 * same payee and the same clients from a later day, which is why "Change"
	 * opens this with the scope already chosen.
	 *
	 * A Primer form in a dialog: each label above its field, what it means
	 * below; the dialog's button sends it (save).
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
		onsaving
	}: {
		serviceId: string;
		roles: { id: string; name: string }[];
		people: { id: string; name: string }[];
		clients: { id: string; name: string }[];
		today: string;
		preset?: Rule | null;
		onsaved: () => void;
		/** Told when it starts and stops being sent: the dialog's button says so. */
		onsaving?: (busy: boolean) => void;
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

	const FOR = [
		{ v: 'time', l: 'Their time', c: 'Hours they work, billed by the hour.' },
		{ v: 'covered_time', l: 'Retainer time', c: 'Hours a client’s retainer covers.' },
		{ v: 'vehicle', l: 'Their vehicle', c: 'Miles driven in a vehicle of theirs.' }
	];
	const HOW = [
		{ v: 'per_hour', l: 'Per hour worked', c: 'Counted to the second.' },
		{
			v: 'percent',
			l: '% of the charge',
			c: 'Of the whole line, before tax. For retainer time, of what the retainer charged that month, split by each person’s share of its hours.'
		},
		{ v: 'fixed', l: 'Fixed per entry', c: 'The same however long it took.' },
		{ v: 'nothing', l: 'Nothing', c: 'Lets a narrower rule switch a wider one off.' }
	];
	// Time a retainer covers is paid as a share of it -- a percentage, or
	// nothing -- because it was never billed by the hour to take a rate from. A
	// vehicle is paid for miles, which have no hours to count.
	const allowed = (m: string) =>
		paysFor === 'covered_time'
			? m === 'percent' || m === 'nothing'
			: paysFor !== 'vehicle' || m !== 'per_hour';
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
				: paysFor === 'vehicle'
					? 'a leg'
					: 'an entry'
	);

	/** Sent from the dialog it is in: its own button, not one of the form's. */
	let sending = false;
	export async function save() {
		if (sending) return;
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
		sending = true;
		onsaving?.(true);
		const r = await fetch(`/api/services/${serviceId}/rules`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		sending = false;
		onsaving?.(false);
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
		<p class="fc-e" id="r-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<div class="form">
	<fieldset class="fc">
		<legend class="fc-l">Who</legend>
		<label class="rad">
			<input type="radio" name="r-who" value="role" bind:group={who} />
			<span><span class="rad-t">A role</span></span>
		</label>
		<label class="rad">
			<input type="radio" name="r-who" value="person" bind:group={who} />
			<span><span class="rad-t">One person</span></span>
		</label>
	</fieldset>
	<div class="fc">
		{#if who === 'role'}
			<label class="fc-l" for="r-role">Role</label>
			<select
				id="r-role"
				class="ti"
				bind:value={roleId}
				aria-invalid={errors.role_id ? 'true' : undefined}
				aria-describedby={errors.role_id ? 'r-role_id-e' : undefined}
			>
				{#each roles as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
			</select>
			{@render wrong('role_id')}
		{:else}
			<label class="fc-l" for="r-user">Person</label>
			<select
				id="r-user"
				class="ti"
				bind:value={userId}
				aria-invalid={errors.user_id ? 'true' : undefined}
				aria-describedby={errors.user_id ? 'r-user_id-e' : undefined}
			>
				<option value={null}>Choose…</option>
				{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			{@render wrong('user_id')}
		{/if}
	</div>

	<fieldset class="fc">
		<legend class="fc-l">For</legend>
		{#each FOR as f (f.v)}
			<label class="rad">
				<input type="radio" name="r-for" value={f.v} bind:group={paysFor} />
				<span><span class="rad-t">{f.l}</span><span class="rad-c">{f.c}</span></span>
			</label>
		{/each}
	</fieldset>

	<fieldset class="fc">
		<legend class="fc-l">How</legend>
		{#each HOW as h (h.v)}
			<label class="rad" class:off={!allowed(h.v)}>
				<input type="radio" name="r-how" value={h.v} bind:group={method} disabled={!allowed(h.v)} />
				<span><span class="rad-t">{h.l}</span><span class="rad-c">{h.c}</span></span>
			</label>
		{/each}
		{@render wrong('method')}
	</fieldset>

	{#if method !== 'nothing'}
		<div class="fc">
			<label class="fc-l" for="r-amount">Amount</label>
			<span class="tv">
				<input
					id="r-amount"
					class="ti"
					inputmode="decimal"
					autocomplete="off"
					bind:value={amount}
					aria-invalid={errors.amount ? 'true' : undefined}
					aria-describedby={errors.amount ? 'r-amount-e' : undefined}
				/>
				<span class="tv-v" aria-hidden="true">{unitOf}</span>
			</span>
			{@render wrong('amount')}
		</div>
	{/if}

	<fieldset class="fc">
		<legend class="fc-l">Clients</legend>
		<label class="rad">
			<input type="radio" name="r-clients" value={false} bind:group={one} />
			<span><span class="rad-t">Every client</span></span>
		</label>
		<label class="rad">
			<input type="radio" name="r-clients" value={true} bind:group={one} />
			<span><span class="rad-t">One client</span></span>
		</label>
	</fieldset>
	{#if one}
		<div class="fc">
			<label class="fc-l" for="r-client">Which client</label>
			<select
				id="r-client"
				class="ti"
				bind:value={entity}
				aria-invalid={errors.entity_id ? 'true' : undefined}
				aria-describedby={errors.entity_id ? 'r-entity_id-e' : undefined}
			>
				<option value={null}>Choose…</option>
				{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			{@render wrong('entity_id')}
		</div>
	{/if}

	<div class="fc">
		<label class="fc-l" for="r-from">From</label>
		<input
			id="r-from"
			class="ti"
			type="date"
			bind:value={from}
			aria-invalid={errors.effective_from ? 'true' : undefined}
			aria-describedby={errors.effective_from ? 'r-effective_from-e' : undefined}
		/>
		{@render wrong('effective_from')}
	</div>

	<p class="note">
		The narrowest rule that has started pays: one client’s before every client’s, one person’s
		before their role’s.
	</p>

	{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.fc {
		max-width: 440px;
	}
	.rad.off {
		opacity: 0.5;
	}
	.tv {
		position: relative;
		display: block;
	}
	.tv .ti {
		padding-right: 132px;
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
</style>
