<script lang="ts">
	import {
		addressesAreLive,
		newSession,
		resolve,
		suggest,
		type Resolved,
		type Suggestion
	} from '#lib/google.ts';
	import { readJson } from '#lib/json.ts';
	import type { Verdict } from '#lib/verdict.ts';
	import { onMount, untrack } from 'svelte';

	/**
	 * An address, chosen rather than typed.
	 *
	 * Through the Maps JavaScript SDK, not the REST endpoints. Both call Google
	 * from the browser -- which is what a type-ahead needs, since proxying would
	 * put a round trip to our own server in front of every keystroke -- but only
	 * the SDK's key can be restricted. Referrer restrictions apply to the
	 * JavaScript API because browsers send the header; a web-service call wants
	 * an IP restriction, which cannot mean anything when the caller is somebody
	 * else's browser.
	 *
	 * Picking a real place is most of what validating one would do, and it comes
	 * back already split -- street, city, region, postcode. That split is what a
	 * tax district is resolved from, and Reg 1826 puts district tax at the
	 * jobsite.
	 */
	let {
		label = 'Address',
		value = $bindable<string>(''),
		placeId = $bindable<string | null>(null),
		onchosen
	}: {
		label?: string;
		value?: string;
		placeId?: string | null;
		/**
		 * A place was chosen from Google's suggestions and its parts fetched:
		 * the one moment an address changes (8 October 2026). Typing alone
		 * never does.
		 */
		onchosen?: (a: Resolved) => void;
	} = $props();

	/**
	 * AN ADDRESS IS CHOSEN, NEVER TYPED, and only with Google to choose from.
	 * What is typed is a question to Google's suggestions; leaving the box
	 * without choosing one puts back the address that was there. With no key,
	 * or no connection, the box says so and takes nothing: there is no address
	 * to be had without Google, so there is no typed one standing in for it.
	 */
	const live = addressesAreLive;
	let kept = $state({ value: untrack(() => value), placeId: untrack(() => placeId) });
	let online = $state(true);
	let notChosen = $state(false);
	onMount(() => {
		online = navigator.onLine;
		const on = () => (online = true);
		const off = () => (online = false);
		addEventListener('online', on);
		addEventListener('offline', off);
		return () => {
			removeEventListener('online', on);
			removeEventListener('offline', off);
		};
	});
	const usable = $derived(live && online);

	/**
	 * A choice is being resolved. Blur fires before the click that picked a
	 * suggestion finishes, so without this the field would put back the old
	 * address and then take Google's.
	 */
	let choosing = $state(false);

	// What validation said about the chosen address, if a server key exists.
	let verdict = $state<Verdict | null>(null);

	let suggestions = $state<Suggestion[]>([]);
	let open = $state(false);
	let active = $state(0);
	let failed = $state<string | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let seq = 0;

	// One session covers every keystroke plus the details call that ends it, and
	// Google bills it as a unit rather than per request.
	let session: google.maps.places.AutocompleteSessionToken | null = null;

	async function look(q: string) {
		if (!live || q.trim().length < 3) {
			suggestions = [];
			open = false;
			return;
		}
		// Responses do not arrive in the order they were asked for. Without this
		// a slower earlier answer overwrites a newer one, which reads as the
		// field fighting whoever is typing.
		const mine = ++seq;
		failed = null;
		try {
			session ??= await newSession();
			const found = await suggest(q, session);
			if (mine !== seq) return;
			suggestions = found;
			open = found.length > 0;
			active = 0;
		} catch (e) {
			if (mine !== seq) return;
			failed = (e as Error).message;
			suggestions = [];
		}
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	function typed(v: string) {
		value = v;
		notChosen = false;
		// What is in the box is a question now, not a place.
		placeId = null;
		clearTimeout(timer);
		timer = setTimeout(() => void look(v), 200);
	}

	async function choose(s: Suggestion) {
		open = false;
		suggestions = [];
		verdict = null;
		choosing = true;
		try {
			const a = await resolve(s);
			value = a.formatted;
			placeId = a.placeId;
			kept = { value, placeId };
			onchosen?.(a);

			// Once per address, on the server, with the other key. Choosing a
			// place says it exists; this says it is deliverable. It never blocks
			// the choice -- a verdict is information, and the address is already
			// one Google returned.
			try {
				const r = await fetch('/api/address', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						street: a.street,
						city: a.city,
						region: a.region,
						postcode: a.postcode,
						country: a.country
					})
				});
				if (r.ok) verdict = ((await readJson(r)) as { verdict: Verdict | null }).verdict;
			} catch {
				// Unvalidated is not invalid.
			}
		} catch (e) {
			failed = (e as Error).message;
			({ value, placeId } = kept);
		} finally {
			// Fetching the details ends the session; the next keystroke starts one.
			session = null;
			choosing = false;
			input?.focus();
		}
	}

	function key(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + suggestions.length) % suggestions.length;
		} else if (e.key === 'Enter' && suggestions[active]) {
			e.preventDefault();
			void choose(suggestions[active]);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="addr">
	{#if label}
		<label for="address-input">
			{label}
			{#if placeId}<span class="ok">A real place</span>{/if}
		</label>
	{/if}
	<input
		bind:this={input}
		id="address-input"
		type="text"
		autocomplete="off"
		role="combobox"
		aria-expanded={open}
		aria-controls="address-list"
		aria-autocomplete="list"
		placeholder={usable ? 'Start typing, then choose the address' : ''}
		disabled={!usable}
		{value}
		oninput={(e) => typed(e.currentTarget.value)}
		onkeydown={key}
		onblur={() =>
			setTimeout(() => {
				open = false;
				// Left without choosing: what was typed was never an address.
				if (!choosing && value !== kept.value) {
					({ value, placeId } = kept);
					notChosen = true;
				}
			}, 160)}
	/>

	{#if failed}<span class="hint warn">{failed}</span>{/if}
	{#if verdict}
		{#if verdict.complete && !verdict.corrected}
			<span class="hint good">Validated — deliverable as written.</span>
		{:else if verdict.corrected && verdict.formatted}
			<span class="hint warn">
				Validation standardised this to <b>{verdict.formatted}</b>.
			</span>
		{:else if verdict.unconfirmed.length}
			<span class="hint warn">
				Could not confirm: {verdict.unconfirmed.join(', ')}.
			</span>
		{:else}
			<span class="hint warn">Validation could not confirm this address.</span>
		{/if}
	{/if}
	{#if !live}
		<span class="hint warn">No Google key is set here, so no address can be looked up.</span>
	{:else if !online}
		<span class="hint warn">Looking an address up needs a connection.</span>
	{:else if notChosen}
		<span class="hint warn">Not changed: an address is one of Google's suggestions.</span>
	{/if}

	{#if open}
		<ul id="address-list" role="listbox" aria-label={label}>
			{#each suggestions as s, i (s.placeId)}
				<li
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					onpointerdown={(e) => {
						e.preventDefault();
						void choose(s);
					}}
					onpointerenter={() => (active = i)}
				>
					{s.text}
				</li>
			{/each}
			<!-- Required: predictions shown without a map must carry the logo. The
			     widget gets this for free; a dropdown of one's own does not. -->
			<li class="attribution" aria-hidden="true">
				<img
					alt=""
					width="52"
					height="7"
					src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MiA3Ij48dGV4dCB4PSIwIiB5PSI2IiBmb250LWZhbWlseT0iQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSI3IiBmaWxsPSIjNWY2MzY4Ij5Hb29nbGU8L3RleHQ+PC9zdmc+"
				/>
			</li>
		</ul>
	{/if}
</div>

<style>
	/* Primer's FormControl: its label above the field, its TextInput, and its
	   caption under it, in the colour of what it says. */
	.addr {
		position: relative;
		display: grid;
		gap: var(--base-size-6);
	}
	label {
		display: flex;
		gap: var(--base-size-8);
		align-items: baseline;
		font-size: var(--text-body-size-medium);
		font-weight: var(--base-text-weight-semibold);
		color: var(--fgColor-default);
	}
	.ok {
		font-size: var(--text-body-size-small);
		font-weight: var(--base-text-weight-normal);
		color: var(--fgColor-success);
	}
	input {
		width: 100%;
		min-height: max(var(--control-medium-size), var(--control-minTarget-auto, 0px));
		box-sizing: border-box;
		padding: 0 var(--base-size-12);
		font: inherit;
		font-size: var(--text-body-size-medium);
		color: var(--fgColor-default);
		background: var(--bgColor-default);
		border: 1px solid var(--borderColor-default);
		border-radius: var(--borderRadius-medium);
	}
	input:disabled {
		color: var(--fgColor-disabled);
		background: var(--bgColor-disabled);
		cursor: not-allowed;
	}
	input:focus-visible {
		outline: 2px solid var(--focus-outlineColor);
		outline-offset: -1px;
		border-color: var(--borderColor-accent-emphasis);
	}
	.hint {
		font-size: var(--text-body-size-small);
		color: var(--fgColor-muted);
	}
	.warn {
		color: var(--fgColor-attention);
	}
	.good {
		color: var(--fgColor-success);
	}
	/* Primer's ActionList in an overlay: the suggestions, the one pointed at
	   shaded. */
	ul {
		position: absolute;
		z-index: 5;
		top: 100%;
		left: 0;
		right: 0;
		margin: var(--base-size-4) 0 0;
		padding: var(--base-size-8);
		list-style: none;
		background: var(--overlay-bgColor);
		border: 1px solid var(--borderColor-default);
		border-radius: var(--borderRadius-large);
		box-shadow: var(--shadow-floating-small);
		max-height: 15rem;
		overflow-y: auto;
	}
	li {
		padding: var(--base-size-8);
		border-radius: var(--borderRadius-medium);
		cursor: pointer;
	}
	li.active {
		background: var(--control-transparent-bgColor-hover);
	}
	.attribution {
		cursor: default;
		display: flex;
		justify-content: flex-end;
		padding: var(--base-size-4) var(--base-size-8) 0;
		border-top: 1px solid var(--borderColor-muted);
		margin-top: var(--base-size-4);
		border-radius: 0;
	}
	.attribution img {
		opacity: 0.7;
	}
	@media (pointer: coarse) {
		input {
			min-height: 44px;
			/* iOS zooms into a field set smaller than this. */
			font-size: 16px;
		}
	}
</style>
