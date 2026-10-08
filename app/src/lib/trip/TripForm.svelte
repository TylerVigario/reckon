<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { day as dayOf, miles as milesOf } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { paysWhat } from '#lib/pay-words.ts';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { enqueueTrip, findTrip, flush, waitingCount } from '#lib/queue.ts';
	import { warm } from '#lib/warm.ts';
	import { onMount } from 'svelte';
	import { sum } from '#lib/decimal.ts';
	import {
		driveKey,
		estimate,
		legsOf,
		type Estimate,
		type Leg,
		type LegRule,
		type Place
	} from '#lib/trip-legs.ts';
	import type { TripChoices } from '#lib/server/trip-choices.ts';
	import type { StopDraft, TripDraft } from './draft.ts';

	/**
	 * A trip being recorded, or -- given `start` and `tripId` -- a saved one being
	 * changed (#routes/trips/new, #routes/trips/[id]/change). Saving works its
	 * legs out by #lib/trip-legs either way; a change replaces the trip's stops
	 * and legs.
	 */
	let {
		data,
		start = null,
		tripId = null
	}: { data: TripChoices; start?: TripDraft | null; tripId?: string | null } = $props();
	const was = untrack(() => start);

	// Made once, so a save sent twice is one trip.
	const clientUuid = was?.clientUuid ?? crypto.randomUUID();

	const nameOf = (entityId: string) => data.entities.find((e) => e.id === entityId)?.name ?? '';
	const siteOf = (siteId: string | null) => data.sites.find((s) => s.id === siteId) ?? null;
	// One address, written one way, so two clients' sites in one building are one place.
	const addressOf = (s: { street: string; city: string; postcode: string }) =>
		`${s.street.trim()}, ${s.city.trim()} ${s.postcode.trim()}`.toLowerCase().replace(/\s+/g, ' ');
	const street = (s: { street: string; city: string }) => `${s.street}, ${s.city}`;

	let day = $state(untrack(() => was?.day ?? data.today));
	let driver = $state(
		untrack(
			() =>
				was?.driver ??
				(data.people.some((p) => p.id === data.me) ? data.me : (data.people[0]?.id ?? ''))
		)
	);
	/** What a driver starts in: what they last drove, or the one vehicle they own. */
	const usual = (who: string) => {
		const last = data.last[who];
		if (last && data.vehicles.some((v) => v.id === last)) return last;
		const theirs = data.vehicles.filter((v) => v.owner_id === who);
		return theirs.length === 1 ? theirs[0].id : null;
	};
	let vehicleId = $state<string | null>(untrack(() => (was ? was.vehicleId : usual(driver))));
	const lastOf = $derived(data.last[driver] === vehicleId && vehicleId !== null);
	let serviceId = $state<string | null>(
		untrack(() => was?.serviceId ?? data.services[0]?.id ?? null)
	);

	let startAddress = $state<string | null>(was?.startAddress ?? null);
	let endAddress = $state<string | null>(was?.endAddress ?? null);
	let stops = $state<StopDraft[]>(was?.stops ?? []);
	/** Miles typed for a drive, and who it was given to by hand, by the two places it runs between. */
	let typed = $state<Record<string, string>>(was?.typed ?? {});
	let given = $state<Record<string, string[]>>(was?.given ?? {});
	let odometerStart = $state(was?.odometerStart ?? '');
	let odometerEnd = $state(was?.odometerEnd ?? '');
	let note = $state(was?.note ?? '');

	const placeOf = (s: StopDraft): Place =>
		s.siteId ? { site: s.siteId } : { address: s.address ?? '' };
	const places = $derived<Place[]>([
		startAddress ? { address: startAddress } : 'base',
		...stops.map(placeOf),
		endAddress ? { address: endAddress } : 'base'
	]);
	const roundTrips = $derived(
		Object.fromEntries(data.sites.map((s) => [s.id, s.round_trip_miles]))
	);
	/** A place in a few words: the base, a site by its label, a shared stop by its street. */
	const short = (p: Place, at?: StopDraft) => {
		if (p === 'base') return 'Base';
		if ('address' in p) return p.address;
		if (at && at.visits.length > 1) return street(siteOf(p.site) ?? { street: '', city: '' });
		return siteOf(p.site)?.label ?? '';
	};
	const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
	const nth = (i: number) => ORDINAL[i] ?? `number ${i + 1}`;

	// Google's route for these places, asked of the server when they change
	// (#lib/server/routes): the first word on a drive's miles when it has one.
	const placesSent = $derived(
		JSON.stringify({
			start_address: startAddress || null,
			end_address: endAddress || null,
			stops: stops.map((s) => ({ site_id: s.siteId, address: s.address }))
		})
	);
	let route = $state<{ for: string; miles: string[] | null } | null>(null);
	let noSignal = $state(false);
	let waiting = $state(0);
	onMount(() => {
		void waitingCount().then(
			(n) => (waiting = n),
			() => {}
		);
	});
	$effect(() => {
		const sent = placesSent;
		if (!stops.length) return;
		const ask = async () => {
			const r = await fetch('/api/trips/route', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: sent
			}).catch(() => null);
			const answer = r?.ok ? ((await r.json()) as { miles: string[] | null }) : null;
			route = { for: sent, miles: answer?.miles ?? null };
			// No answer at all is no signal: Google's figure comes when the trip arrives.
			noSignal = r === null;
		};
		const timer = setTimeout(() => void ask(), 400);
		return () => clearTimeout(timer);
	});

	type DriveRow = {
		key: string;
		from: string;
		to: string;
		miles: string;
		guess: Estimate | null;
	};
	const drives = $derived<DriveRow[]>(
		places.slice(1).map((to, i) => {
			const from = places[i];
			const key = driveKey(from, to);
			const google = route?.for === placesSent ? route.miles?.[i] : undefined;
			const guess: Estimate | null = google
				? { miles: google, from: 'google' }
				: estimate(from, to, data.known, roundTrips);
			return {
				key,
				from: short(from, stops[i - 1]),
				to: short(to, stops[i]),
				miles: typed[key] ?? guess?.miles ?? '',
				guess: typed[key] === undefined ? guess : null
			};
		})
	);
	/** Where a drive's miles came from, before anyone typed them. */
	const guessed = (g: Estimate | null) =>
		!g
			? null
			: g.from === 'google'
				? "Google's route"
				: [
						g.from === 'site'
							? "half the site's round trip"
							: `as last driven, ${dayOf(g.on ?? '')}`,
						noSignal ? "Google's route when it arrives" : null
					]
						.filter(Boolean)
						.join(' · ');
	const complete = $derived(
		stops.length > 0 && drives.every((d) => /^\d{1,4}(\.\d{1,2})?$/.test(d.miles.trim()))
	);
	const legs = $derived<Leg[]>(
		complete
			? legsOf(
					stops,
					drives.map((d) => ({ miles: d.miles.trim(), to: given[d.key] ?? null }))
				)
			: []
	);
	const driven = $derived(complete ? sum(drives.map((d) => d.miles.trim())) : null);

	/** Who a drive went to, and why, in words. */
	const RULE: Record<LegRule, (i: number) => string> = {
		round_trip: () => 'out and back for one client',
		house_to_a: (i) => `caused by the ${nth(i)} stop`,
		a_to_b: (i) => `caused by the ${nth(i)} stop`,
		b_to_house: () => 'the way back from the last stop',
		split: () => 'split between them',
		unassigned: () => 'nobody asked for it',
		chosen: () => 'given by hand'
	};
	const toWhom = (i: number) => {
		const mine = legs.filter((l) => l.drive === i);
		if (!mine.length) return { who: '—', why: '' };
		const named = mine.filter((l) => l.entityId);
		return {
			who: named.length ? named.map((l) => nameOf(l.entityId!)).join(' and ') : 'Nobody',
			why: RULE[mine[0].rule](Math.min(i, stops.length - 1))
		};
	};
	/** Everyone the trip was for, who a drive can be given to by hand. */
	const clients = $derived([...new Set(stops.flatMap((s) => s.visits.map((v) => v.entityId)))]);
	const giveTo = (key: string, value: string) => {
		const rest = { ...given };
		delete rest[key];
		given = value === '' ? rest : { ...rest, [key]: value === 'nobody' ? [] : [value] };
	};

	// ------------------------------------------------------------ adding a stop
	let adding = $state(false);
	let mode = $state<'site' | 'address'>('site');
	let pickClient = $state<string | null>(null);
	let pickSite = $state<string | null>(null);
	let pickAddress = $state('');
	let pickFor = $state<string>('');
	let alsoAdded = $state<string[]>([]);
	const withSites = $derived(
		data.entities.filter((e) => data.sites.some((s) => s.entity_id === e.id))
	);
	const sitesOf = $derived(data.sites.filter((s) => s.entity_id === pickClient));
	/** Other clients' sites at the address of the one picked: one stop, one drive. */
	const alsoHere = $derived.by(() => {
		const picked = siteOf(pickSite);
		if (!picked) return [];
		const at = addressOf(picked);
		return data.sites.filter((s) => s.entity_id !== picked.entity_id && addressOf(s) === at);
	});
	function startAdding() {
		mode = 'site';
		pickClient = withSites[0]?.id ?? null;
		pickSite = data.sites.find((s) => s.entity_id === pickClient)?.id ?? null;
		pickAddress = '';
		pickFor = '';
		alsoAdded = [];
		adding = true;
	}
	function pickedClient() {
		pickSite = data.sites.find((s) => s.entity_id === pickClient)?.id ?? null;
		alsoAdded = [];
	}
	function addStop() {
		const key = crypto.randomUUID();
		if (mode === 'site') {
			const site = siteOf(pickSite);
			if (!site) return;
			const others = alsoHere.filter((s) => alsoAdded.includes(s.id));
			stops = [
				...stops,
				{
					key,
					siteId: site.id,
					address: null,
					visits: [site, ...others].map((s) => ({
						entityId: s.entity_id,
						siteId: s.id,
						askedThere: false
					}))
				}
			];
		} else {
			if (!pickAddress.trim()) return;
			stops = [
				...stops,
				{
					key,
					siteId: null,
					address: pickAddress.trim(),
					visits: pickFor ? [{ entityId: pickFor, siteId: null, askedThere: false }] : []
				}
			];
		}
		adding = false;
	}
	const removeStop = (key: string) => (stops = stops.filter((s) => s.key !== key));
	const askedThere = (stop: StopDraft, entityId: string, asked: boolean) =>
		(stops = stops.map((s) =>
			s.key === stop.key
				? {
						...s,
						visits: s.visits.map((v) => (v.entityId === entityId ? { ...v, askedThere: asked } : v))
					}
				: s
		));

	// -------------------------------------------------- what it comes to, and saving
	const body = $derived({
		client_uuid: clientUuid,
		travelled_on: day,
		driven_by: driver,
		vehicle_id: vehicleId,
		service_id: data.services.length > 1 ? serviceId : null,
		start_address: startAddress,
		end_address: endAddress,
		odometer_start: odometerStart.trim() || null,
		odometer_end: odometerEnd.trim() || null,
		note: note.trim() || null,
		stops: stops.map((s) => ({
			site_id: s.siteId,
			address: s.address,
			clients: s.visits.map((v) => ({
				entity_id: v.entityId,
				site_id: v.siteId,
				asked_there: v.askedThere
			}))
		})),
		// A drive whose miles were estimated says so, and Google's route takes their
		// place when the trip arrives, if Google answers.
		drives: drives.map((d) => ({
			miles: d.miles.trim(),
			to: given[d.key] ?? null,
			estimated: d.guess?.from === 'last' || d.guess?.from === 'site'
		}))
	});

	type Worth = {
		legs: { billed: string | null; paid: string | null }[];
		rate: string | null;
		rule: { pays_for: string; method: string; amount: string | null } | null;
		billed: string | null;
		paid: string | null;
		kept: string | null;
	};
	let worth = $state<Worth | null>(null);
	let asked = 0;
	$effect(() => {
		const draft = JSON.stringify(body);
		if (!complete) {
			worth = null;
			return;
		}
		const n = ++asked;
		const ask = async () => {
			const r = await fetch('/api/trips/worth', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: draft
			}).catch(() => null);
			const answer = r?.ok ? ((await r.json()) as Worth) : null;
			if (n === asked) worth = answer;
		};
		const timer = setTimeout(() => void ask(), 250);
		return () => clearTimeout(timer);
	});
	const billedFor = (i: number) => {
		if (!worth) return null;
		const mine = legs.flatMap((l, k) => (l.drive === i ? [worth!.legs[k]?.billed ?? null] : []));
		return mine.some((x) => x === null) ? null : sum(mine).toFixed(2);
	};

	const vehicle = $derived(data.vehicles.find((v) => v.id === vehicleId) ?? null);
	const serviceName = $derived(
		data.services.find(
			(s) => s.id === (data.services.length > 1 ? serviceId : data.services[0]?.id)
		)?.name ?? 'mileage'
	);
	const odometer = $derived.by(() => {
		const a = Number(odometerStart.replace(/,/g, ''));
		const b = Number(odometerEnd.replace(/,/g, ''));
		if (!odometerStart.trim() || !odometerEnd.trim() || Number.isNaN(a) || Number.isNaN(b))
			return null;
		return {
			read: b - a,
			agrees: driven !== null && Math.abs(b - a - Number(driven.toString())) < 1
		};
	});

	/** A plain copy of what the form holds, which the phone's store can keep. */
	function copy<T>(v: T): T {
		return JSON.parse(JSON.stringify(v)) as T;
	}

	let why = $state('');
	let saving = $state(false);
	async function save() {
		why = '';
		// A day the trip already had stands: the server took it, on its own clock.
		if (day > data.today && day !== was?.day)
			return (why = 'Pick the day it was driven. It cannot be in the future.');
		if (!stops.length) return (why = 'Add where it went: a stop at least.');
		if (!complete) return (why = 'How many miles each drive was.');
		if (!odometerStart.trim() !== !odometerEnd.trim())
			return (why = 'Both odometer readings, or neither.');
		saving = true;
		// Written on the phone first, as time is, and sent when there is a signal:
		// a copy, because what the form holds cannot go into the phone's store.
		const key = tripId ?? clientUuid;
		try {
			await enqueueTrip({
				key,
				trip_id: tripId,
				body: copy(body),
				draft: copy({
					clientUuid,
					day,
					driver,
					vehicleId,
					serviceId,
					startAddress,
					endAddress,
					stops,
					typed,
					given,
					odometerStart,
					odometerEnd,
					note
				}),
				shown: {
					label: stops.map((s, i) => short(placeOf(s), s) || `Stop ${i + 1}`).join(', '),
					day,
					driver: data.people.find((p) => p.id === driver)?.name ?? '',
					miles: driven?.toString() ?? ''
				}
			});
		} catch {
			saving = false;
			return (why = 'This phone would not save the trip, so it is not saved.');
		}
		// A few seconds for the server to take it; no longer, so a phone with a
		// weak signal is not left waiting on a page that has done its part.
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		const still = await findTrip(key).catch(() => undefined);
		saving = false;
		if (still?.refused)
			return (why =
				Object.values(still.refused.errors ?? {})[0] ?? still.refused.detail ?? 'Not saved.');
		// Still on the phone: the trips list shows it waiting.
		if (still) return goto(resolve('/trips'), { invalidateAll: true });
		const id =
			tripId ??
			(
				await fetch(`/api/trips?client_uuid=${encodeURIComponent(clientUuid)}`)
					.then((r) => (r.ok ? (r.json() as Promise<{ id: string }>) : null))
					.catch(() => null)
			)?.id;
		// Arrived: the worker keeps it, and its Change, for no signal from now on.
		warm();
		await goto(id ? resolve('/trips/[id]', { id }) : resolve('/trips'), { invalidateAll: true });
	}
