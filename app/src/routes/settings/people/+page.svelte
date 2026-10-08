<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
	import { parsePersonField, parseRoleField, PAYS_AS, ROLE_FIELDS } from '#lib/people-fields.ts';
	import { paysAsLabel } from '#lib/pay-words.ts';
	import { parseAll } from '#lib/field-rules.ts';
	import { readProblem } from '#lib/json.ts';
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	const roleOptions = $derived([
		...data.roles.map((r) => ({ value: r.id, label: r.name })),
		{ value: '', label: 'Not paid — signs in only' }
	]);

	// What a role is paid as decides where its pay is reported. A role named
	// before reckon asked has not said, and offers that until it does.
	const paysAsOptions = (said: string | null) => [
		...(said ? [] : [{ value: '', label: 'Not said — choose one' }]),
		...PAYS_AS.map((k) => ({ value: k, label: paysAsLabel(k) }))
	];

	let newRole = $state('');
	let newPaysAs = $state('');
	let adding = $state(false);
	let problem = $state('');

	async function addRole() {
		const fields = { name: newRole, pays_as: newPaysAs };
		const local = parseAll(ROLE_FIELDS, fields).errors;
		problem = local.name ?? local.pays_as ?? '';
		if (problem) return;
		adding = true;
		const r = await fetch('/api/roles', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		adding = false;
		if (!r?.ok) {
			const errors = r ? (await readProblem(r)).errors : null;
			problem = r
				? (errors?.name ?? errors?.pays_as ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		newRole = '';
		newPaysAs = '';
		await refreshAll();
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
		await refreshAll();
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
						onsaved={() => refreshAll()}
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
							onsaved={() => refreshAll()}
						/>
						<Setting
							name="pays_as"
							key={r.id}
							label="Paid as"
							value={r.pays_as ?? ''}
							options={paysAsOptions(r.pays_as)}
							endpoint="/api/roles/{r.id}"
							validate={parseRoleField}
							onsaved={() => refreshAll()}
						/>
						{#if !r.holders && !r.rules}
							<button type="button" class="btn sm gho del" onclick={() => removeRole(r.id)}
								>Delete {r.name}</button
							>
						{/if}
					</div>
				{/each}
				<div class="role">
					<div class="fld">
						<label for="new-role">A new role</label>
						<input
							id="new-role"
							class="inp"
							placeholder="Apprentice"
							bind:value={newRole}
							onkeydown={(e) => e.key === 'Enter' && addRole()}
						/>
					</div>
					<div class="fld">
						<label for="new-pays-as">Paid as</label>
						<div class="add">
							<select id="new-pays-as" class="inp" bind:value={newPaysAs}>
								<option value="" disabled>Choose one</option>
								{#each PAYS_AS as k (k)}<option value={k}>{paysAsLabel(k)}</option>{/each}
							</select>
							<button
								type="button"
								class="btn pri"
								onclick={addRole}
								disabled={adding || !newRole.trim() || !newPaysAs}>Add</button
							>
						</div>
						{#if problem}<small class="why">{problem}</small>{/if}
					</div>
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
				<div class="rec-t"><span class="lt">What a role is paid as</span></div>
				<div class="rec-s">
					Decides where its pay is reported: a partner's guaranteed payments on the partnership's
					return, an employee's wages through payroll, before withholding, and a contractor's fees
					on a 1099. Pay for someone's own vehicle is a reimbursement, whatever their role.
				</div>
			</div>
		</div>
		<div class="rec">
			<div class="rec-m">
				<div class="rec-t"><span class="lt">A role is who someone is now</span></div>
				<div class="rec-s">
					A payment keeps what each item was paid as, so changing someone's role moves only what is
					still owed.
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.role {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.role + .role {
		padding-top: 14px;
		border-top: 1px solid var(--line);
	}
	.role .del {
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
