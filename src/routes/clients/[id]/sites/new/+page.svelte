<script lang="ts">
	import { goto } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import { parseSiteField, SITE_FIELDS } from '#lib/site-fields.ts';
	import { toSlug } from '#lib/slug.ts';
	import type { PageProps } from './$types';
	import { readJson, readProblem } from '#lib/json.ts';
	import { resolve } from '$app/paths';
	import AddressField from '#lib/AddressField.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import type { Resolved } from '#lib/google.ts';
	import { busy } from '#lib/busy.svelte.ts';

	let { data }: PageProps = $props();

	/**
	 * A new site is one form, not details changed one at a time.
	 *
	 * A site's Details are changed one at a time, because it already exists
	 * and each is a correction to it. A site does not exist until CDTFA has
	 * priced its address, and the address is three fields -- so there is
	 * nothing to save until all of them are in, and asking CDTFA after each
	 * keystroke would be asking about addresses nobody means.
	 */
	let label = $state('');

	/**
	 * The URL follows the name until somebody touches it, and then stops.
	 *
	 * Derived rather than hidden: seeing /sites/main-street-office appear as you type
	 * "Main Street office" is how you find out the rule exists, and the moment to
	 * disagree with it is before the thing is created, not after -- changing it
	 * later moves an address that may already have been shared.
	 *
	 * Once edited it stays edited. A field that snaps back to following the
	 * name is a field that throws away what you just typed.
	 */
	let slugTouched = $state(false);
	let slugTyped = $state('');
	const slug = $derived(slugTouched ? slugTyped : toSlug(label));
	// THE ADDRESS IS ONE FIELD (8 October 2026), chosen from Google's
	// suggestions: its parts are Google's for the place chosen, sent with the
	// place's id for the server to confirm, and never typed.
	let address = $state('');
	let chosen = $state<Resolved | null>(null);
	let miles = $state('');
	let minutes = $state('');

	/**
	 * HOW FAR IT IS, AS SOON AS IT IS CHOSEN (8 October 2026): Google's route
	 * from the business and back, greyed in the boxes until something is typed
	 * over it, and named under them once it is (12 October 2026). A place chosen
	 * again is somewhere else, so what was typed goes with it.
	 */
	let google = $state<{ miles: string | null; minutes: number | null } | null>(null);
	let measured = $state('');
	let asking = 0;
	async function choose(a: Resolved) {
		chosen = a;
		const mine = ++asking;
		google = null;
		miles = minutes = '';
		measured = 'Asking Google how far it is…';
		const r = await fetch('/api/sites/drive', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { google_place_id: a.placeId } })
		}).catch(() => null);
		const d = r?.ok
			? ((await readJson(r).catch(() => null)) as {
					google_round_trip_miles: string | null;
					google_drive_minutes: number | null;
					why: string | null;
				} | null)
			: null;
		// Another place was chosen while this one was being asked about.
		if (mine !== asking) return;
		google =
			d?.why === null
				? { miles: d.google_round_trip_miles, minutes: d.google_drive_minutes }
				: null;
		measured = !d
			? 'Google could not be asked how far it is. Type it if you know it.'
			: (d.why ?? '');
	}

	/** What the line under the boxes says once Google has answered: whose each figure is. */
	const whose = $derived.by(() => {
		if (!google) return measured;
		if (!miles.trim() && !minutes.trim())
			return "Google's route from the business: there and back, and one way. Type yours to use it instead.";
		const of = (typed: string, name: string, theirs: string | number | null) =>
			typed.trim() ? `${name} is yours; Google's route is ${theirs}.` : `${name} is Google's.`;
		return `${of(miles, 'Round trip', google.miles)} ${of(minutes, 'Drive time', google.minutes)} Empty a box to use Google's.`;
	});

	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	const fields = $derived({
		label,
		slug,
		street: chosen?.street ?? '',
		city: chosen?.city ?? '',
		region: chosen?.region ?? '',
		postcode: chosen?.postcode ?? '',
		google_place_id: chosen?.placeId ?? '',
		typed_round_trip_miles: miles,
		typed_drive_minutes: minutes,
		active: 'true'
	});

	// The same rules the endpoint uses, run here so a mistake costs nothing.
	const localErrors = $derived(
		Object.fromEntries(
			Object.keys(SITE_FIELDS)
				.map((name) => {
					const parsed = parseSiteField(name, String(fields[name as keyof typeof fields] ?? ''));
					return parsed.ok ? null : [name, parsed.why];
				})
				.filter(Boolean) as [string, string][]
		)
	);
	const ready = $derived(Object.keys(localErrors).length === 0);

	async function create() {
		errors = localErrors;
		saying = '';
		if (!ready) return;
		saving = true;
		const r = await fetch(`/api/clients/${data.client.slug}/sites`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		});
		saving = false;
		if (!r.ok) {
			const b = await readProblem(r);
			errors = b.errors ?? {};
			saying = b.detail ?? b.title ?? (Object.keys(errors).length ? '' : 'That did not save.');
			return;
		}
		const made = (await readJson(r)) as { slug?: string };
		if (!made.slug) {
			saying = 'Saved, but the server did not say where it went.';
			return;
		}
		await goto(resolve('/clients/[id]/sites/[site]', { id: data.client.slug, site: made.slug }));
	}

	const show = (name: string) => errors[name] ?? '';
	// What is wrong with the address, whichever of its parts it is about.
	const addressWhy = $derived(
		['google_place_id', 'street', 'city', 'region', 'postcode'].map(show).find(Boolean) ?? ''
	);
