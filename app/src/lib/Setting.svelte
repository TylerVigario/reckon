<script lang="ts">
	import { untrack } from 'svelte';
	import type { Parsed } from './field-rules';
	import { parseField } from './settings-fields';
	import { readJson, readProblem, type Saved } from '$lib/json';
	import type { ProblemLike } from '$lib/problem';

	/**
	 * One setting that saves itself.
	 *
	 * A text field commits when it loses focus or on Enter, not on every
	 * keystroke: half-typed input is not a value anybody meant, and saving
	 * "5591" on the way to a phone number writes three wrong rows before the
	 * right one. A select commits on change, because picking from a list is
	 * already the whole decision.
	 *
	 * Validation runs here first using the same module the server uses, which
	 * makes a bad value cost nothing -- no request, an answer as the focus
	 * leaves. It is not a substitute for the server's check; it is the fast
	 * half of the same rule.
	 */
	let {
		name,
		label,
		value = '',
		type = 'text',
		placeholder = '',
		hint = '',
		options = null,
		inputmode = undefined,
		required = false,
		swatch = false,
		endpoint = '/api/settings',
		key = '',
		validate = parseField,
		onsaved,
		version = null,
		onversion
	}: {
		name: string;
		label: string;
		value?: string | number | null;
		type?: string;
		placeholder?: string;
		hint?: string;
		options?: { value: string; label: string }[] | null;
		inputmode?: 'numeric' | 'decimal' | undefined;
		required?: boolean;
		swatch?: boolean;
		/**
		 * Called with what the server stored, after it stored it. For the one
		 * field whose value is part of the page's own address: saving a slug
		 * moves the URL, and a page left sitting on the old one is a reload
		 * away from a 404.
		 */
		onsaved?: (value: string) => void;
		/**
		 * The row version this page read, sent as If-Match so a save cannot
		 * silently overwrite somebody else's. Null means the endpoint does not
		 * check -- not that this one may skip it.
		 */
		version?: string | null;
		/** The version after a successful save, so the next field can use it. */
		onversion?: (version: string) => void;
		/** Where this field saves. Settings by default; a service says its own. */
		endpoint?: string;
		/** Distinguishes fields of the same name on one page -- one row per service. */
		key?: string;
		/**
		 * The vocabulary this field belongs to. It has to travel with the
		 * endpoint: a field saving to /api/services is not an operator setting,
		 * and checking it against the operator's rules answers "there is no
		 * setting called that" for a field that plainly exists.
		 */
		validate?: (name: string, raw: string) => Parsed;
	} = $props();

	// untrack: the prop seeds the box once. After that the box is the truth --
	// a later re-render of the page must not reach in and overwrite what
	// somebody is in the middle of typing.
	const initial = untrack(() => (value === null || value === undefined ? '' : String(value)));

	let current = $state(initial);
	/** What the database is known to hold, so an unchanged field sends nothing. */
	let stored = $state(initial);
	let status = $state<'idle' | 'saving' | 'ok' | 'bad'>('idle');
	let why = $state('');
	let clearOk: ReturnType<typeof setTimeout> | undefined;

	const id = $derived(`set-${key ? `${key}-` : ''}${name}`);

	async function commit() {
		const sent = current;
		if (sent === stored) {
			status = 'idle';
			why = '';
			return;
		}

		const parsed = validate(name, sent);
		if (!parsed.ok) {
			status = 'bad';
			why = parsed.why;
			return;
		}

		clearTimeout(clearOk);
		status = 'saving';
		why = '';
		try {
			const r = await fetch(endpoint, {
				method: 'PATCH',
				headers: {
					'content-type': 'application/json',
					...(version ? { 'if-match': `"${version}"` } : {})
				},
				body: JSON.stringify({ fields: { [name]: sent } })
			});
			const out = r.ok ? ((await readJson(r).catch(() => ({}))) as Saved) : await readProblem(r);

			if (r.ok) {
				const back = (out as Saved).saved?.[name];
				const canonical = back === null || back === undefined ? '' : String(back);
				// Only if the box still holds what was sent: the server may
				// answer after someone has started typing again, and their
				// keystrokes outrank an echo of the previous value.
				if (current === sent) current = canonical;
				stored = canonical;
				status = 'ok';
				// Every field on this row shares one version, so a save by any
				// of them moves it for all of them -- otherwise the second
				// field to save would be told it was stale by the first.
				const v = (out as Saved).version;
				if (v) onversion?.(v);
				onsaved?.(canonical);
				clearOk = setTimeout(() => {
					if (status === 'ok') status = 'idle';
				}, 2500);
			} else {
				status = 'bad';
				// Keyed by field first, because that is the shape the endpoint
				// uses for anything it can attribute. Then the problem
				// document's own detail, then its title -- RFC 9457 guarantees
				// a title and makes detail optional, so the fallback runs that
				// way round rather than the other.
				const { errors, detail, title } = out as ProblemLike;
				const keyed = errors?.[name];
				const first = errors ? Object.values(errors)[0] : null;
				why =
					r.status === 412
						? (detail ?? 'Somebody else changed this. Reload before saving again.')
						: (keyed ?? first ?? detail ?? title ?? `Not saved (${r.status}).`);
			}
		} catch {
			// The value stays in the box and `stored` still holds the old one,
			// so leaving the field again retries rather than losing the edit.
			status = 'bad';
			why = 'Not saved — no connection.';
		}
	}

	function keys(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLElement).blur();
		} else if (e.key === 'Escape') {
			current = stored;
			status = 'idle';
			why = '';
		}
	}
