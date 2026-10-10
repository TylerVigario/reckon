<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
	import { parseSiteField } from '#lib/site-fields.ts';
	import { hours, pct, rateParts } from '#lib/format.ts';
	import Day from '#lib/Day.svelte';
	import type { PageProps } from './$types';
	import { readProblem } from '#lib/json.ts';
	import { resolve } from '$app/paths';
	import AddressField from '#lib/AddressField.svelte';
	import type { Resolved } from '#lib/google.ts';

	let { data }: PageProps = $props();
	const s = $derived(data.site);
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
	 * asked once; the field is drawn afresh from the site as saved.
	 */
	const addressLine = $derived(
		`${s.street}, ${s.city}, ${s.region ?? ''} ${s.postcode}`.replace(/\s+/g, ' ').trim()
	);
	let moving = $state<'' | 'saving' | 'bad'>('');
	let movingWhy = $state('');
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
		moving = '';
		await refreshAll();
	}

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
						<small>Asking CDTFA…</small>
					{:else if moving === 'bad'}
						<small class="why">{movingWhy}</small>
					{/if}
				</div>
			{/key}
			<Setting
				name="round_trip_miles"
				label="Round trip"
				value={s.round_trip_miles ?? ''}
				endpoint={api}
				{version}
				onversion={(v) => (version = v)}
				validate={parseSiteField}
				inputmode="decimal"
				hint="Miles from the yard and back"
			/>
			<Setting
				name="drive_minutes"
				label="Drive time"
				value={s.drive_minutes ?? ''}
				endpoint={api}
				{version}
				onversion={(v) => (version = v)}
				validate={parseSiteField}
				inputmode="numeric"
				hint="Minutes, one way"
			/>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h">
			<h2>Who to ask for</h2>
			<span class="sp"></span>
			{#if !adding}
				<button class="btn sm" onclick={() => (adding = true)}>Add</button>
			{/if}
		</div>
		<div class="rows">
			{#each data.people as p (p.id)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">
							{p.name}{#if p.is_primary}&nbsp;<span class="lt">· answers first</span>{/if}
						</div>
						<div class="rec-s">
							{[p.email, p.phone].filter(Boolean).join(' · ') || 'no details on file'}
						</div>
					</div>
					<div class="rec-n acts">
						{#if !p.is_primary}
							<button class="btn sm" onclick={() => makeFirst(p.id)}>First</button>
						{/if}
						<button class="btn sm" onclick={() => detach(p.id)}>Remove</button>
					</div>
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

	<div class="sec">
		<div class="sec-h">
			<h2>What CDTFA has said</h2>
			<span class="sp"></span>
			{#if s.stale}
				<span class="chip warn"
					><span class="dot"></span>Last asked <Day iso={s.verified_on} /></span
				>
			{:else}
				<span class="chip good"><span class="dot"></span>Asked <Day iso={s.verified_on} /></span>
			{/if}
		</div>
		<div class="rows">
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">{s.jurisdiction}</div>
					<div class="rec-s">Tax area {s.tax_area_code} · nothing here is ours to set</div>
				</div>
				<div class="rec-n"><span class="rec-v">{pct(s.rate_pct)}</span></div>
			</div>
			{#each data.checks as c (c.id)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t lt"><Day iso={c.on} /></div>
						<div class="rec-s">{c.note ?? (c.changed ? 'The rate moved' : 'Unchanged')}</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">{pct(c.rate_pct)}</span></div>
				</div>
			{/each}
		</div>
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
</style>