</script>

{#snippet wrong(key: string)}
	{#if show(key)}
		<p class="fc-e" id="n-{key}-e"><Octicon name="alert" />{show(key)}</p>
	{/if}
{/snippet}

<Top
	title="New site"
	sub={data.client.name}
	trail={[
		{ href: resolve('/clients'), label: 'Entities' },
		{ href: resolve('/clients/[id]', { id: data.client.slug }), label: data.client.name },
		{ href: resolve('/clients/[id]/sites', { id: data.client.slug }), label: 'Sites' }
	]}
/>

<div class="pad primer">
	<form
		class="box"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			void create();
		}}
	>
		<div class="box-row form">
			<div class="fc">
				<label class="fc-l" for="n-label">Name<span aria-hidden="true"> *</span></label>
				<input
					id="n-label"
					class="ti"
					autocomplete="off"
					required
					bind:value={label}
					aria-invalid={show('label') ? 'true' : undefined}
					aria-describedby={show('label') ? 'n-label-e' : 'n-label-c'}
				/>
				{#if show('label')}
					{@render wrong('label')}
				{:else}
					<p class="fc-c" id="n-label-c">What this client calls it: Main Street office.</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="n-slug">In the URL<span aria-hidden="true"> *</span></label>
				<input
					id="n-slug"
					class="ti"
					autocomplete="off"
					required
					value={slug}
					oninput={(e) => {
						slugTouched = true;
						slugTyped = toSlug(e.currentTarget.value);
					}}
					aria-invalid={show('slug') ? 'true' : undefined}
					aria-describedby={show('slug') ? 'n-slug-e' : 'n-slug-c'}
				/>
				{#if show('slug')}
					{@render wrong('slug')}
				{:else}
					<p class="fc-c" id="n-slug-c">/clients/{data.client.slug}/sites/{slug || '…'}</p>
				{/if}
			</div>
			<div class="fc">
				<AddressField label="Address" bind:value={address} onchosen={choose} />
				{#if addressWhy}<p class="fc-e"><Octicon name="alert" />{addressWhy}</p>{/if}
			</div>
			<div class="duo">
				<div class="fc">
					<label class="fc-l" for="n-miles">Round trip, miles</label>
					<input
						id="n-miles"
						class="ti"
						autocomplete="off"
						inputmode="decimal"
						bind:value={miles}
						placeholder={google?.miles ?? ''}
						aria-invalid={show('typed_round_trip_miles') ? 'true' : undefined}
						aria-describedby={show('typed_round_trip_miles')
							? 'n-typed_round_trip_miles-e'
							: 'n-whose'}
					/>
					{@render wrong('typed_round_trip_miles')}
				</div>
				<div class="fc">
					<label class="fc-l" for="n-minutes">Drive time, minutes</label>
					<input
						id="n-minutes"
						class="ti"
						autocomplete="off"
						inputmode="numeric"
						bind:value={minutes}
						placeholder={google?.minutes === null || google?.minutes === undefined
							? ''
							: String(google.minutes)}
						aria-invalid={show('typed_drive_minutes') ? 'true' : undefined}
						aria-describedby={show('typed_drive_minutes') ? 'n-typed_drive_minutes-e' : 'n-whose'}
					/>
					{@render wrong('typed_drive_minutes')}
				</div>
			</div>
			<p class="fc-c" id="n-whose">
				{whose || 'Google works these out once the address is chosen.'}
			</p>
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" {@attach busy(saving && 'Asking CDTFA')}
				>Create and price it</button
			>
			<a class="btn" href={resolve('/clients/[id]/sites', { id: data.client.slug })}>Cancel</a>
			<p class="fc-c">CDTFA prices it as it is made.</p>
			{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
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
	.duo {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		max-width: 440px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--bgColor-muted);
	}
	.keep .fc-c,
	.keep .fc-e {
		flex: 1 0 100%;
	}
</style>
