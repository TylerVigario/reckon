<script lang="ts">
	import { goto } from '$app/navigation';
	import Top from '$lib/Top.svelte';
	import { parseSiteField, SITE_FIELDS } from '$lib/site-fields';
	import { toSlug } from '$lib/slug';
	import type { PageProps } from './$types';
	import { readJson, readProblem } from '$lib/json';
	import { resolve } from '$app/paths';

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
	 * Derived rather than hidden: seeing /sites/the-shoppe appear as you type
	 * "The Shoppe" is how you find out the rule exists, and the moment to
	 * disagree with it is before the thing is created, not after -- changing it
	 * later moves an address that may already have been shared.
	 *
	 * Once edited it stays edited. A field that snaps back to following the
	 * name is a field that throws away what you just typed.
	 */
	let slugTouched = $state(false);
	let slugTyped = $state('');
	const slug = $derived(slugTouched ? slugTyped : toSlug(label));
	let street = $state('');
	let city = $state('');
	let region = $state('CA');
	let postcode = $state('');
	let miles = $state('');
	let minutes = $state('');

	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	const fields = $derived({
		label,
		slug,
		street,
		city,
		region,
		postcode,
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
						<input class="inp" bind:value={label} placeholder="The Shoppe" />
						{#if show('label')}<small class="bad">{show('label')}</small>{/if}
					</label>
					<label class="fld">
						<span>In the URL</span>
						<input
							class="inp"
							value={slug}
							placeholder="the-shoppe"
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
					<label class="fld">
						<span>Street</span>
						<input class="inp" bind:value={street} placeholder="36005 CA-99 N" />
						{#if show('street')}<small class="bad">{show('street')}</small>{/if}
					</label>
					<div class="trio">
						<label class="fld">
							<span>City</span>
							<input class="inp" bind:value={city} placeholder="Traver" />
							{#if show('city')}<small class="bad">{show('city')}</small>{/if}
						</label>
						<label class="fld">
							<span>State</span>
							<input class="inp" bind:value={region} />
							{#if show('region')}<small class="bad">{show('region')}</small>{/if}
						</label>
						<label class="fld">
							<span>Postcode</span>
							<input class="inp" bind:value={postcode} inputmode="numeric" placeholder="93673" />
							{#if show('postcode')}<small class="bad">{show('postcode')}</small>{/if}
						</label>
					</div>
					<div class="duo">
						<label class="fld">
							<span>Round trip, miles</span>
							<input class="inp" bind:value={miles} inputmode="decimal" placeholder="52" />
							{#if show('round_trip_miles')}
								<small class="bad">{show('round_trip_miles')}</small>
							{/if}
						</label>
						<label class="fld">
							<span>Drive time, minutes</span>
							<input class="inp" bind:value={minutes} inputmode="numeric" placeholder="62" />
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
	.trio {
		display: grid;
		gap: 12px;
	}
	@media (min-width: 560px) {
		.trio {
			grid-template-columns: 2fr 1fr 1fr;
		}
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
