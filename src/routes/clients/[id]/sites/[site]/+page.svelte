<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import Setting from '#lib/Setting.svelte';
	import { parseSiteField } from '#lib/site-fields.ts';
	import { dated, hours, miles, pct, rateParts } from '#lib/format.ts';
	import { Decimal } from '#lib/decimal.ts';
	import Day from '#lib/Day.svelte';
	import type { PageProps } from './$types';
	import { readJson, readProblem } from '#lib/json.ts';
	import { resolve } from '$app/paths';
	import AddressField from '#lib/AddressField.svelte';
	import type { Resolved } from '#lib/google.ts';

	let { data }: PageProps = $props();
	const s = $derived(data.site);
	// Someone with Field reads a site to work at, and changes nothing (#lib/access).
	const field = $derived(data.user?.access === 'field');
	// How far it is, as the site says it: typed over Google's.
	const roundTrip = $derived(s.typed_round_trip_miles ?? s.google_round_trip_miles);
	const driveMinutes = $derived(s.typed_drive_minutes ?? s.google_drive_minutes);
	// One version for the row, shared by every field on it: a save by any
	// field moves it, and the next field to save sends the new one.
	//
	// Seeded once and then advanced by saves -- but re-seeded whenever the
	// loader runs again, because a reload means the row was read afresh and
	// the version held here is the old one. Without that, anything that
	// invalidates the page (adding a contact, say) would leave every field
	// sending a version the row no longer has, and the next save would be
	// refused as stale by its own page.
	let version = $derived(s.version);
	const api = $derived(`/api/clients/${s.client_slug}/sites/${s.slug}`);

	const made = $derived(rateParts(s.state_rate_pct, s.district_rate_pct));

	/**
	 * THE ADDRESS IS ONE FIELD (8 October 2026). Choosing a place saves it
	 * whole -- its parts as Google gave them and the place's id -- so CDTFA is
	 * asked once, and Google's route measures the drive again; the field, the
	 * round trip and the drive time are drawn afresh from the site as saved.
	 */
	const addressLine = $derived(
		`${s.street}, ${s.city}, ${s.region ?? ''} ${s.postcode}`.replace(/\s+/g, ' ').trim()
	);
	let moving = $state<'' | 'saving' | 'bad'>('');
	let movingWhy = $state('');
	// Why the drive was not measured, when it was asked for and could not be.
	let unmeasured = $state('');

	/**
	 * GOOGLE'S STAYS IN VIEW (12 October 2026). The box is what was typed, with
	 * Google's figure greyed in it while nothing is; once something is, the line
	 * under it says what Google's was, since the box no longer can.
	 */
	function said(typed: string, google: string | number | null, route: string, figure: string) {
		if (typed.trim())
			return google === null
				? 'Yours. Google has not measured it'
				: `Yours. Google's route is ${google}; empty the box to use it`;
		return google === null
			? `${figure}. Google has not measured it; type it if you know it`
			: `${route}. Type yours to use it instead`;
	}
	async function moveTo(a: Resolved) {
		moving = 'saving';
		const r = await fetch(api, {
			method: 'PATCH',
			headers: {
				'content-type': 'application/json',
				...(version ? { 'if-match': `"${version}"` } : {})
			},
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
			moving = 'bad';
			movingWhy = r
				? (Object.values(p?.errors ?? {})[0] ?? p?.detail ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		const done = (await readJson(r).catch(() => null)) as { unmeasured?: string | null } | null;
		unmeasured = done?.unmeasured ?? '';
		moving = '';
		await refreshAll();
	}

	/**
	 * ASK CDTFA AGAIN (7 November 2026), in the box's header as GitHub puts
	 * Check for updates beside Last checked. What CDTFA answers is said under
	 * it, as Primer's inline message, and goes into the history whether the
	 * rate moved or not.
	 */
	let asking = $state(false);
	let answered = $state<{ good: boolean; text: string } | null>(null);
	async function askAgain() {
		asking = true;
		answered = null;
		const r = await fetch(`${api}/ask-cdtfa`, { method: 'POST' }).catch(() => null);
		asking = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			answered = {
				good: false,
				text: !r
					? 'CDTFA was not asked — no connection.'
					: r.status === 502
						? `${p?.detail ?? 'CDTFA did not answer.'} Nothing has changed.`
						: (p?.detail ?? 'CDTFA was not asked.')
			};
			if (r?.status === 409) await refreshAll();
			return;
		}
		const a = (await readJson(r)) as { rate: string; was: string; changed: boolean };
		answered = {
			good: true,
			text: a.changed
				? `CDTFA now says ${pct(a.rate)}, ${Decimal.from(a.rate).gt(a.was) ? 'up' : 'down'} from ${pct(a.was)}. Lines written here from now on are charged at it.`
				: `CDTFA still says ${pct(a.rate)}.`
		};
		await refreshAll();
	}

	// Why each answer was asked for, and what it said. The first has nothing
	// before it to have moved from.
	const why = (c: { note: string | null; changed: boolean; first: boolean }) =>
		[
			c.note ? c.note[0].toUpperCase() + c.note.slice(1) : null,
			c.first ? (c.note ? null : 'The first answer') : c.changed ? 'The rate moved' : 'Unchanged'
		]
			.filter(Boolean)
			.join(' · ');

	// Adding somebody: an existing person of this client's, or a new one.
	let adding = $state(false);
	let picked = $state('');
	let newName = $state('');
	let newEmail = $state('');
	let newPhone = $state('');
	let saying = $state('');

	async function attach(primary = false) {
		saying = '';
		const body = picked
			? { contact_id: picked, is_primary: primary }
			: { name: newName, email: newEmail || null, phone: newPhone || null, is_primary: primary };
		const r = await fetch(`${api}/contacts`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!r.ok) {
			const b = await readProblem(r);
			saying =
				b.errors?.name ?? b.errors?.contact_id ?? b.detail ?? b.title ?? 'That did not save.';
			return;
		}
		adding = false;
		picked = newName = newEmail = newPhone = '';
		await refreshAll();
	}

	async function detach(contact_id: string) {
		await fetch(`${api}/contacts`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ contact_id })
		});
		await refreshAll();
	}

	async function makeFirst(contact_id: string) {
		await fetch(`${api}/contacts`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ contact_id, is_primary: true })
		});
		await refreshAll();
	}
