<script lang="ts">
	import type { Snippet } from 'svelte';
	import Octicon from './Octicon.svelte';
	import type { Parsed } from './field-rules.ts';
	import { readJson, readProblem } from './json.ts';
	import { busy } from './busy.svelte.ts';

	/**
	 * One detail of a record, as Primer draws it in a box: its label, what it
	 * is, and a pencil that opens it in place -- the field, Save and Cancel --
	 * as Primer's saving pattern asks. Enter saves, Escape leaves it as it was.
	 *
	 * Checked here first with the same rule the server keeps (`validate`), so a
	 * wrong value costs no request; the server checks again regardless, and what
	 * it refuses is said under the field.
	 *
	 * A record kept on the phone first is sent its own way (`send`). Any other
	 * is saved here, and where it says which version of the row this screen
	 * read (`ifMatch`), the save is refused if somebody has saved the row since
	 * (RFC 9110 If-Match, #lib/server/concurrent): the screen is fetched again
	 * and the reason said, so Save puts this one over theirs and Cancel keeps
	 * theirs.
	 */
	let {
		name,
		label,
		value,
		shown,
		options = null,
		type = 'text',
		inputmode,
		placeholder,
		hint = '',
		caption,
		required = false,
		swatch = false,
		editable = true,
		endpoint,
		validate,
		onsaved,
		version,
		ifMatch,
		onconflict,
		send,
		oncancel
	}: {
		/** The field as the endpoint names it. */
		name: string;
		label: string;
		/** What the field holds, as it is sent. */
		value: string | null;
		/** How it reads when not being changed, where that is not the value itself. */
		shown?: string;
		options?: { value: string; label: string }[] | null;
		/** A text field's kind: "date" for a day, "email", "tel". */
		type?: 'text' | 'date' | 'email' | 'tel';
		inputmode?: 'decimal' | 'numeric';
		/** Greyed in the empty field: what an empty one stands for. */
		placeholder?: string;
		/** Under it, changed or not: what it means now. */
		hint?: string;
		/** Under the field while it is changed: what to put in it. */
		caption?: Snippet;
		required?: boolean;
		/** A colour: a square of it beside the value, and beside the field as it is typed. */
		swatch?: boolean;
		editable?: boolean;
		/** Where it saves, as { fields: { [name]: value } }. */
		endpoint: string;
		validate: (name: string, raw: string) => Parsed;
		/** After the server has kept it, with what it kept. */
		onsaved?: (value: string) => void | Promise<void>;
		/** The save the record is at, where it counts them, handed to `send`. */
		version?: number;
		/** The version of the row this screen read, sent as If-Match. */
		ifMatch?: string | null;
		/** Somebody saved the row since: the screen is fetched again. */
		onconflict?: () => void | Promise<void>;
		/**
		 * Where a record is changed on the phone first and sent by the queue
		 * (#lib/queue), how it is kept there: given what this detail is now and
		 * what it said, and the save it began from. A reason to show under the
		 * field, where the server refused it at once; nothing where it is kept.
		 */
		send?: (
			fields: Record<string, string>,
			version: number | undefined,
			base: Record<string, string>
		) => Promise<string | null>;
		/** Cancel, where it was refused: the change is let go. */
		oncancel?: () => void | Promise<void>;
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
	const about = $derived(error || caption || hint ? `${id}-c` : undefined);

	function edit() {
		draft = value ?? '';
		error = '';
		editing = true;
	}
	function leave() {
		if (error) void oncancel?.();
		editing = false;
		error = '';
	}
	async function save() {
		const parsed = validate(name, draft);
		if (!parsed.ok) return void (error = parsed.why);
		if (draft === (value ?? '')) return leave();
		saving = true;
		if (send) {
			const refused = await send({ [name]: draft }, version, { [name]: value ?? '' });
			saving = false;
			if (refused) return void (error = refused);
			await onsaved?.(draft);
			editing = false;
			return;
		}
		const r = await fetch(endpoint, {
			method: 'PATCH',
			headers: {
				'content-type': 'application/json',
				...(ifMatch ? { 'if-match': `"${ifMatch}"` } : {})
			},
			body: JSON.stringify({ fields: { [name]: draft } })
		}).catch(() => null);
		if (!r) {
			saving = false;
			return void (error = 'Not saved — no connection.');
		}
		if (!r.ok) {
			const problem = await readProblem(r);
			if (r.status === 412) await onconflict?.();
			saving = false;
			return void (error = problem.errors?.[name] ?? problem.detail ?? 'That did not save.');
		}
		const out = (await readJson(r).catch(() => null)) as { saved?: Record<string, unknown> } | null;
		const kept = out?.saved?.[name];
		await onsaved?.(
			typeof kept === 'string' || typeof kept === 'number' || typeof kept === 'boolean'
				? String(kept)
				: draft
		);
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
	/**
	 * The swatch's colour, set through the CSSOM: a style attribute is refused
	 * by the content security policy, and a colour typed a character at a time
	 * cannot be a class. One that is not a colour yet is simply not applied.
	 */
	function paint(node: HTMLElement, colour: string) {
		const set = (c: string) => node.style.setProperty('background', c || 'transparent');
		set(colour);
		return { update: set };
	}
	const focus = (node: HTMLElement) => {
		node.focus();
		if (node instanceof HTMLInputElement) node.select();
	};
</script>

<div class="box-row kv" data-detail={name} data-value={value ?? ''}>
	{#if editing}
		<label class="kv-l" for="{id}-f"
			>{label}{#if required}<span aria-hidden="true"> *</span>{/if}</label
		>
		<div class="kv-edit">
			<div class="kv-ie">
				{#if options}
					<select
						id="{id}-f"
						class="ti"
						bind:value={draft}
						aria-invalid={error ? 'true' : undefined}
						aria-describedby={about}
						onkeydown={keys}
						use:focus
					>
						{#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
					</select>
				{:else}
					{#snippet field()}
						<input
							id="{id}-f"
							class="ti"
							autocomplete="off"
							{type}
							{inputmode}
							{placeholder}
							{required}
							bind:value={draft}
							aria-invalid={error ? 'true' : undefined}
							aria-describedby={about}
							onkeydown={keys}
							use:focus
						/>
					{/snippet}
					{#if swatch}
						<span class="grow swatched">
							<i class="sw" aria-hidden="true" use:paint={draft}></i>{@render field()}
						</span>
					{:else}
						{@render field()}
					{/if}
				{/if}
				<button
					type="button"
					class="btn sm pri"
					onclick={save}
					{@attach busy(saving && `Saving ${label.toLowerCase()}`)}>Save</button
				>
				<button type="button" class="btn sm" onclick={leave} disabled={saving}>Cancel</button>
			</div>
			{#if error}
				<p class="fc-e" id="{id}-c"><Octicon name="alert" />{error}</p>
			{:else if caption}
				<p class="fc-c" id="{id}-c">{@render caption()}</p>
			{:else if hint}
				<p class="fc-c" id="{id}-c">{hint}</p>
			{/if}
		</div>
	{:else}
		<span class="kv-l">{label}</span>
		<span class="kv-v">
			<span>
				{#if swatch && value}<i class="sw" aria-hidden="true" use:paint={value}></i>{/if}
				{#if reads}{reads}{:else}<span class="muted">None</span>{/if}
				{#if saved}<span class="kv-saved" role="status"><Octicon name="check" />Saved</span>{/if}
			</span>
			{#if hint}<span class="kv-s">{hint}</span>{/if}
		</span>
		<span class="kv-end">
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
	/* A colour, as the square GitHub draws beside a label's. */
	.sw {
		display: inline-block;
		flex: 0 0 auto;
		width: 16px;
		height: 16px;
		margin-right: 6px;
		vertical-align: -3px;
		border: 1px solid var(--borderColor-default);
		border-radius: var(--borderRadius-small);
	}
	.swatched {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.swatched .ti {
		flex: 1 1 auto;
		min-width: 0;
	}
	.swatched .sw {
		width: 24px;
		height: 24px;
		margin: 0;
	}
</style>
