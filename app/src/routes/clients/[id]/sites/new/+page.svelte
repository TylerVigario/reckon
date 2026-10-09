<script lang="ts">
	import { goto } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import { parseSiteField, SITE_FIELDS } from '#lib/site-fields.ts';
	import { toSlug } from '#lib/slug.ts';
	import type { PageProps } from './$types';
	import { readJson, readProblem } from '#lib/json.ts';
	import { resolve } from '$app/paths';
	import AddressField from '#lib/AddressField.svelte';
	import type { Resolved } from '#lib/google.ts';

	let { data }: PageProps = $props();

	/**
	 * A new site is one form, not a row that saves itself field by field.
	 *
	 * Everywhere else here saves on blur, because the thing already exists and
	 * a field is a correction to it. A site does not exist until CDTFA has
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
		round_trip_miles: miles,
		drive_minutes: minutes,
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

<Top
	title="New site"
	sub={data.client.name}
	trail={[
		{ href: resolve('/clients'), label: 'Entities' },
		{ href: resolve('/clients/[id]', { id: data.client.slug }), label: data.client.name },
		{ href: resolve('/clients/[id]/sites', { id: data.client.slug }), label: 'Sites' }
	]}
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h">
			<h2>Where the work happens</h2>
			<span class="sp"></span>
			<span class="chip">CDTFA prices it on save</span>
		</div>
		<div class="rows">
			<div class="rec add">
				<div class="rec-m">
					<label class="fld">
						<span>What this client calls it</span>
						<input class="inp" bind:value={label} placeholder="Main Street office" />
						{#if show('label')}<small class="bad">{show('label')}</small>{/if}
					</label>
					<label class="fld">
						<span>In the URL</span>
						<input
							class="inp"
							value={slug}
							placeholder="the-market"
							oninput={(e) => {
								slugTouched = true;
								slugTyped = toSlug(e.currentTarget.value);
							}}
						/>
						<small class="lt">
							/clients/{data.client.slug}/sites/{slug || '…'}
						</small>
						{#if show('slug')}<small class="bad">{show('slug')}</small>{/if}
					</label>
					<div class="fld">
						<AddressField label="Address" bind:value={address} onchosen={(a) => (chosen = a)} />
						{#if addressWhy}<small class="bad">{addressWhy}</small>{/if}
					</div>
					<div class="duo">
						<label class="fld">
							<span>Round trip, miles</span>
							<input class="inp" bind:value={miles} inputmode="decimal" placeholder="38" />
							{#if show('round_trip_miles')}
								<small class="bad">{show('round_trip_miles')}</small>
							{/if}
						</label>
						<label class="fld">
							<span>Drive time, minutes</span>
							<input class="inp" bind:value={minutes} inputmode="numeric" placeholder="44" />
							{#if show('drive_minutes')}<small class="bad">{show('drive_minutes')}</small>{/if}
						</label>
					</div>
					{#if saying}<div class="rec-s bad">{saying}</div>{/if}
					<div class="acts">
						<button class="btn pri" onclick={create} disabled={saving}>
							{saving ? 'Asking CDTFA…' : 'Create and price it'}
						</button>
						<a class="btn" href={resolve('/clients/[id]/sites', { id: data.client.slug })}>Cancel</a
						>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.rec.add .rec-m {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
	}
	.acts {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.bad {
		color: var(--crit);
	}
</style>