</script>

<Top
	title={s.label}
	sub="{s.client} · {pct(s.rate_pct)}"
	trail={[
		{ href: resolve('/clients'), label: 'Entities' },
		{ href: resolve('/clients/[id]', { id: s.client_slug }), label: s.client },
		{ href: resolve('/clients/[id]/sites', { id: s.client_slug }), label: 'Sites' }
	]}
/>

<div class="pad">
	<div class="tiles">
		<div class="tile">
			<span class="k">Charged here</span>
			<span class="v">{pct(s.rate_pct)}</span>
			<span class="s">{made}</span>
		</div>
		<div class="tile">
			<span class="k">Worked</span>
			<span class="v sm">{hours(data.worked.hours, 'glance')}</span>
			<span class="s">
				{data.worked.entries}
				{Number(data.worked.entries) === 1 ? 'entry' : 'entries'}{#if data.worked.last}, last <Day
						iso={data.worked.last}
					/>{/if}
			</span>
		</div>
	</div>

	{#if field}
		<div class="sec">
			<div class="sec-h"><h2>Where it is</h2></div>
			<div class="rows">
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{addressLine || 'No address on file'}</div>
						{#if roundTrip || driveMinutes !== null}
							<div class="rec-s">
								{[
									roundTrip ? `${miles(roundTrip, 'distance')} there and back` : null,
									driveMinutes !== null ? `${driveMinutes} min each way` : null
								]
									.filter(Boolean)
									.join(' · ')}
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{:else}
		<div class="sec">
			<div class="sec-h">
				<h2>Where it is</h2>
				<span class="sp"></span>
				<span class="chip">Changing this re-asks CDTFA</span>
			</div>
			<div class="rows inset">
				<Setting
					name="label"
					label="What this client calls it"
					value={s.label}
					endpoint={api}
					{version}
					onversion={(v) => (version = v)}
					validate={parseSiteField}
					required
				/>
				<Setting
					name="slug"
					label="In the URL"
					value={s.slug}
					endpoint={api}
					{version}
					onversion={(v) => (version = v)}
					validate={parseSiteField}
					hint="Renaming the site above leaves this alone, so a link somebody kept keeps working"
					onsaved={(slug) =>
						goto(resolve('/clients/[id]/sites/[site]', { id: s.client_slug, site: slug }), {
							replaceState: true
						})}
					required
				/>
				{#key addressLine + (s.google_place_id ?? '')}
					<div class="fld">
						<label for="address-input">Address</label>
						<AddressField
							label=""
							value={addressLine}
							placeId={s.google_place_id}
							onchosen={moveTo}
						/>
						{#if moving === 'saving'}
							<small>Asking CDTFA, and Google how far it is…</small>
						{:else if moving === 'bad'}
							<small class="why">{movingWhy}</small>
						{:else if unmeasured}
							<small class="why">{unmeasured}</small>
						{/if}
					</div>
					<Setting
						name="typed_round_trip_miles"
						label="Round trip"
						value={s.typed_round_trip_miles ?? ''}
						placeholder={s.google_round_trip_miles ?? ''}
						endpoint={api}
						{version}
						onversion={(v) => (version = v)}
						validate={parseSiteField}
						inputmode="decimal"
						hint={(typed) =>
							said(
								typed,
								s.google_round_trip_miles,
								"Google's route from the business and back",
								'Miles from the business and back'
							)}
					/>
					<Setting
						name="typed_drive_minutes"
						label="Drive time"
						value={s.typed_drive_minutes ?? ''}
						placeholder={s.google_drive_minutes === null ? '' : String(s.google_drive_minutes)}
						endpoint={api}
						{version}
						onversion={(v) => (version = v)}
						validate={parseSiteField}
						inputmode="numeric"
						hint={(typed) =>
							said(typed, s.google_drive_minutes, "Google's route, one way", 'Minutes, one way')}
					/>
				{/key}
			</div>
		</div>
	{/if}

	<div class="sec">
		<div class="sec-h">
			<h2>Who to ask for</h2>
			<span class="sp"></span>
			{#if !adding && !field}
				<button class="btn sm" onclick={() => (adding = true)}>Add</button>
			{/if}
		</div>
		<div class="rows">
			{#each data.people as p (p.id)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">
							<a href={resolve('/clients/contacts/[id]', { id: p.id })}>{p.name}</a
							>{#if p.is_primary}&nbsp;<span class="lt">· answers first</span>{/if}
						</div>
						<div class="rec-s">
							{[p.email, p.phone].filter(Boolean).join(' · ') || 'no details on file'}
						</div>
					</div>
					{#if !field}
						<div class="rec-n acts">
							{#if !p.is_primary}
								<button class="btn sm" onclick={() => makeFirst(p.id)}>First</button>
							{/if}
							<button class="btn sm" onclick={() => detach(p.id)}>Remove</button>
						</div>
					{/if}
				</div>
			{:else}
				<div class="rec warn">
					<div class="rec-m">
						<div class="rec-t">Nobody named</div>
						<div class="rec-s">
							Turning up means asking for whoever is about, and the client's primary answers instead
						</div>
					</div>
				</div>
			{/each}

			{#if adding}
				<div class="rec add">
					<div class="rec-m">
						{#if data.elsewhere.length}
							<label class="fld">
								<span>Somebody this client already has</span>
								<select class="inp" bind:value={picked}>
									<option value="">Somebody new</option>
									{#each data.elsewhere as c (c.id)}
										<option value={c.id}>{c.name}</option>
									{/each}
								</select>
							</label>
						{/if}
						{#if !picked}
							<label class="fld">
								<span>Name</span>
								<input class="inp" bind:value={newName} placeholder="Who to ask for" />
							</label>
							<label class="fld">
								<span>Email</span>
								<input class="inp" bind:value={newEmail} inputmode="email" />
							</label>
							<label class="fld">
								<span>Phone</span>
								<input class="inp" bind:value={newPhone} inputmode="tel" />
							</label>
						{/if}
						{#if saying}<div class="rec-s bad">{saying}</div>{/if}
						<div class="acts">
							<button class="btn pri sm" onclick={() => attach(data.people.length === 0)}>
								Add
							</button>
							<button class="btn sm" onclick={() => ((adding = false), (saying = ''))}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Primer's boxes, as the rest of the page will be when Entities moves to it. -->
	<div class="primer cdtfa">
		<section class="box" aria-labelledby="cdtfa-h">
			<div class="box-h">
				<h2 class="box-t" id="cdtfa-h">What CDTFA has said</h2>
				{#if !field}
					<button type="button" class="btn sm" disabled={asking} onclick={askAgain}
						>{asking ? 'Asking CDTFA…' : 'Ask CDTFA again'}</button
					>
				{/if}
			</div>
			{#if answered}
				<p
					class="box-row im {answered.good ? 'good' : 'crit'}"
					role={answered.good ? 'status' : 'alert'}
				>
					<Octicon name={answered.good ? 'check' : 'alert'} />{answered.text}
				</p>
			{/if}
			<div class="box-row kv">
				<span class="kv-l">Rate</span>
				<span class="kv-v">
					<span class="rt">{pct(s.rate_pct)}</span>
					<span class="sub">{made}</span>
				</span>
			</div>
			<div class="box-row kv">
				<span class="kv-l">Area</span>
				<span class="kv-v">
					<span>{s.jurisdiction}</span>
					<span class="sub">Tax area {s.tax_area_code} · nothing here is ours to set</span>
				</span>
			</div>
			<div class="box-row kv">
				<span class="kv-l">Last asked</span>
				<span class="kv-v">
					<span>{dated(s.verified_on)}</span>
					{#if s.stale}
						<span class="im warn"
							><Octicon name="alert" />Over {data.staleAfter} days ago. A district can start or end in
							that time.</span
						>
					{/if}
				</span>
			</div>
		</section>

		{#if data.checks.length}
			<section class="box" aria-labelledby="history-h">
				<div class="box-h"><h2 class="box-t" id="history-h">History</h2></div>
				{#each data.checks as c (c.id)}
					<div class="box-row was">
						<span class="who">
							<span class="n">{dated(c.on)}</span>
							<span class="sub">{why(c)}</span>
						</span>
						<span class="r">{pct(c.rate_pct)}</span>
					</div>
				{/each}
				{#if s.asked > data.checks.length}
					<p class="box-row more">The latest {data.checks.length} of {s.asked}.</p>
				{/if}
			</section>
		{/if}
	</div>
</div>

<style>
	.why {
		color: var(--crit);
	}
	.acts {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.rec.add .rec-m {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
	}
	.bad {
		color: var(--crit);
	}
	.cdtfa {
		display: flex;
		flex-direction: column;
		gap: inherit;
	}
	.box-row {
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.kv {
		display: grid;
		grid-template-columns: minmax(0, 30%) minmax(0, 1fr);
		align-items: center;
		gap: 4px 16px;
	}
	.kv-l,
	.n {
		font-weight: 600;
	}
	.kv-v,
	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.kv-v {
		color: var(--ink-2);
	}
	.rt {
		font-variant-numeric: tabular-nums;
	}
	.sub,
	.more {
		font-size: 12px;
		color: var(--ink-3);
	}
	.more {
		min-height: 0;
	}
	.was {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.who {
		flex: 1 1 auto;
	}
	.r {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	/* Primer's inline message: an icon and a line, in the colour of what happened. */
	.im {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-size: 12px;
		line-height: 18px;
	}
	.im :global(svg) {
		margin-top: 1px;
	}
	p.im {
		min-height: 0;
		font-size: 14px;
		line-height: 20px;
	}
	p.im :global(svg) {
		margin-top: 2px;
	}
	.im.good {
		color: var(--good);
	}
	.im.warn {
		color: var(--warn);
	}
	.im.crit {
		color: var(--crit);
	}
	@media (max-width: 543px) {
		.kv {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
