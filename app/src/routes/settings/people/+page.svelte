<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
	import { parsePersonField, parseRoleField, ROLE_FIELDS } from '#lib/people-fields.ts';
	import { parseAll } from '#lib/field-rules.ts';
	import { readProblem } from '#lib/json.ts';
	import { invalidateAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	const roleOptions = $derived([
		...data.roles.map((r) => ({ value: r.id, label: r.name })),
		{ value: '', label: 'Not paid — signs in only' }
	]);

	let newRole = $state('');
	let adding = $state(false);
	let problem = $state('');

	async function addRole() {
		const fields = { name: newRole };
		const local = parseAll(ROLE_FIELDS, fields).errors;
		problem = local.name ?? '';
		if (problem) return;
		adding = true;
		const r = await fetch('/api/roles', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		adding = false;
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).errors?.name ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		newRole = '';
		await invalidateAll();
	}

	async function removeRole(id: string) {
		problem = '';
		const r = await fetch(`/api/roles/${id}`, { method: 'DELETE' }).catch(() => null);
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).detail ?? 'Not deleted.')
				: 'Not deleted — no connection.';
			return;
		}
		await invalidateAll();
	}
</script>

<Top
	title="People and pay"
	sub="Who is paid, and under which rules"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="duo">
		<div class="sec">
			<div class="sec-h"><h2>People</h2></div>
			<div class="rows inset">
				{#each data.people as p (p.id)}
					<Setting
						name="role_id"
						key={p.id}
						label={p.name}
						value={p.role_id ?? ''}
						options={roleOptions}
						hint={[
							p.email,
							p.own_rules ? `${count(p.own_rules, 'rule')} of their own` : null,
							p.active ? null : 'no longer signs in'
						]
							.filter(Boolean)
							.join(' · ')}
						endpoint="/api/people/{p.id}"
						validate={parsePersonField}
						onsaved={() => invalidateAll()}
					/>
				{/each}
			</div>
		</div>

		<div class="sec">
			<div class="sec-h"><h2>Roles</h2></div>
			<div class="rows inset">
				{#each data.roles as r (r.id)}
					<div class="role">
						<Setting
							name="name"
							key={r.id}
							label={`${r.holders ? count(r.holders, 'person', 'people') : 'Nobody'} · ${r.rules ? `named by ${count(r.rules, 'pay rule')}` : 'no pay rule names it'}`}
							value={r.name}
							endpoint="/api/roles/{r.id}"
							validate={parseRoleField}
							onsaved={() => invalidateAll()}
						/>
						{#if !r.holders && !r.rules}
							<button type="button" class="btn sm gho" onclick={() => removeRole(r.id)}
								>Delete {r.name}</button
							>
						{/if}
					</div>
				{/each}
				<div class="fld">
					<label for="new-role">A new role</label>
					<div class="add">
						<input
							id="new-role"
							class="inp"
							placeholder="Apprentice"
							bind:value={newRole}
							onkeydown={(e) => e.key === 'Enter' && addRole()}
						/>
						<button
							type="button"
							class="btn pri"
							onclick={addRole}
							disabled={adding || !newRole.trim()}>Add</button
						>
					</div>
					{#if problem}<small class="why">{problem}</small>{/if}
				</div>
			</div>
		</div>
	</div>

	<div class="rows notes">
		<div class="rec">
			<div class="rec-m">
				<div class="rec-t"><span class="lt">Roles are the business's own list</span></div>
				<div class="rec-s">
					A service's pay rules are written against them, or against one person. The narrowest rule
					that has started pays: one client's before every client's, one person's before their
					role's.
				</div>
			</div>
		</div>
		<div class="rec">
			<div class="rec-m">
				<div class="rec-t"><span class="lt">A role is who someone is now</span></div>
				<div class="rec-s">
					Pay is not yet recorded when it is paid, so until it is, changing someone's role changes
					what the reports say their unpaid work pays.
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.role {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.role .btn {
		align-self: flex-start;
		color: var(--crit);
	}
	.add {
		display: flex;
		gap: 8px;
	}
	.add .btn {
		min-height: 50px;
	}
	.notes {
		margin-top: 22px;
	}
	.why {
		color: var(--crit);
		font-size: 12.5px;
	}
</style>
