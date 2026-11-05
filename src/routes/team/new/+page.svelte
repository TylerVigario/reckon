<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { ACCESS, ACCESS_WORDS, type Access } from '#lib/access.ts';
	import { parseAll } from '#lib/field-rules.ts';
	import { NEW_PERSON_FIELDS } from '#lib/people-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { carry } from '#lib/password-handover.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * Adding a person, as a Primer form: each label above its field, what it
	 * means below, and Add person at the bottom with Cancel beside it. Nobody is
	 * emailed: whoever adds them lands on their page with a password to hand
	 * them, and they choose their own the first time they sign in with it.
	 */
	let { data }: PageProps = $props();

	let name = $state('');
	let email = $state('');
	let roleId = $state('');
	let access = $state<Access>('field');
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});
	let problem = $state('');

	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (saving) return;
		const fields = { name, email, role_id: roleId, access };
		errors = parseAll(NEW_PERSON_FIELDS, fields).errors;
		problem = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch('/api/people', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		if (!r?.ok) {
			saving = false;
			const p = r ? await readProblem(r) : null;
			if (p?.errors) errors = p.errors;
			else problem = p ? (p.detail ?? 'They weren’t added.') : 'Not added — no connection.';
			return;
		}
		const { id, password } = (await r.json()) as { id: string; password: string };
		carry(id, password);
		await goto(resolve('/team/[id]', { id }));
	}
</script>

{#snippet wrong(key: string)}
	{#if errors[key]}
		<p class="fc-e" id="n-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<Top title="Add person" back={resolve('/team')} backLabel="Team" />

<div class="pad primer">
	<form class="box" onsubmit={add} novalidate>
		<div class="box-row form">
			<div class="fc">
				<label class="fc-l" for="n-name">Name</label>
				<input
					id="n-name"
					class="ti"
					autocomplete="off"
					bind:value={name}
					aria-invalid={errors.name ? 'true' : undefined}
					aria-describedby={errors.name ? 'n-name-e' : undefined}
				/>
				{@render wrong('name')}
			</div>
			<div class="fc">
				<label class="fc-l" for="n-email">Email</label>
				<input
					id="n-email"
					class="ti"
					type="email"
					autocomplete="off"
					bind:value={email}
					aria-invalid={errors.email ? 'true' : undefined}
					aria-describedby={errors.email ? 'n-email-e' : 'n-email-c'}
				/>
				{#if errors.email}
					{@render wrong('email')}
				{:else}
					<p class="fc-c" id="n-email-c">They sign in with this.</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="n-role">Role</label>
				<select
					id="n-role"
					class="ti"
					bind:value={roleId}
					aria-invalid={errors.role_id ? 'true' : undefined}
					aria-describedby={errors.role_id ? 'n-role_id-e' : 'n-role-c'}
				>
					{#each data.roles as r (r.id)}
						<option value={r.id}>{r.name}</option>
					{/each}
					<option value="">Not paid</option>
				</select>
				{#if errors.role_id}
					{@render wrong('role_id')}
				{:else}
					<p class="fc-c" id="n-role-c">Who they are paid as.</p>
				{/if}
			</div>
			<fieldset class="fc">
				<legend class="fc-l">Access</legend>
				{#each ACCESS as a (a)}
					<label class="rad">
						<input type="radio" name="access" value={a} bind:group={access} />
						<span>
							<span class="rad-t">{ACCESS_WORDS[a].label}</span>
							<span class="rad-c">{ACCESS_WORDS[a].reach}</span>
						</span>
					</label>
				{/each}
				{@render wrong('access')}
			</fieldset>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" disabled={saving}
				>{saving ? 'Adding…' : 'Add person'}</button
			>
			<a class="btn" href={resolve('/team')}>Cancel</a>
			{#if problem}
				<p class="fc-e"><Octicon name="alert" />{problem}</p>
			{:else}
				<p class="note">You get a temporary password to give them.</p>
			{/if}
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