</script>

<div class="fld" class:bad={status === 'bad'}>
	<label for={id}>
		{label}
		<span class="state" aria-live="polite">
			{#if status === 'saving'}Saving…{:else if status === 'ok'}Saved{/if}
		</span>
	</label>

	{#if options}
		<select
			class="inp"
			{id}
			{name}
			bind:value={current}
			onchange={commit}
			aria-invalid={status === 'bad'}
			aria-describedby={status === 'bad' ? `${id}-why` : undefined}
		>
			{#each options as o (o.value)}
				<option value={o.value}>{o.label}</option>
			{/each}
		</select>
	{:else if swatch}
		<span class="swatch">
			<input
				class="inp"
				{id}
				{name}
				{type}
				{placeholder}
				{required}
				bind:value={current}
				onblur={commit}
				onkeydown={keys}
				aria-invalid={status === 'bad'}
				aria-describedby={status === 'bad' ? `${id}-why` : undefined}
			/>
			<i style="background: {current || 'var(--ink-faint)'}"></i>
		</span>
	{:else}
		<input
			class="inp"
			{id}
			{name}
			{type}
			{placeholder}
			{required}
			{inputmode}
			bind:value={current}
			onblur={commit}
			onkeydown={keys}
			aria-invalid={status === 'bad'}
			aria-describedby={status === 'bad' ? `${id}-why` : undefined}
		/>
	{/if}

	{#if status === 'bad'}
		<small class="why" id="{id}-why">{why}</small>
	{:else if hint}
		<small>{hint}</small>
	{/if}
</div>

<style>
	/* .fld and .inp come from the shell. What is here is the saving state and
	   the complaint, which are this component's and nothing else's. */
	.fld > label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.state {
		font-size: 10px;
		color: var(--ink-3);
		/* Reserved whether or not it says anything, so a field does not shift
		   the ones under it the moment it saves. */
		min-height: 1em;
	}
	.bad :global(.inp) {
		border-color: var(--warn);
	}
	.why {
		color: var(--warn);
		font-size: 12px;
	}
	.swatch {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.swatch i {
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 6px;
		border: 1px solid var(--line);
		flex: none;
	}
</style>
