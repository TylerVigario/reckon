<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { PAYS_AS, ROLE_FIELDS } from '#lib/people-fields.ts';
	import { PAID_AS_WORDS } from '#lib/pay-words.ts';
	import { parseAll } from '#lib/field-rules.ts';
	import { readProblem } from '#lib/json.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import type { PageProps } from './$types';

	/**
	 * The roles people are paid as, as Primer's DataTable: a header row in the
	 * muted background, a row each, and each row's actions in a menu in its
	 * last column. Edit turns that row into its fields, with Save beside them,
	 * one row at a time; a role being added is a row at the bottom. A role
	 * someone holds or a pay rule names can't be deleted, and its menu says
	 * why. On a phone each row stacks, as Polaris's tables do.
	 */
	let { data }: PageProps = $props();

	type Role = (typeof data.roles)[number];

	// The row open: a role's id, or 'new' for one being added.
	let editing = $state<string | null>(null);
	let draft = $state({ name: '', pays_as: '' });
	let error = $state('');
	let saving = $state(false);
	let deleting = $state<Role | null>(null);
	let working = $state(false);
	let deleteError = $state('');
	let said = $state('');

	const heading = (k: Role['pays_as']) => (k ? PAID_AS_WORDS[k].heading : 'Not said');
	const people = (n: number) => (n === 0 ? 'No one' : n === 1 ? '1 person' : `${n} people`);
	const why = (r: Role) =>
		r.holders
			? `Held by ${people(r.holders).toLowerCase()}, so it stays`
			: r.rules
				? `A pay rule names it, so it stays`
				: undefined;

	async function open(at: Role | 'new') {
		editing = at === 'new' ? 'new' : at.id;
		draft = at === 'new' ? { name: '', pays_as: '' } : { name: at.name, pays_as: at.pays_as ?? '' };
		error = '';
		said = '';
		await tick();
		document.querySelector<HTMLInputElement>('#role-name')?.focus();
	}

	/** What is wrong with what was sent, or null. */
	async function sent(r: Response | null): Promise<string | null> {
		if (!r) return 'Not saved — no connection.';
		if (r.ok) return null;
		const problem = await readProblem(r);
		return (
			problem.errors?.name ?? problem.errors?.pays_as ?? problem.detail ?? 'That did not save.'
		);
	}

	async function save() {
		if (saving || editing === null) return;
		const local = parseAll(ROLE_FIELDS, draft).errors;
		error = local.name ?? local.pays_as ?? '';
		if (error) return;
		saving = true;
		if (editing === 'new') {
			error =
				(await sent(
					await fetch('/api/roles', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ fields: draft })
					}).catch(() => null)
				)) ?? '';
		} else {
			// One field at a time, as the endpoint takes them: only what changed.
			const was = data.roles.find((r) => r.id === editing);
			for (const field of ['name', 'pays_as'] as const) {
				if (error || draft[field].trim() === (was?.[field] ?? '')) continue;
				error =
					(await sent(
						await fetch(`/api/roles/${editing}`, {
							method: 'PATCH',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ fields: { [field]: draft[field] } })
						}).catch(() => null)
					)) ?? '';
			}
		}
		if (!error) {
			if (editing === 'new') said = `${draft.name.trim()} added`;
			editing = null;
		}
		await refreshAll();
		saving = false;
	}
	function keys(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void save();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			editing = null;
		}
	}

	async function remove() {
		if (!deleting) return;
		working = true;
		const r = await fetch(`/api/roles/${deleting.id}`, { method: 'DELETE' }).catch(() => null);
		working = false;
		if (!r?.ok) {
			deleteError = r
				? ((await readProblem(r)).detail ?? 'Not deleted.')
				: 'Not deleted — no connection.';
			return;
		}
		said = `${deleting.name} deleted`;
		deleting = null;
		await refreshAll();
	}
</script>

