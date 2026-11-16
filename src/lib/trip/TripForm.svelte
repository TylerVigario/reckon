<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { tick, untrack } from 'svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { focusFirstInvalid } from '#lib/work-fields.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { day as dayOf, miles as milesOf } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { paysWhat } from '#lib/pay-words.ts';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { enqueueTrip, findTrip, flush, notKept, waitingCount } from '#lib/queue.ts';
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
	import { busy } from '#lib/busy.svelte.ts';

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
	/** Who a drive is given to by hand, as the select holds it. */
	const givenTo = (key: string) => (given[key] ? (given[key][0] ?? 'nobody') : '');
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
	/** Why the stop, or the trip, cannot be added or saved, by the field to say it under. */
	let errors = $state<Record<string, string>>({});
	let stopForm = $state<HTMLFormElement | null>(null);
	let tripForm = $state<HTMLFormElement | null>(null);
	const refuse = async (form: HTMLFormElement | null, found: Record<string, string>) => {
		errors = found;
		await tick();
		focusFirstInvalid(form);
	};
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
		errors = {};
		adding = true;
	}
	function pickedClient() {
		pickSite = data.sites.find((s) => s.entity_id === pickClient)?.id ?? null;
		alsoAdded = [];
	}
	function addStop(e: SubmitEvent) {
		e.preventDefault();
		const key = crypto.randomUUID();
		if (mode === 'site') {
			const site = siteOf(pickSite);
			if (!site) return void refuse(stopForm, { site: 'Which of their sites.' });
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
			if (!pickAddress.trim()) return void refuse(stopForm, { address: 'Where it was.' });
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
		errors = {};
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
		/** Another person's vehicle pay, not told to someone with Field (#lib/access). */
		withheld: boolean;
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
	/** Whether a drive's miles, as typed, are a number of miles. */
	const milesOk = (m: string) => /^\d{1,4}(\.\d{1,2})?$/.test(m.trim());

	async function save(e: SubmitEvent) {
		e.preventDefault();
		why = '';
		const found: Record<string, string> = {};
		// A day the trip already had stands: the server took it, on its own clock.
		if (!day || (day > data.today && day !== was?.day))
			found.day = 'Pick the day it was driven. It cannot be in the future.';
		if (!stops.length) found.stops = 'Where it went: a stop at least.';
		else if (!complete) found.miles = 'How many miles each drive was, up to two decimals.';
		if (!odometerStart.trim() !== !odometerEnd.trim())
			found.odometer = 'Both readings, or neither.';
		if (Object.keys(found).length) return refuse(tripForm, found);
		errors = {};
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
		} catch (e) {
			saving = false;
			return (why = notKept(e, 'This phone would not save the trip, so it is not saved.'));
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
		if (still) return goto(resolve('/trips'), { refreshAll: true });
		const id =
			tripId ??
			(
				await fetch(`/api/trips?client_uuid=${encodeURIComponent(clientUuid)}`)
					.then((r) => (r.ok ? (r.json() as Promise<{ id: string }>) : null))
					.catch(() => null)
			)?.id;
		// Arrived: the worker keeps it, and its Change, for no signal from now on.
		warm();
		await goto(id ? resolve('/trips/[id]', { id }) : resolve('/trips'), { refreshAll: true });
	}
</script>

{#snippet wrong(key: string)}
	{#if errors[key]}<p class="fc-e" id="t-{key}-e"><Octicon name="alert" />{errors[key]}</p>{/if}
{/snippet}

{#if adding}
	<Top title="Add a stop" sub="The next place on this trip" />
	<div class="pad">
		<form class="box form" novalidate onsubmit={addStop} bind:this={stopForm}>
			<div class="box-row fields">
				<fieldset class="fc">
					<legend class="fc-l">The stop</legend>
					<label class="rad">
						<input type="radio" name="s-mode" value="site" bind:group={mode} />
						<span class="rad-t">A client’s site</span>
					</label>
					<label class="rad">
						<input type="radio" name="s-mode" value="address" bind:group={mode} />
						<span class="rad-t">Somewhere else</span>
					</label>
				</fieldset>
				{#if mode === 'site'}
					<div class="fc">
						<label class="fc-l" for="s-client">Client</label>
						<select id="s-client" class="ti" bind:value={pickClient} onchange={pickedClient}>
							{#each withSites as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
						</select>
					</div>
					<div class="fc">
						<label class="fc-l" for="s-site">Site</label>
						<select
							id="s-site"
							class="ti"
							bind:value={pickSite}
							onchange={() => (alsoAdded = [])}
							aria-invalid={errors.site ? 'true' : undefined}
							aria-describedby={errors.site ? 't-site-e' : undefined}
						>
							{#each sitesOf as st (st.id)}<option value={st.id}>{st.label}</option>{/each}
						</select>
						{#if errors.site}
							{@render wrong('site')}
						{:else if siteOf(pickSite)?.round_trip_miles}
							<p class="fc-c">
								{milesOf(siteOf(pickSite)!.round_trip_miles, 'distance')} there and back from the base.
							</p>
						{/if}
					</div>
					{#if alsoHere.length}
						<fieldset class="fc">
							<legend class="fc-l">Here too</legend>
							<p class="fc-c">Working for more than one in a visit is one drive.</p>
							{#each alsoHere as st (st.id)}
								<label class="chk">
									<input
										type="checkbox"
										checked={alsoAdded.includes(st.id)}
										onchange={(e) =>
											(alsoAdded = e.currentTarget.checked
												? [...alsoAdded, st.id]
												: alsoAdded.filter((x) => x !== st.id))}
									/>
									<span>
										<span class="chk-t">{nameOf(st.entity_id)}</span>
										<span class="chk-c">Their {st.label}, at {street(st)}</span>
									</span>
								</label>
							{/each}
						</fieldset>
					{/if}
				{:else}
					<div class="fc">
						<label class="fc-l" for="s-address">Address</label>
						<input
							id="s-address"
							class="ti"
							autocomplete="off"
							placeholder="Home Depot, 1610 E Main St, Woodland"
							bind:value={pickAddress}
							aria-invalid={errors.address ? 'true' : undefined}
							aria-describedby={errors.address ? 't-address-e' : undefined}
						/>
						{@render wrong('address')}
					</div>
					<div class="fc">
						<label class="fc-l" for="s-for">For</label>
						<select id="s-for" class="ti" bind:value={pickFor} aria-describedby="s-for-c">
							<option value="">Nobody, the business’s own errand</option>
							{#each data.entities as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
						</select>
						<p class="fc-c" id="s-for-c">
							A stop for a client’s job is theirs, as their site would be. One for the business is
							nobody’s, and its miles are kept off every invoice.
						</p>
					</div>
				{/if}
			</div>
			<div class="box-row keep">
				<button class="btn pri">Add the stop</button>
				<button class="btn" type="button" onclick={() => ((adding = false), (errors = {}))}
					>Back to the trip</button
				>
			</div>
		</form>
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
	<form class="pad" novalidate onsubmit={save} bind:this={tripForm}>
		{#if why}
			<div class="banner crit" role="alert">
				<Octicon name="alert" />
				<div class="banner-m"><p class="banner-t">{why}</p></div>
			</div>
		{/if}

		<section class="box" aria-label="The drive">
			<div class="box-row fields">
				<div class="fc">
					<label class="fc-l" for="t-day">Day</label>
					<input
						id="t-day"
						class="ti"
						type="date"
						max={data.today}
						bind:value={day}
						aria-invalid={errors.day ? 'true' : undefined}
						aria-describedby={errors.day ? 't-day-e' : undefined}
					/>
					{@render wrong('day')}
				</div>
				<fieldset class="fc">
					<legend class="fc-l">Who drove</legend>
					{#each data.people as p (p.id)}
						<label class="rad">
							<input
								type="radio"
								name="t-driver"
								value={p.id}
								checked={driver === p.id}
								onchange={() => {
									driver = p.id;
									vehicleId = usual(p.id);
								}}
							/>
							<span class="rad-t">{p.name}</span>
						</label>
					{/each}
				</fieldset>
				<div class="fc">
					<label class="fc-l" for="t-vehicle">In</label>
					{#if data.vehicles.length}
						<select
							id="t-vehicle"
							class="ti"
							bind:value={vehicleId}
							aria-describedby={lastOf ? 't-vehicle-c' : undefined}
						>
							<option value={null}>Not recorded</option>
							{#each data.vehicles as v (v.id)}
								<option value={v.id}
									>{v.name} · {v.owner ? `${v.owner}’s` : 'the business’s'}</option
								>
							{/each}
						</select>
						{#if lastOf}<p class="fc-c" id="t-vehicle-c">What they drove last.</p>{/if}
					{:else}
						<p class="fc-c">
							{#if data.field}
								No vehicles yet. Someone with Full adds one in Settings, under Vehicles, and its
								miles pay its owner.
							{:else}
								No vehicles yet. <a href={resolve('/settings/vehicles/new')}>Add one</a>, and its
								miles pay its owner.
							{/if}
						</p>
					{/if}
				</div>
				{#if data.services.length > 1}
					<div class="fc">
						<label class="fc-l" for="t-service">Its miles bill as</label>
						<select id="t-service" class="ti" bind:value={serviceId}>
							{#each data.services as sv (sv.id)}<option value={sv.id}>{sv.name}</option>{/each}
						</select>
					</div>
				{/if}
			</div>
		</section>

		<section class="box" aria-labelledby="where-h">
			<div class="box-h"><h2 class="box-t" id="where-h">Where, in order</h2></div>
			<div class="box-row">
				<ol class="tl" aria-labelledby="where-h">
					<li class="tl-i">
						<span class="tl-b" aria-hidden="true"></span>
						<span class="tl-m">
							{#if startAddress === null}
								<span class="n">Base</span>
								<span class="sub">{data.base ?? 'Where trips start'}</span>
								<button type="button" class="lk-b" onclick={() => (startAddress = '')}
									>Started somewhere else</button
								>
							{:else}
								<label class="n" for="t-from">Started at</label>
								<input
									id="t-from"
									class="ti"
									autocomplete="off"
									placeholder="Where it started"
									bind:value={startAddress}
								/>
								<button type="button" class="lk-b" onclick={() => (startAddress = null)}
									>From the base</button
								>
							{/if}
						</span>
					</li>
					{#each stops as st, i (st.key)}
						<li class="tl-i">
							<span class="tl-b" aria-hidden="true"></span>
							<span class="tl-m">
								{#if st.visits.length > 1}
									<span class="n">{street(siteOf(st.siteId) ?? { street: '', city: '' })}</span>
									{#each st.visits as v (v.entityId)}
										<span class="sub">{nameOf(v.entityId)} · {siteOf(v.siteId)?.label}</span>
									{/each}
								{:else if st.siteId}
									<span class="n"
										>{nameOf(st.visits[0]?.entityId ?? '')} · {siteOf(st.siteId)?.label}</span
									>
									<span class="sub">{street(siteOf(st.siteId) ?? { street: '', city: '' })}</span>
								{:else}
									<span class="n">{st.address}</span>
									<span class="sub"
										>{st.visits.length
											? `For ${nameOf(st.visits[0].entityId)}`
											: 'The business’s own errand'}</span
									>
								{/if}
								{#if st.visits.length === 2}
									{@const second = st.visits[1]}
									<fieldset class="fc asked">
										<legend class="fc-l">Did both ask before it left?</legend>
										<label class="rad">
											<input
												type="radio"
												name="t-asked-{st.key}"
												checked={!second.askedThere}
												onchange={() => askedThere(st, second.entityId, false)}
											/>
											<span class="rad-t">Both asked first</span>
										</label>
										<label class="rad">
											<input
												type="radio"
												name="t-asked-{st.key}"
												checked={second.askedThere}
												onchange={() => askedThere(st, second.entityId, true)}
											/>
											<span class="rad-t"
												>{nameOf(second.entityId).split(' ')[0]} asked once there</span
											>
										</label>
									</fieldset>
								{:else if st.visits.length > 2}
									<fieldset class="fc asked">
										<legend class="fc-l">Who asked once it was there?</legend>
										{#each st.visits as v (v.entityId)}
											<label class="chk">
												<input
													type="checkbox"
													checked={v.askedThere}
													onchange={(e) => askedThere(st, v.entityId, e.currentTarget.checked)}
												/>
												<span class="chk-t">{nameOf(v.entityId)}</span>
											</label>
										{/each}
									</fieldset>
								{/if}
								<button
									type="button"
									class="lk-b"
									aria-label="Take the {nth(i)} stop off"
									onclick={() => removeStop(st.key)}>Take it off</button
								>
							</span>
						</li>
					{/each}
					<li class="tl-i">
						<span class="tl-b" aria-hidden="true"></span>
						<span class="tl-m">
							{#if endAddress === null}
								<span class="n">Back to base</span>
								<button type="button" class="lk-b" onclick={() => (endAddress = '')}
									>Ended somewhere else</button
								>
							{:else}
								<label class="n" for="t-to">Ended at</label>
								<input
									id="t-to"
									class="ti"
									autocomplete="off"
									placeholder="Where it ended"
									bind:value={endAddress}
								/>
								<button type="button" class="lk-b" onclick={() => (endAddress = null)}
									>Back to base</button
								>
							{/if}
						</span>
					</li>
				</ol>
				{#if errors.stops}<div class="err">{@render wrong('stops')}</div>{/if}
			</div>
			<div class="box-row">
				<button
					type="button"
					class="btn"
					onclick={startAdding}
					data-invalid={errors.stops ? '' : undefined}
					aria-describedby={errors.stops ? 't-stops-e' : undefined}>Add a stop</button
				>
			</div>
		</section>

		{#if stops.length}
			<section class="box" aria-labelledby="legs-h">
				<div class="box-h"><h2 class="box-t" id="legs-h">Legs, to whoever caused them</h2></div>
				{#each drives as d, i (d.key + i)}
					{@const w = toWhom(i)}
					{@const billed = billedFor(i)}
					{@const bad = !!errors.miles && !milesOk(d.miles)}
					<div class="box-row leg">
						<span class="line">
							<span class="what">
								<span class="n">{w.who}</span>
								<span class="sub">{d.from} → {d.to}{w.why ? `, ${w.why}` : ''}</span>
							</span>
							<span class="fig"
								><span class="v" class:mut={billed === null}>{money(billed)}</span></span
							>
						</span>
						<span class="mi" class:give={clients.length > 0}>
							<input
								class="ti"
								inputmode="decimal"
								autocomplete="off"
								aria-label="Miles from {d.from} to {d.to}"
								aria-invalid={bad ? 'true' : undefined}
								aria-describedby="t-mi-{i}-c{bad ? ' t-miles-e' : ''}"
								value={d.miles}
								oninput={(e) => (typed = { ...typed, [d.key]: e.currentTarget.value })}
							/>
							{#if clients.length}
								<select
									class="ti"
									aria-label="Who the drive from {d.from} to {d.to} is given to"
									value={givenTo(d.key)}
									onchange={(e) => giveTo(d.key, e.currentTarget.value)}
								>
									<option value="">To whoever caused it</option>
									{#each clients as c (c)}<option value={c}>To {nameOf(c)}</option>{/each}
									<option value="nobody">To nobody</option>
								</select>
							{/if}
						</span>
						<span class="sub" id="t-mi-{i}-c"
							>{['Miles', guessed(d.guess)].filter(Boolean).join(', ')}</span
						>
					</div>
				{/each}
				{#if errors.miles}<div class="box-row err">{@render wrong('miles')}</div>{/if}
			</section>

			<section class="box" aria-labelledby="odo-h">
				<div class="box-h">
					<h2 class="box-t" id="odo-h">Odometer</h2>
					<span class="sub">If it was read</span>
				</div>
				<div class="box-row fields">
					<div class="two">
						<div class="fc">
							<label class="fc-l" for="t-left">Left</label>
							<input
								id="t-left"
								class="ti"
								inputmode="decimal"
								autocomplete="off"
								bind:value={odometerStart}
								aria-invalid={errors.odometer && !odometerStart.trim() ? 'true' : undefined}
								aria-describedby={errors.odometer ? 't-odometer-e' : undefined}
							/>
						</div>
						<div class="fc">
							<label class="fc-l" for="t-back">Got back</label>
							<input
								id="t-back"
								class="ti"
								inputmode="decimal"
								autocomplete="off"
								bind:value={odometerEnd}
								aria-invalid={errors.odometer && !odometerEnd.trim() ? 'true' : undefined}
								aria-describedby={errors.odometer ? 't-odometer-e' : undefined}
							/>
						</div>
					</div>
					{#if errors.odometer}
						{@render wrong('odometer')}
					{:else if odometer}
						<span class="labs">
							{#if odometer.agrees}
								<span class="lab good"
									>{milesOf(String(odometer.read), 'distance')}, as the legs say</span
								>
							{:else}
								<span class="lab warn"
									>It says {milesOf(String(odometer.read), 'distance')}; the legs come to {driven
										? milesOf(driven.toString())
										: 'nothing yet'}</span
								>
							{/if}
						</span>
					{/if}
				</div>
			</section>

			<section class="box" aria-labelledby="comes-h">
				<div class="box-h"><h2 class="box-t" id="comes-h">What it comes to</h2></div>
				<div class="box-row line">
					<span class="what">
						<span class="n">Billed</span>
						<span class="sub"
							>{driven ? milesOf(driven.toString()) : '—'} of {serviceName}{worth?.rate
								? ` at ${unitPrice(worth.rate)}`
								: ''}</span
						>
					</span>
					<span class="fig"><span class="v">{money(worth?.billed ?? null)}</span></span>
				</div>
				{#if vehicle}
					<div class="box-row line">
						<span class="what">
							<span class="n">{vehicle.owner ?? 'Nobody'}, for the {vehicle.name}</span>
							<span class="sub">
								{#if !vehicle.owner}
									It is the business’s, whoever drove it
								{:else if worth?.withheld}
									What it pays them is theirs to see
								{:else if worth?.rule}
									{@const r = paysWhat(worth.rule, { money, unitPrice })}
									{r.v}
									{r.x}, each leg
								{:else if worth && worth.paid === null}
									No vehicle rule reaches them
								{:else}
									By each leg’s own rule
								{/if}
							</span>
						</span>
						{#if vehicle.owner && worth && worth.paid === null && !worth.withheld}<span
								class="lab warn">No rule</span
							>{/if}
						<span class="fig">
							<span class="v" class:mut={!vehicle.owner || worth?.withheld}
								>{vehicle.owner && !worth?.withheld ? money(worth?.paid ?? null) : '—'}</span
							>
						</span>
					</div>
				{/if}
				<!-- What the business keeps is Full's to see (#lib/access). -->
				{#if !data.field}
					<div class="box-row line tot">
						<span class="what"><span class="n">Kept</span></span>
						<span class="fig"
							><span class="v"
								>{money(vehicle ? (worth?.kept ?? null) : (worth?.billed ?? null))}</span
							></span
						>
					</div>
				{/if}
				{#if noSignal && !worth}
					<div class="box-row"><p class="sub none">Worked out when there is a signal.</p></div>
				{/if}
			</section>
		{/if}

		<section class="box" aria-label="Note, and saving">
			<div class="box-row fields">
				<div class="fc">
					<label class="fc-l" for="t-note">What it was for</label>
					<input
						id="t-note"
						class="ti"
						autocomplete="off"
						placeholder="Why it was driven"
						aria-describedby="t-note-c"
						bind:value={note}
					/>
					<p class="fc-c" id="t-note-c">Kept with the trip.</p>
				</div>
			</div>
			<div class="box-row keep">
				<button class="btn pri" {@attach busy(saving && 'Saving the trip')}>Save the trip</button>
				<a class="btn" href={tripId ? resolve('/trips/[id]', { id: tripId }) : resolve('/trips')}
					>Cancel</a
				>
			</div>
		</section>
	</form>
{/if}

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fields > :global(*) {
		max-width: 480px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--bgColor-muted);
	}
	.two {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 12px;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.none {
		margin: 0;
	}
	/* A stop's place, and what can be done with it: link-styled buttons. */
	.lk-b {
		align-self: flex-start;
		padding: 2px 0;
		font: inherit;
		font-size: 12px;
		color: var(--fgColor-accent);
		background: none;
		border: 0;
		cursor: pointer;
	}
	.lk-b:hover {
		text-decoration: underline;
	}
	.tl-m .ti {
		margin: 4px 0;
	}
	.asked {
		margin-top: 8px;
	}
	.leg {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.leg .line {
		min-height: 0;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-wrap: anywhere;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.v.mut {
		color: var(--fgColor-muted);
	}
	.tot {
		background: var(--bgColor-muted);
	}
	/* A drive's miles, and who it is given to, side by side. */
	.mi {
		display: grid;
		grid-template-columns: 6rem;
		gap: 8px;
	}
	.mi.give {
		grid-template-columns: 6rem minmax(0, 1fr);
	}
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.err {
		margin-top: 8px;
	}
</style>
