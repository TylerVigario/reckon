<script lang="ts">
	import {
		addressesAreLive,
		newSession,
		resolve,
		suggest,
		type Resolved,
		type Suggestion
	} from '$lib/google';
	import { readJson } from '$lib/json';
	import type { Verdict } from '$lib/verdict';

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
		onresolved,
		oncommit
	}: {
		label?: string;
		value?: string;
		placeId?: string | null;
		onresolved?: (a: Resolved) => void;
		/**
		 * The address is settled -- a place was chosen, or focus left a box
		 * somebody typed into. Fires once per settling, so a caller that saves
		 * on it does not save a half-typed street.
		 */
		oncommit?: (a: { value: string; placeId: string | null }) => void;
	} = $props();

	/**
	 * A choice is being resolved. Blur fires before the click that picked a
	 * suggestion finishes, so without this the field would commit what was
	 * typed and then commit again with what Google returned.
	 */
	let choosing = $state(false);

	const live = addressesAreLive;

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
		// A chosen place no longer describes what is in the box.
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
			onresolved?.(a);

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
		} finally {
			// Fetching the details ends the session; the next keystroke starts one.
			session = null;
			choosing = false;
			input?.focus();
			oncommit?.({ value, placeId });
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
	<label for="address-input">
		{label}
		{#if placeId}<span class="ok">✓ a real place</span>{/if}
	</label>
	<input
		bind:this={input}
		id="address-input"
		type="text"
		autocomplete="off"
		role="combobox"
		aria-expanded={open}
		aria-controls="address-list"
		aria-autocomplete="list"
		placeholder={live ? 'Start typing an address' : 'Address'}
		{value}
		oninput={(e) => typed(e.currentTarget.value)}
		onkeydown={key}
		onblur={() =>
			setTimeout(() => {
				open = false;
				// choose() commits for itself, with the resolved place rather
				// than whatever was half-typed before the click.
				if (!choosing) oncommit?.({ value, placeId });
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
		<span class="hint">PUBLIC_GOOGLE_MAPS_API_KEY is not set, so addresses are typed.</span>
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
	.addr {
		position: relative;
		display: grid;
		gap: 0.3rem;
	}
	label {
		font-size: 0.85rem;
		color: var(--ink-soft);
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
	}
	.ok {
		color: var(--good);
		font-size: 0.78rem;
	}
	input {
		font: inherit;
		color: var(--ink);
		background: var(--ground);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.55rem 0.65rem;
		width: 100%;
		box-sizing: border-box;
	}
	input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.hint {
		font-size: 0.78rem;
		color: var(--ink-faint);
	}
	.warn {
		color: var(--warn);
	}
	.good {
		color: var(--good);
	}
	ul {
		position: absolute;
		z-index: 5;
		top: 100%;
		left: 0;
		right: 0;
		margin: 0.25rem 0 0;
		padding: 0.25rem;
		list-style: none;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
		max-height: 15rem;
		overflow-y: auto;
	}
	li {
		padding: 0.55rem 0.6rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
	}
	li.active {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.attribution {
		cursor: default;
		display: flex;
		justify-content: flex-end;
		padding: 0.3rem 0.5rem 0.1rem;
		border-top: 1px solid var(--line);
		margin-top: 0.25rem;
	}
	.attribution img {
		opacity: 0.7;
	}
</style>
