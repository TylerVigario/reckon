<script lang="ts">
	import Octicon from './Octicon.svelte';
	import type { Parsed } from './field-rules.ts';
	import { readProblem } from './json.ts';

	/**
	 * One detail of a record, as Primer draws it in a box: its label, what it
	 * is, and a pencil that opens it in place -- the field, Save and Cancel --
	 * as a contact's details are. Enter saves, Escape leaves it as it was.
	 *
	 * Checked here first with the same rule the server keeps (`validate`), so a
	 * wrong value costs no request; the server checks again regardless, and what
	 * it refuses is said under the field.
	 */
	let {
		name,
		label,
		value,
		shown,
		options = null,
		type = 'text',
		inputmode,
		hint = '',
		required = false,
		editable = true,
		endpoint,
		validate,
		onsaved,
		version,
		onconflict
	}: {
		/** The field as the endpoint names it. */
		name: string;
		label: string;
		/** What the field holds, as it is sent. */
		value: string | null;
		/** How it reads when not being changed, where that is not the value itself. */
		shown?: string;
		options?: { value: string; label: string }[] | null;
		/** A text field's kind: "date" for a day. */
		type?: 'text' | 'date';
		inputmode?: 'decimal' | 'numeric';
		/** Under it: what it means. */
		hint?: string;
		required?: boolean;
		editable?: boolean;
		/** Where it saves, as { fields: { [name]: value } }. */
		endpoint: string;
		validate: (name: string, raw: string) => Parsed;
		/** After the server has kept it. */
		onsaved?: () => void | Promise<void>;
		/**
		 * The save the record is at, where it counts them: sent with what this
		 * detail said then, so a change someone made since is not written over
		 * unseen. Told of one, it says so and is fetched again; Save again puts
		 * this one over it, Cancel keeps theirs.
		 */
		version?: number;
		onconflict?: () => void | Promise<void>;
	} = $props();

	const id = $props.id();
	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);
	let error = $state('');
	let saved = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const reads = $derived(
		shown ?? (options ? options.find((o) => o.value === (value ?? ''))?.label : value) ?? ''
	);

	function edit() {
		draft = value ?? '';
		error = '';
		editing = true;
	}
	function leave() {
		editing = false;
		error = '';
	}
	async function save() {
		const parsed = validate(name, draft);
		if (!parsed.ok) return void (error = parsed.why);
		if (draft === (value ?? '')) return leave();
		saving = true;
		const r = await fetch(endpoint, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				fields: { [name]: draft },
				...(version === undefined ? {} : { version, base: { [name]: value ?? '' } })
			})
		}).catch(() => null);
		if (!r) {
			saving = false;
			return void (error = 'Not saved — no connection.');
		}
		if (!r.ok) {
			const problem = await readProblem(r);
			if (r.status === 409) await onconflict?.();
			saving = false;
			return void (error = problem.errors?.[name] ?? problem.detail ?? 'That did not save.');
		}
		await onsaved?.();
		saving = false;
		editing = false;
		saved = true;
		clearTimeout(timer);
		timer = setTimeout(() => (saved = false), 4000);
	}
	function keys(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void save();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			leave();
		}
	}
	const focus = (node: HTMLElement) => {
		node.focus();
		if (node instanceof HTMLInputElement) node.select();
	};
</script>

<div class="box-row kv">
	{#if editing}
		<label class="kv-l" for="{id}-f"
			>{label}{#if required}<span aria-hidden="true"> *</span>{/if}</label
		>
		<div class="kv-edit">
			<div class="ie">
				{#if options}
					<select
						id="{id}-f"
						class="ti"
						bind:value={draft}
						aria-invalid={error ? 'true' : undefined}
						aria-describedby={error || hint ? `${id}-c` : undefined}
						onkeydown={keys}
						use:focus
					>
						{#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
					</select>
				{:else}
					<input
						id="{id}-f"
						class="ti"
						autocomplete="off"
						{type}
						{inputmode}
						{required}
						bind:value={draft}
						aria-invalid={error ? 'true' : undefined}
						aria-describedby={error || hint ? `${id}-c` : undefined}
						onkeydown={keys}
						use:focus
					/>
				{/if}
				<button type="button" class="btn sm pri" onclick={save} disabled={saving}
					>{saving ? 'Saving…' : 'Save'}</button
				>
				<button type="button" class="btn sm" onclick={leave} disabled={saving}>Cancel</button>
			</div>
			{#if error}
				<p class="fc-e" id="{id}-c"><Octicon name="alert" />{error}</p>
			{:else if hint}
				<p class="fc-c" id="{id}-c">{hint}</p>
			{/if}
		</div>
	{:else}
		<span class="kv-l">{label}</span>
		<span class="kv-v">
			<span>
				{#if reads}{reads}{:else}<span class="muted">None</span>{/if}
				{#if saved}<span class="saved" role="status"><Octicon name="check" />Saved</span>{/if}
			</span>
			{#if hint}<span class="sub">{hint}</span>{/if}
		</span>
		<span class="end">
			{#if editable}
				<button
					type="button"
					class="ib"
					data-edit={name}
					aria-label="Change {label.toLowerCase()}"
					onclick={edit}><Octicon name="pencil" /></button
				>
			{/if}
		</span>
	{/if}
</div>

<style>
	.kv {
		display: grid;
		grid-template-columns: minmax(0, 30%) minmax(0, 1fr) auto;
		align-items: center;
		gap: 4px 16px;
		min-height: 56px;
		box-sizing: border-box;
	}
	.kv-l {
		font-weight: 600;
	}
	.kv-v {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--ink-2);
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
