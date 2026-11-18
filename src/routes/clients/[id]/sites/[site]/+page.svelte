<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import Detail from '#lib/Detail.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import AddressField from '#lib/AddressField.svelte';
	import { parseSiteField } from '#lib/site-fields.ts';
	import { miles } from '#lib/format.ts';
	import { readJson, readProblem } from '#lib/json.ts';
	import { resolve } from '$app/paths';
	import type { Resolved } from '#lib/google.ts';
	import type { PageProps } from './$types';

	/**
	 * A site's Details, each changed in place (#lib/Detail): what it is -- what
	 * the client calls it, its address in the app -- and where it is, and how
	 * far. Each save
	 * says the version of the site this screen read, so one somebody saved since
	 * is not written over unseen. Someone with Field reads where it is, and
	 * changes nothing (#lib/access).
	 */
	let { data }: PageProps = $props();
	const s = $derived(data.site);
	const field = $derived(data.user?.access === 'field');
	const endpoint = $derived(`/api/clients/${s.client_slug}/sites/${s.slug}`);
	const again = () => refreshAll();

	/**
	 * THE ADDRESS IS ONE FIELD (8 October 2026). Choosing a place saves it
	 * whole -- its parts as Google gave them and the place's id -- so CDTFA is
	 * asked once, where it is in California and the business collects there,
	 * and Google's route measures the drive again; the address, the round trip
	 * and the drive time are drawn afresh from the site as saved.
	 */
	const addressLine = $derived(
		`${s.street}, ${s.city}, ${s.region ?? ''} ${s.postcode}`.replace(/\s+/g, ' ').trim()
	);
	let moving = $state(false);
	let moved = $state<'' | 'saving' | 'bad'>('');
	// Where it is moving to, while it is saved.
	let movingTo = $state<string | null>(null);
	const cdtfa = $derived(data.collects.includes('CA'));
	let movedWhy = $state('');
	// Why the drive was not measured, when it was asked for and could not be.
	let unmeasured = $state('');

	async function moveTo(a: Resolved) {
		moved = 'saving';
		movingTo = a.region;
		const r = await fetch(endpoint, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'if-match': `"${s.version}"` },
			body: JSON.stringify({
				fields: {
					street: a.street ?? '',
					city: a.city ?? '',
					region: a.region ?? '',
					postcode: a.postcode ?? '',
					google_place_id: a.placeId
				}
			})
		}).catch(() => null);
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			if (r?.status === 412) await refreshAll();
			moved = 'bad';
			movedWhy = r
				? (Object.values(p?.errors ?? {})[0] ?? p?.detail ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		const done = (await readJson(r).catch(() => null)) as { unmeasured?: string | null } | null;
		unmeasured = done?.unmeasured ?? '';
		moved = '';
		moving = false;
		await refreshAll();
	}

	/**
	 * GOOGLE'S STAYS IN VIEW (12 October 2026). What was typed is used over
	 * Google's route; while nothing is, Google's is, greyed in the empty field;
	 * once something is, the line under it says what Google's was.
	 */
	function whose(typed: string | number | null, google: string | number | null, unit: string) {
		if (typed !== null && typed !== '')
			return google === null
				? 'Yours. Google has not measured it.'
				: `Yours. Google’s route is ${google} ${unit}.`;
		return google === null ? 'Google has not measured it.' : 'Google’s route.';
	}
	const roundTrip = $derived(s.typed_round_trip_miles ?? s.google_round_trip_miles);
	const driveMinutes = $derived(s.typed_drive_minutes ?? s.google_drive_minutes);
</script>