{#snippet fields(r: Role | null)}
	<tr class="editing">
		<td data-label="Role">
			<label class="sr" for="role-name">Role</label>
			<input
				id="role-name"
				class="ti"
				autocomplete="off"
				placeholder="Apprentice"
				bind:value={draft.name}
				aria-invalid={error ? 'true' : undefined}
				onkeydown={keys}
			/>
		</td>
		<td data-label="Paid as">
			<label class="sr" for="role-pays-as">Paid as</label>
			<select id="role-pays-as" class="ti" bind:value={draft.pays_as} onkeydown={keys}>
				<option value="" disabled>Choose one</option>
				{#each PAYS_AS as k (k)}<option value={k}>{PAID_AS_WORDS[k].heading}</option>{/each}
			</select>
		</td>
		<td data-label="Held by" class="muted">{r ? people(r.holders) : ''}</td>
		<td class="act">
			<div class="keep">
				<button type="button" class="btn sm pri" onclick={save} disabled={saving}
					>{saving ? 'Saving…' : r ? 'Save' : 'Add role'}</button
				>
				<button type="button" class="btn sm" onclick={() => (editing = null)} disabled={saving}
					>Cancel</button
				>
			</div>
		</td>
	</tr>
	{#if error}
		<tr class="err">
			<td colspan="4"><p class="fc-e"><Octicon name="alert" />{error}</p></td>
		</tr>
	{/if}
{/snippet}

<Top title="Team" back={resolve('/more')} backLabel="More">
	{#snippet actions()}
		{#if editing === null}
			<button type="button" class="btn pri sm" onclick={() => open('new')}>Add role</button>
		{/if}
	{/snippet}
</Top>

<div class="pad primer">
	<UnderlineNav
		label="Team"
		items={[
			{ href: resolve('/team'), label: 'People', count: data.people, current: false },
			{ href: resolve('/team/roles'), label: 'Roles', count: data.roles.length, current: true }
		]}
	/>

	{#if said}
		<div class="banner good" role="status">
			<Octicon name="checkCircle" />
			<div class="banner-m"><p class="banner-t">{said}</p></div>
			<button type="button" class="ib" aria-label="Dismiss" onclick={() => (said = '')}>
				<Octicon name="x" />
			</button>
		</div>
	{/if}

	<div class="box">
		<table class="dt">
			<caption class="sr">Roles</caption>
			<thead>
				<tr>
					<th scope="col">Role</th>
					<th scope="col">Paid as</th>
					<th scope="col">Held by</th>
					<th scope="col"><span class="sr">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.roles as r (r.id)}
					{#if editing === r.id}
						{@render fields(r)}
					{:else}
						<tr>
							<td data-label="Role" class="name">{r.name}</td>
							<td data-label="Paid as" class:muted={!r.pays_as}>{heading(r.pays_as)}</td>
							<td data-label="Held by" class="muted">{people(r.holders)}</td>
							<td class="act">
								{#if editing === null}
									<ActionMenu
										label="Actions for {r.name}"
										items={[
											{ label: 'Edit', onselect: () => void open(r) },
											'divider',
											{
												label: 'Delete role',
												danger: true,
												inactive: why(r),
												onselect: () => {
													deleteError = '';
													deleting = r;
												}
											}
										]}
									/>
								{/if}
							</td>
						</tr>
					{/if}
				{:else}
					{#if editing !== 'new'}
						<tr><td colspan="4" class="muted">No roles yet. Add the first.</td></tr>
					{/if}
				{/each}
				{#if editing === 'new'}
					{@render fields(null)}
				{/if}
			</tbody>
		</table>
	</div>

	<p class="note">
		A role is who someone is paid as. What it pays for each kind of work is set on
		<a href={resolve('/services')}>each service</a>.
	</p>

	<Dialog
		open={deleting !== null}
		title="Delete {deleting?.name ?? 'the role'}?"
		go="Delete role"
		going="Deleting…"
		tone="danger"
		{working}
		ongo={remove}
		onclose={() => (deleting = null)}
	>
		<p>No one holds it and no pay rule names it. It can’t be undone.</p>
		{#if deleteError}
			<p class="fc-e"><Octicon name="alert" />{deleteError}</p>
		{/if}
	</Dialog>
</div>

<style>
	.dt {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		padding: 8px 16px;
		font-size: 12px;
		font-weight: 600;
		text-align: left;
		color: var(--ink-2);
		background: var(--surface-2);
		border-bottom: 1px solid var(--line);
	}
	td {
		height: 52px;
		padding: 6px 16px;
		vertical-align: middle;
		border-top: 1px solid var(--line-soft);
	}
	tbody tr:first-child td {
		border-top: 0;
	}
	tr.err td {
		height: auto;
		padding-top: 0;
		border-top: 0;
	}
	.name {
		font-weight: 600;
	}
	.act {
		width: 1%;
		white-space: nowrap;
		text-align: right;
	}
	.keep {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	/* A row each, stacked, on a phone: the role on top, the rest under it with
	   their labels, and the menu at the top right. */
	@media (max-width: 543px) {
		thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.dt,
		tbody,
		tr,
		td {
			display: block;
		}
		tr {
			position: relative;
			padding: 12px 16px;
			border-top: 1px solid var(--line-soft);
		}
		tbody tr:first-child {
			border-top: 0;
		}
		td {
			height: auto;
			padding: 2px 0;
			border-top: 0;
		}
		td.name {
			padding-right: 56px;
		}
		td:not(.name, .act)[data-label]::before {
			content: attr(data-label) ': ';
			color: var(--ink-3);
		}
		tr.editing td[data-label]::before {
			content: none;
		}
		tr.editing td {
			padding: 4px 0;
		}
		.act {
			width: auto;
		}
		tr:not(.editing) .act {
			position: absolute;
			top: 8px;
			right: 8px;
		}
		tr.editing .keep {
			justify-content: flex-start;
			padding-top: 4px;
		}
		tr.err {
			padding-top: 0;
			border-top: 0;
		}
	}
</style>
