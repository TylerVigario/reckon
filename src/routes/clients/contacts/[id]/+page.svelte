<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { parseContactField } from '#lib/contact-fields.ts';
	import { names } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { clientOpens } from '#lib/section-tabs.ts';
	import { tick } from 'svelte';
	import type { PageProps } from './$types';

	/**
	 * One contact, as Team draws a person: their details, and under them the
	 * clients they act for, each opening that client.
	 *
	 * THIS IS WHERE A CONTACT'S DETAILS CHANGE, one row at a time: the pencil
	 * opens that row with Save beside the field, as Primer's saving pattern
	 * asks. Enter saves, Escape leaves it, and what is wrong is said under the
	 * field. A client and a site name them and link here.
	 *
	 * Someone with Field reads them, and changes nothing (#lib/access).
	 */
	let { data }: PageProps = $props();
	const p = $derived(data.person);
	const field = $derived(data.user?.access === 'field');
	const billed = $derived(data.clients.filter((c) => c.bills).map((c) => c.name));

	type Key = 'name' | 'email' | 'phone' | 'note';
	const ROWS: { key: Key; label: string }[] = [
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'phone', label: 'Phone' },
		{ key: 'note', label: 'Note' }
	];
	const caption = (key: Key) =>
		key === 'email' && billed.length
			? `${names(billed)}’s invoices are sent here.`
			: key === 'note'
				? 'What they do, or when to call.'
				: '';

	let editing = $state<Key | null>(null);
	let draft = $state('');
	let error = $state('');
	let saving = $state(false);
	let saved = $state<Key | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function edit(key: Key) {
		editing = key;
		draft = p[key] ?? '';
		error = '';
	}

	async function leave() {
		const key = editing;
		editing = null;
		error = '';
		await tick();
		document.querySelector<HTMLElement>(`[data-edit="${key}"]`)?.focus();
	}

	async function save() {
		if (!editing || saving) return;
		const key = editing;
		const parsed = parseContactField(key, draft);
		if (!parsed.ok) return void (error = parsed.why);
		if (parsed.value === p[key]) return leave();
		saving = true;
		const r = await fetch(`/api/contacts/${p.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { [key]: draft } })
		}).catch(() => null);
		if (!r) {
			saving = false;
			return void (error = 'Not saved — no connection.');
		}
		if (!r.ok) {
			const problem = await readProblem(r);
			saving = false;
			return void (error = problem.errors?.[key] ?? problem.detail ?? 'That did not save.');
		}
		await refreshAll();
		saving = false;
		saved = key;
		clearTimeout(timer);
		timer = setTimeout(() => (saved = null), 4000);
		await leave();
	}

	function keys(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void save();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			void leave();
		}
	}

	const focus = (node: HTMLInputElement) => {
		node.focus();
		node.select();
	};
</script>

<Top title={p.name} back={resolve('/clients/contacts')} backLabel="Contacts" />

<div class="pad primer">
	<section class="box" aria-labelledby="details-h">
		<div class="box-h"><h2 class="box-t" id="details-h">Details</h2></div>
		{#each ROWS as { key, label } (key)}
			{@const about = caption(key)}
			<div class="box-row kv">
				{#if editing === key}
					<label class="kv-l" for="edit-{key}"
						>{label}{#if key === 'name'}<span aria-hidden="true"> *</span>{/if}</label
					>
					<div class="kv-edit">
						<div class="ie">
							<input
								id="edit-{key}"
								class="ti"
								type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
								autocomplete="off"
								required={key === 'name'}
								bind:value={draft}
								aria-invalid={error ? 'true' : undefined}
								aria-describedby={error || about ? `about-${key}` : undefined}
								onkeydown={keys}
								use:focus
							/>
							<button type="button" class="btn sm pri" onclick={save} disabled={saving}
								>{saving ? 'Saving…' : 'Save'}</button
							>
							<button type="button" class="btn sm" onclick={leave} disabled={saving}>Cancel</button>
						</div>
						{#if error}
							<p class="fc-e" id="about-{key}"><Octicon name="alert" />{error}</p>
						{:else if about}
							<p class="fc-c" id="about-{key}">{about}</p>
						{/if}
					</div>
				{:else}
					<span class="kv-l">{label}</span>
					<span class="kv-v">
						<span>
							{#if p[key]}{p[key]}{:else}<span class="muted">None</span>{/if}
							{#if saved === key}
								<span class="saved" role="status"><Octicon name="check" />Saved</span>
							{/if}
						</span>
						{#if key === 'email' && about}<span class="sub">{about}</span>{/if}
					</span>
					<span class="end">
						{#if !field && editing === null}
							<button
								type="button"
								class="ib"
								data-edit={key}
								aria-label="Edit {label.toLowerCase()}"
								onclick={() => edit(key)}><Octicon name="pencil" /></button
							>
						{/if}
					</span>
				{/if}
			</div>
		{/each}
	</section>

	<section class="box" aria-labelledby="for-h">
		<div class="box-h"><h2 class="box-t" id="for-h">Clients</h2></div>
		{#each data.clients as c (c.slug)}
			<a class="box-row" href={clientOpens(c.slug, data.user?.access)}>
				<span class="who">
					<span class="n">{c.name}</span>
					{#if c.sites.length}<span class="sub">At {names(c.sites)}</span>{/if}
				</span>
				{#if c.bills}<span class="lab">Gets invoices</span>{/if}
			</a>
		{:else}
			<p class="box-row muted">No client yet.</p>
		{/each}
	</section>
</div>

<style>
	.box-row {
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.kv {
		display: grid;
		grid-template-columns: minmax(0, 30%) minmax(0, 1fr) auto;
		align-items: center;
		gap: 4px 16px;
	}
	.kv-l,
	.n {
		font-weight: 600;
	}
	.kv-v,
	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.kv-v {
		color: var(--ink-2);
	}
	.who {
		flex: 1 1 auto;
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
	.end {
		display: flex;
		justify-content: flex-end;
		min-width: 32px;
	}
	.kv-edit {
		grid-column: 2 / -1;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ie {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.ie .ti {
		flex: 1 1 14rem;
		width: auto;
	}
	.saved {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--good);
	}
	.lab {
		flex: 0 0 auto;
	}
	/* Label above value on a phone, the pencil beside both. */
	@media (max-width: 543px) {
		.kv {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.kv-l {
			grid-column: 1;
			grid-row: 1;
		}
		.kv-v {
			grid-column: 1;
			grid-row: 2;
		}
		.end {
			grid-column: 2;
			grid-row: 1 / span 2;
		}
		.kv-edit {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}
</style>