<section class="box" aria-labelledby="what-h">
	<div class="box-h"><h2 class="box-t" id="what-h">What it is</h2></div>
	<Detail
		name="label"
		label="Name"
		value={s.label}
		required
		editable={!field}
		{endpoint}
		ifMatch={s.version}
		onconflict={again}
		validate={parseSiteField}
		onsaved={again}
	>
		{#snippet caption()}What this client calls it.{/snippet}
	</Detail>
	{#if !field}
		<Detail
			name="slug"
			label="In the URL"
			value={s.slug}
			required
			{endpoint}
			ifMatch={s.version}
			onconflict={again}
			validate={parseSiteField}
			onsaved={(slug) =>
				goto(resolve('/clients/[id]/sites/[site]', { id: s.client_slug, site: slug }), {
					replace: true
				})}
		>
			{#snippet caption()}
				Its screens’ address. A link somebody kept stops working once it changes.
			{/snippet}
		</Detail>
	{/if}
</section>

<section class="box" aria-labelledby="where-h">
	<div class="box-h"><h2 class="box-t" id="where-h">Where it is</h2></div>
	<div class="box-row kv">
		{#if moving}
			<label class="kv-l" for="address-input">Address</label>
			<div class="kv-edit">
				<div class="kv-ie">
					{#key addressLine + (s.google_place_id ?? '')}
						<div class="grow">
							<AddressField
								label=""
								value={addressLine}
								placeId={s.google_place_id}
								onchosen={moveTo}
							/>
						</div>
					{/key}
					<button
						type="button"
						class="btn sm"
						disabled={moved === 'saving'}
						onclick={() => ((moving = false), (moved = ''))}>Cancel</button
					>
				</div>
				{#if moved === 'saving'}
					<p class="fc-c">
						{cdtfa && movingTo === 'CA'
							? 'Asking CDTFA, and Google how far it is…'
							: 'Asking Google how far it is…'}
					</p>
				{:else if moved === 'bad'}
					<p class="fc-e"><Octicon name="alert" />{movedWhy}</p>
				{:else}
					<p class="fc-c">
						{cdtfa
							? 'Choosing a place saves it, and in California asks CDTFA what is charged there.'
							: 'Choosing a place saves it.'}
					</p>
				{/if}
			</div>
		{:else}
			<span class="kv-l">Address</span>
			<span class="kv-v">
				<span
					>{#if addressLine}{addressLine}{:else}<span class="muted">None</span>{/if}</span
				>
				{#if unmeasured}<span class="kv-s warn">{unmeasured}</span>{/if}
			</span>
			<span class="kv-end">
				{#if !field}
					<button
						type="button"
						class="ib"
						data-edit="address"
						aria-label="Change address"
						onclick={() => (moving = true)}><Octicon name="pencil" /></button
					>
				{/if}
			</span>
		{/if}
	</div>

	<Detail
		name="typed_round_trip_miles"
		label="Round trip"
		value={s.typed_round_trip_miles}
		shown={roundTrip ? `${miles(roundTrip, 'distance')} there and back` : ''}
		hint={whose(s.typed_round_trip_miles, s.google_round_trip_miles, 'miles')}
		placeholder={s.google_round_trip_miles ?? ''}
		inputmode="decimal"
		editable={!field}
		{endpoint}
		ifMatch={s.version}
		onconflict={again}
		validate={parseSiteField}
		onsaved={again}
	>
		{#snippet caption()}Miles from the business and back. Empty uses Google’s route.{/snippet}
	</Detail>
	<Detail
		name="typed_drive_minutes"
		label="Drive time"
		value={s.typed_drive_minutes === null ? null : String(s.typed_drive_minutes)}
		shown={driveMinutes === null ? '' : `${driveMinutes} min each way`}
		hint={whose(s.typed_drive_minutes, s.google_drive_minutes, 'min')}
		placeholder={s.google_drive_minutes === null ? '' : String(s.google_drive_minutes)}
		inputmode="numeric"
		editable={!field}
		{endpoint}
		ifMatch={s.version}
		onconflict={again}
		validate={parseSiteField}
		onsaved={again}
	>
		{#snippet caption()}Minutes, one way. Empty uses Google’s route.{/snippet}
	</Detail>
</section>

<style>
	.warn {
		color: var(--fgColor-attention);
	}
</style>