</script>

{#if adding}
	<Top title="Add a stop" sub="The next place on this trip" />
	<div class="pad">
		<div class="rows form">
			<div class="seg">
				<button type="button" class:on={mode === 'site'} onclick={() => (mode = 'site')}
					>A client's site</button
				>
				<button type="button" class:on={mode === 'address'} onclick={() => (mode = 'address')}
					>Somewhere else</button
				>
			</div>
			{#if mode === 'site'}
				<div class="fld">
					<label for="s-client">Client</label>
					<select id="s-client" class="inp" bind:value={pickClient} onchange={pickedClient}>
						{#each withSites as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
					</select>
				</div>
				<div class="fld">
					<label for="s-site">Site</label>
					<span class="inp-wrap">
						<select id="s-site" class="inp" bind:value={pickSite} onchange={() => (alsoAdded = [])}>
							{#each sitesOf as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
						</select>
						{#if siteOf(pickSite)?.round_trip_miles}
							<span class="hint"
								>{milesOf(siteOf(pickSite)!.round_trip_miles, 'distance')} round trip</span
							>
						{/if}
					</span>
				</div>
				{#each alsoHere as s (s.id)}
					{@const on = alsoAdded.includes(s.id)}
					<div class="rec acc also">
						<div class="rec-m">
							<div class="rec-t">{nameOf(s.entity_id)} is here too</div>
							<div class="rec-s">
								Their {s.label} is at {street(s)}. Working for both in one visit is one drive.
							</div>
						</div>
						<div class="rec-n">
							<button
								type="button"
								class="btn sm"
								aria-pressed={on}
								onclick={() =>
									(alsoAdded = on ? alsoAdded.filter((x) => x !== s.id) : [...alsoAdded, s.id])}
								>{on ? 'Added' : 'Add them'}</button
							>
						</div>
					</div>
				{/each}
			{:else}
				<div class="fld">
					<label for="s-address">Address</label>
					<input
						id="s-address"
						class="inp"
						placeholder="Home Depot, 1610 E Main St, Woodland"
						bind:value={pickAddress}
					/>
				</div>
				<div class="fld">
					<label for="s-for">For</label>
					<select id="s-for" class="inp" bind:value={pickFor}>
						<option value="">Nobody — the business's own errand</option>
						{#each data.entities as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
					</select>
				</div>
				<p class="aside">
					A stop made for a client's job is theirs, as their site would be. One made for the
					business is nobody's, and its miles are kept off every invoice.
				</p>
			{/if}
			<button
				class="btn pri blk"
				type="button"
				onclick={addStop}
				disabled={mode === 'site' ? !pickSite : !pickAddress.trim()}>Add the stop</button
			>
			<button class="btn blk" type="button" onclick={() => (adding = false)}
				>Back to the trip</button
			>
		</div>
	</div>
{:else}
	{#if tripId}
		<Top
			title="Change the trip"
			sub="Its legs are worked out again when it is saved"
			back={resolve('/trips/[id]', { id: tripId })}
			backLabel="The trip"
		/>
	{:else}
		<Top
			title="New trip"
			sub="Where it went, and who it was for"
			back={resolve('/trips')}
			backLabel="Trips"
		/>
	{/if}
	<OfflineBanner asOf={data.as_of} {waiting} />
	<div class="pad">
		<div class="rows form">
			<div class="fld">
				<label for="t-day">Day</label>
				<input id="t-day" class="inp" type="date" max={data.today} bind:value={day} />
			</div>
			<div class="fld">
				<span class="lbl">Who drove</span>
				<div class="seg">
					{#each data.people as p (p.id)}
						<button
							type="button"
							class:on={driver === p.id}
							aria-pressed={driver === p.id}
							onclick={() => {
								driver = p.id;
								vehicleId = usual(p.id);
							}}>{p.name.split(' ')[0]}</button
						>
					{/each}
				</div>
			</div>
			<div class="fld">
				<label for="t-vehicle">In</label>
				{#if data.vehicles.length}
					<span class="inp-wrap">
						<select id="t-vehicle" class="inp" bind:value={vehicleId}>
							<option value={null}>Not recorded</option>
							{#each data.vehicles as v (v.id)}
								<option value={v.id}
									>{v.name} · {v.owner ? `${v.owner}'s` : "the business's"}</option
								>
							{/each}
						</select>
						{#if lastOf}<span class="hint">their last</span>{/if}
					</span>
				{:else}
					<small class="lt">
						No vehicles yet. <a href={resolve('/settings/travel/vehicles/new')}>Add one</a> in Settings
						→ Travel, and its miles pay its owner.
					</small>
				{/if}
			</div>
			{#if data.services.length > 1}
				<div class="fld">
					<label for="t-service">Its miles bill as</label>
					<select id="t-service" class="inp" bind:value={serviceId}>
						{#each data.services as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</div>
			{/if}
		</div>

		<div class="sec">
			<div class="sec-h"><h2>Where, in order</h2></div>
			<div class="rows stops">
				<div class="legs">
					<div class="leg">
						<div class="stop">{startAddress ?? 'Base'}</div>
						<div class="det">
							{#if startAddress === null}
								{data.base ?? 'Where trips start'} ·
								<button type="button" class="link" onclick={() => (startAddress = '')}
									>Started somewhere else</button
								>
							{:else}
								<input
									class="inp sm wide"
									placeholder="Where it started"
									aria-label="Where it started"
									bind:value={startAddress}
								/>
								<button type="button" class="link" onclick={() => (startAddress = null)}
									>From the base</button
								>
							{/if}
						</div>
					</div>
					{#each stops as s, i (s.key)}
						<div class="leg">
							{#if s.visits.length > 1}
								<div class="stop">{street(siteOf(s.siteId) ?? { street: '', city: '' })}</div>
								<div class="det">
									{#each s.visits as v (v.entityId)}{nameOf(v.entityId)} · {siteOf(v.siteId)
											?.label}<br />{/each}
								</div>
							{:else if s.siteId}
								<div class="stop">
									{nameOf(s.visits[0]?.entityId ?? '')} · {siteOf(s.siteId)?.label}
								</div>
								<div class="det">{street(siteOf(s.siteId) ?? { street: '', city: '' })}</div>
							{:else}
								<div class="stop">{s.address}</div>
								<div class="det">
									{s.visits.length
										? `For ${nameOf(s.visits[0].entityId)}`
										: "The business's own errand"}
								</div>
							{/if}
							{#if s.visits.length === 2}
								{@const second = s.visits[1]}
								<div class="fld asked">
									<span class="lbl">Did both ask before you left?</span>
									<div class="seg">
										<button
											type="button"
											class:on={!second.askedThere}
											onclick={() => askedThere(s, second.entityId, false)}>Both asked first</button
										>
										<button
											type="button"
											class:on={second.askedThere}
											onclick={() => askedThere(s, second.entityId, true)}
											>{nameOf(second.entityId).split(' ')[0]} asked once there</button
										>
									</div>
								</div>
							{:else if s.visits.length > 2}
								<div class="fld asked">
									<span class="lbl">Who asked once you were there?</span>
									<div class="seg">
										{#each s.visits as v (v.entityId)}
											<button
												type="button"
												class:on={v.askedThere}
												aria-pressed={v.askedThere}
												onclick={() => askedThere(s, v.entityId, !v.askedThere)}
												>{nameOf(v.entityId).split(' ')[0]}</button
											>
										{/each}
									</div>
								</div>
							{/if}
							<button
								type="button"
								class="link"
								aria-label="Take the {nth(i)} stop off"
								onclick={() => removeStop(s.key)}>Take it off</button
							>
						</div>
					{/each}
					<div class="leg">
						<div class="stop">{endAddress === null ? 'Back to base' : endAddress || 'Ended…'}</div>
						<div class="det">
							{#if endAddress === null}
								<button type="button" class="link" onclick={() => (endAddress = '')}
									>Ended somewhere else</button
								>
							{:else}
								<input
									class="inp sm wide"
									placeholder="Where it ended"
									aria-label="Where it ended"
									bind:value={endAddress}
								/>
								<button type="button" class="link" onclick={() => (endAddress = null)}
									>Back to base</button
								>
							{/if}
						</div>
					</div>
				</div>
				<button type="button" class="btn" onclick={startAdding}>Add a stop</button>
			</div>
		</div>

		{#if stops.length}
			<div class="sec">
				<div class="sec-h"><h2>Legs, to whoever caused them</h2></div>
				<div class="rows">
					{#each drives as d, i (d.key + i)}
						{@const w = toWhom(i)}
						{@const billed = billedFor(i)}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-t">{w.who}</div>
								<div class="rec-s">{d.from} → {d.to}{w.why ? `, ${w.why}` : ''}</div>
								<div class="rec-s mi">
									<input
										class="inp sm"
										inputmode="decimal"
										aria-label="Miles from {d.from} to {d.to}"
										value={d.miles}
										oninput={(e) => (typed = { ...typed, [d.key]: e.currentTarget.value })}
									/>
									{['mi', guessed(d.guess)].filter(Boolean).join(' · ')}
								</div>
								{#if clients.length}
									<select
										class="inp sm give"
										aria-label="Who the drive from {d.from} to {d.to} is given to"
										value={given[d.key] ? (given[d.key][0] ?? 'nobody') : ''}
										onchange={(e) => giveTo(d.key, e.currentTarget.value)}
									>
										<option value="">To whoever caused it</option>
										{#each clients as c (c)}<option value={c}>To {nameOf(c)}</option>{/each}
										<option value="nobody">To nobody</option>
									</select>
								{/if}
							</div>
							<div class="rec-n">
								<span class="rec-v" class:mut={billed === null}>{money(billed)}</span>
							</div>
						</div>
					{/each}
					<div class="rec tot">
						<div class="rec-m"><div class="rec-t">Driven, and billed</div></div>
						<div class="rec-n">
							<span class="rec-v">{money(worth?.billed ?? null)}</span>
							<span class="rec-x">{driven ? milesOf(driven.toString()) : '—'}</span>
						</div>
					</div>
				</div>
			</div>

			<div class="sec">
				<div class="sec-h">
					<h2>Odometer</h2>
					<span class="sp"></span><span class="lt">if you read it</span>
				</div>
				<div class="rows form">
					<div class="duo">
						<div class="fld">
							<label for="t-left">Left</label>
							<input id="t-left" class="inp" inputmode="decimal" bind:value={odometerStart} />
						</div>
						<div class="fld">
							<label for="t-back">Got back</label>
							<input id="t-back" class="inp" inputmode="decimal" bind:value={odometerEnd} />
						</div>
					</div>
					{#if odometer}
						{#if odometer.agrees}
							<span class="chip good"
								><span class="dot"></span>{milesOf(String(odometer.read), 'distance')}, as the legs
								say</span
							>
						{:else}
							<span class="chip warn"
								><span class="dot"></span>The odometer says {milesOf(
									String(odometer.read),
									'distance'
								)}; the legs come to {driven ? milesOf(driven.toString()) : 'nothing yet'}</span
							>
						{/if}
					{/if}
				</div>
			</div>

			<div class="sec">
				<div class="sec-h"><h2>What it comes to</h2></div>
				<div class="rows">
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">Billed</div>
							<div class="rec-s">
								{driven ? milesOf(driven.toString()) : '—'} of {serviceName}{worth?.rate
									? ` at ${unitPrice(worth.rate)}`
									: ''}
							</div>
						</div>
						<div class="rec-n"><span class="rec-v">{money(worth?.billed ?? null)}</span></div>
					</div>
					{#if vehicle}
						<div class="rec" class:warn={vehicle.owner && worth && worth.paid === null}>
							<div class="rec-m">
								<div class="rec-t">{vehicle.owner ?? 'Nobody'}, for the {vehicle.name}</div>
								<div class="rec-s">
									{#if !vehicle.owner}
										It is the business's, whoever drove it
									{:else if worth?.rule}
										{@const r = paysWhat(worth.rule, { money, unitPrice })}
										{r.v}
										{r.x}, each leg
									{:else if worth && worth.paid === null}
										No vehicle rule reaches them
									{:else}
										By each leg's own rule
									{/if}
								</div>
							</div>
							<div class="rec-n">
								<span class="rec-v" class:mut={!vehicle.owner}
									>{vehicle.owner ? money(worth?.paid ?? null) : '—'}</span
								>
							</div>
						</div>
					{/if}
					<div class="rec tot">
						<div class="rec-m"><div class="rec-t">Kept</div></div>
						<div class="rec-n">
							<span class="rec-v"
								>{money(vehicle ? (worth?.kept ?? null) : (worth?.billed ?? null))}</span
							>
						</div>
					</div>
				</div>
				{#if noSignal && !worth}
					<p class="aside">Worked out when there is a signal.</p>
				{/if}
			</div>
		{/if}

		<div class="rows form">
			<div class="fld">
				<label for="t-note">What it was for — kept with the trip</label>
				<input id="t-note" class="inp" placeholder="Why it was driven" bind:value={note} />
			</div>
			{#if why}<p class="why bad">{why}</p>{/if}
			<button class="btn pri blk" type="button" onclick={save} disabled={saving}
				>Save the trip</button
			>
		</div>
	</div>
{/if}

<style>
	.form {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 15px;
	}
	.stops {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	.lt {
		font-size: 12px;
		color: var(--ink-3);
	}
	.inp-wrap {
		position: relative;
		display: block;
	}
	.inp-wrap .hint {
		position: absolute;
		right: 38px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		color: var(--ink-3);
		font-family: var(--f-mono);
		pointer-events: none;
	}
	.mi {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
	}
	.inp.sm {
		width: 72px;
		padding: 6px 8px;
		font-size: 14px;
	}
	.inp.sm.wide,
	.inp.sm.give {
		width: 100%;
		margin-top: 6px;
	}
	.asked {
		margin-top: 8px;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}
	.also {
		border-radius: 10px;
	}
	.why {
		margin: 0;
	}
	.why.bad {
		color: var(--crit);
	}
	.aside {
		margin: 8px 0 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
