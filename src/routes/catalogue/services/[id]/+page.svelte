<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Detail from '#lib/Detail.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import PriceForm from '#lib/service/PriceForm.svelte';
	import RuleForm from '#lib/service/RuleForm.svelte';
	import { dated, increment } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { forInput } from '#lib/currency.ts';
	import { PAYS_FOR, paysWhat } from '#lib/pay-words.ts';
	import { parseServiceField } from '#lib/service-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto, refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * A service, as Primer boxes: what it charges, who it pays, what the
	 * business keeps, and what it is -- each detail changed in place. Retire,
	 * offer again and delete are in its menu, each asking first in a dialog,
	 * as a person's are on Team.
	 */
	let { data }: PageProps = $props();

	const s = $derived(data.service);
	const endpoint = $derived(`/api/services/${data.service.id}`);

	type Price = (typeof data.prices)[number];
	type Rule = (typeof data.rules)[number];

	/** Which form is open, and what it is changing, if anything. */
	let editing = $state<
		null | { kind: 'price'; preset: Price | null } | { kind: 'rule'; preset: Rule | null }
	>(null);
	let problem = $state('');

	const per = $derived(s.unit === 'hour' ? 'an hour' : s.unit === 'mile' ? 'a mile' : 'each');
	const perShort = $derived(s.unit === 'hour' ? '/hr' : s.unit === 'mile' ? '/mi' : ' each');

	/** What it is charged per, how finely, and at least what -- the header's line. */
	const terms = $derived(
		[
			s.unit === 'each' ? 'A flat charge each time' : `Charged per ${s.unit}`,
			s.unit === 'hour' ? `billed ${increment(s.bill_to_nearest_seconds)}` : null,
			s.minimum_charge ? `at least ${money(s.minimum_charge)} an entry` : null,
			s.active ? null : 'retired'
		]
			.filter(Boolean)
			.join(' · ')
	);

	// The figures that matter for a service, in the order they matter: what it
	// charges, then what a team is charged, then what the business keeps. What
	// it pays out is a rule below, not a headline.
	const price = $derived(data.prices.find((p) => p.client === null && p.state === 'current'));
	const one = $derived(data.hour.filter((h) => h.crew === 'one'));
	const team = $derived(data.hour.find((h) => h.crew === 'team'));

	const when = (r: { state: string; effective_from: string }) =>
		r.state === 'scheduled'
			? `Takes over ${dated(r.effective_from)}`
			: `Since ${dated(r.effective_from)}`;

	// A row can be taken back until the day it starts has passed: a scheduled
	// change, or one entered by mistake today. After that it is history.
	const takeable = (r: { state: string; effective_from: string }) =>
		r.state === 'scheduled' || r.effective_from === data.today;

	async function refresh() {
		editing = null;
		await refreshAll();
	}

	// A row that started today has already priced or paid today's work, and
	// taking it back re-figures that work, so it asks. A scheduled one has
	// touched nothing yet, and goes at one tap.
	let taking = $state<null | { kind: 'prices' | 'rules'; id: string; what: string }>(null);
	let takingBack = $state(false);
	function offerToTakeBack(
		kind: 'prices' | 'rules',
		r: { id: string; state: string },
		what: string
	) {
		if (r.state === 'scheduled') void takeBack(kind, r.id);
		else taking = { kind, id: r.id, what };
	}

	async function takeBack(kind: 'prices' | 'rules', id: string) {
		problem = '';
		const r = await fetch(`${endpoint}/${kind}/${id}`, { method: 'DELETE' }).catch(() => null);
		if (!r) {
			problem = 'Not taken back — no connection.';
			return;
		}
		if (!r.ok) {
			const b = await readProblem(r);
			problem = b.detail ?? b.title ?? 'That was not taken back.';
			return;
		}
		await refreshAll();
	}

	// What happens to the service as a whole lives in the header: delete one
	// nothing has used, retire one that has, offer a retired one again.
	// Deleting asks twice: the first tap says what will happen and offers a way
	// out at the top of the page, and only the second sends anything.
	let deleting = $state<'idle' | 'asking' | 'working'>('idle');
	let offering = $state(false);
	// Retiring asks too: it is undone as easily, but it reaches past the
	// service, into the timer, the agreements and the trips that bill by it.
	let retiring = $state(false);
	const unused = $derived(
		data.used.entries === 0 && data.used.legs === 0 && data.used.agreements === 0
	);
	const usedBy = $derived(
		[
			data.used.entries
				? `${data.used.entries} time ${data.used.entries === 1 ? 'entry' : 'entries'}`
				: null,
			data.used.legs ? `${data.used.legs} trip ${data.used.legs === 1 ? 'leg' : 'legs'}` : null,
			data.used.agreements
				? `${data.used.agreements} ${data.used.agreements === 1 ? 'agreement' : 'agreements'}`
				: null
		]
			.filter(Boolean)
			.join(', ')
	);

	async function setOffered(active: boolean) {
		offering = true;
		problem = '';
		const r = await fetch(endpoint, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { active: String(active) } })
		}).catch(() => null);
		offering = false;
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).detail ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		await refreshAll();
	}

	async function remove() {
		deleting = 'working';
		problem = '';
		const r = await fetch(endpoint, { method: 'DELETE' }).catch(() => null);
		if (r?.ok) {
			await goto(resolve('/catalogue/services'));
			return;
		}
		deleting = 'idle';
		problem = r
			? ((await readProblem(r)).detail ?? 'It was not deleted.')
			: 'Not deleted — no connection.';
	}

	const menu = $derived(
		unused
			? [{ label: 'Delete', danger: true, onselect: (): void => void (deleting = 'asking') }]
			: s.active
				? [{ label: 'Retire', onselect: (): void => void (retiring = true) }]
				: [{ label: 'Offer again', onselect: (): void => void setOffered(true) }]
	);

	const YES_NO = [
		{ value: 'true', label: 'Yes' },
		{ value: 'false', label: 'No' }
	];
	const STEPS = [
		{ value: '', label: 'The exact time' },
		{ value: '1', label: 'The second' },
		{ value: '60', label: 'The minute' },
		{ value: '360', label: 'Six minutes' },
		{ value: '900', label: 'The quarter hour' },
		{ value: '1800', label: 'The half hour' },
		{ value: '3600', label: 'The hour' }
	];
	// A step somebody set outside this list still shows as what it is.
	const steps = $derived(
		s.bill_to_nearest_seconds === null ||
			STEPS.some((o) => o.value === String(s.bill_to_nearest_seconds))
			? STEPS
			: [
					...STEPS,
					{
						value: String(s.bill_to_nearest_seconds),
						label: increment(s.bill_to_nearest_seconds).replace(/^to the (nearest )?/, '')
					}
				]
	);
</script>

<Top title={s.name} sub={terms} back={resolve('/catalogue/services')} backLabel="Services">
	{#snippet actions()}
		<ActionMenu label="Actions for {s.name}" items={menu} />
	{/snippet}
</Top>

<div class="pad primer">
	{#if !s.active}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t">Retired: not offered for new work</p>
				<p class="banner-d">
					It stays under its name on everything it billed{usedBy ? `: ${usedBy}` : ''}. Offer it
					again, from its menu, to put it back as it was.
				</p>
			</div>
		</div>
	{/if}
	{#if problem}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}

	<section class="box" aria-labelledby="hour-h">
		<div class="box-h"><h2 class="box-t" id="hour-h">At a glance</h2></div>
		<div class="box-row fig">
			<span>{s.unit === 'hour' ? 'One person' : 'Charged'}</span>
			{#if price}
				<span><span class="v">{unitPrice(price.rate)}</span> {per}</span>
			{:else}
				<span class="muted">Not priced for every client</span>
			{/if}
		</div>
		{#if team}
			<div class="box-row fig">
				<span>The team</span>
				<span><span class="v">{money(team.billed)}</span> an hour, together</span>
			</div>
		{/if}
		{#if one.length === 1 && !one[0].unpaid}
			<div class="box-row fig">
				<span>Kept</span>
				<span
					><span class="v good">{money(one[0].kept)}</span> an hour{team &&
					team.kept === one[0].kept
						? ', one person or the team'
						: ''}</span
				>
			</div>
		{/if}
	</section>

	<section class="box" aria-labelledby="prices-h">
		<div class="box-h">
			<h2 class="box-t" id="prices-h">What the client pays</h2>
			{#if editing?.kind !== 'price'}
				<button
					type="button"
					class="btn sm"
					onclick={() => (editing = { kind: 'price', preset: null })}
					>{data.prices.length ? 'Add a price' : 'Price it'}</button
				>
			{/if}
		</div>
		{#each data.prices as p (p.id)}
			<div class="box-row line">
				<span class="what">
					<span class="n">{p.client ?? 'Every client'}</span>
					<span class="sub">
						{when(p)}{s.unit === 'hour'
							? Number(p.additional_rate) > 0
								? ` · +${unitPrice(p.additional_rate)} for each additional person`
								: ' · the same however many work it'
							: ''}
					</span>
					{#if p.state === 'current' || takeable(p)}
						<span class="acts">
							{#if p.state === 'current'}
								<button
									type="button"
									class="btn sm"
									onclick={() => (editing = { kind: 'price', preset: p })}>Change</button
								>
							{/if}
							{#if takeable(p)}
								<button
									type="button"
									class="btn sm"
									onclick={() => offerToTakeBack('prices', p, `${unitPrice(p.rate)}${perShort}`)}
									>Take back</button
								>
							{/if}
						</span>
					{/if}
				</span>
				{#if p.state === 'scheduled'}<span class="lab acc">Scheduled</span>{/if}
				<span class="end-fig">
					<span class="v">{unitPrice(p.rate)}</span>
					<span class="sub">{per}</span>
				</span>
			</div>
		{/each}
		{#each data.covered as c (c.agreement_id)}
			<a class="box-row line" href={resolve('/catalogue/agreements/[id]', { id: c.agreement_id })}>
				<span class="what">
					<span class="n">{c.who} · {c.site ?? 'the whole client'}</span>
					<span class="sub">Covered by their agreement: not billed by the hour</span>
				</span>
				<span class="lab acc">Retainer</span>
				<span class="end-fig">
					<span class="v">{c.allotment === 'unlimited' ? 'Unlimited' : c.hours}</span>
					{#if c.allotment !== 'unlimited'}<span class="sub">hours</span>{/if}
				</span>
			</a>
		{/each}
		{#if editing?.kind === 'price'}
			<PriceForm
				serviceId={s.id}
				unit={s.unit}
				clients={data.clients}
				today={data.today}
				preset={editing.preset}
				onsaved={refresh}
				oncancel={() => (editing = null)}
			/>
		{:else if data.prices.length === 0 && data.covered.length === 0}
			<p class="box-row muted">Not priced yet: nothing can be billed under it.</p>
		{/if}
	</section>

	<section class="box" aria-labelledby="rules-h">
		<div class="box-h">
			<h2 class="box-t" id="rules-h">Who is paid, and how</h2>
			{#if editing?.kind !== 'rule'}
				<button
					type="button"
					class="btn sm"
					onclick={() => (editing = { kind: 'rule', preset: null })}>Add a rule</button
				>
			{/if}
		</div>
		{#each data.rules as r (r.id)}
			{@const w = paysWhat(r, { money, unitPrice })}
			<div class="box-row line">
				<span class="what">
					<span class="n">{r.payee} · {PAYS_FOR[r.pays_for]}</span>
					<span class="sub">{r.client ?? 'Every client'} · {when(r)} · {w.v} {w.x}</span>
					{#if r.state === 'current' || takeable(r)}
						<span class="acts">
							{#if r.state === 'current'}
								<button
									type="button"
									class="btn sm"
									onclick={() => (editing = { kind: 'rule', preset: r })}>Change</button
								>
							{/if}
							{#if takeable(r)}
								<button
									type="button"
									class="btn sm"
									onclick={() => offerToTakeBack('rules', r, 'this pay rule')}>Take back</button
								>
							{/if}
						</span>
					{/if}
				</span>
				{#if r.state === 'scheduled'}<span class="lab acc">Scheduled</span>{/if}
			</div>
		{:else}
			{#if editing?.kind !== 'rule'}
				<p class="box-row muted">Nobody is paid for it: everything it charges is kept.</p>
			{/if}
		{/each}
		{#if editing?.kind === 'rule'}
			<RuleForm
				serviceId={s.id}
				roles={data.roles}
				people={data.people}
				clients={data.clients}
				today={data.today}
				preset={editing.preset}
				onsaved={refresh}
				oncancel={() => (editing = null)}
			/>
		{/if}
	</section>

	{#if data.hour.length}
		<section class="box" aria-labelledby="kept-h">
			<div class="box-h"><h2 class="box-t" id="kept-h">What the business keeps</h2></div>
			<div class="tbl">
				<table>
					<thead>
						<tr><th>An hour, worked by</th><th>Billed</th><th>Paid out</th><th>Kept</th></tr>
					</thead>
					<tbody>
						{#each data.hour as h (h.crew + h.who)}
							<tr>
								<td>{h.crew === 'team' ? 'The team' : h.who}</td>
								<td>{money(h.billed)}</td>
								<td class:muted={h.unpaid}>{h.unpaid ? 'no rule' : money(h.paid)}</td>
								<td class="kept">{money(h.kept)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	{#if data.earlier}
		<p class="note">
			<a href={resolve('/catalogue/services/[id]/history', { id: s.id })}
				>Earlier prices and pay rules</a
			>: {data.earlier} no longer in force.
		</p>
	{/if}

	<section class="box" aria-labelledby="is-h">
		<div class="box-h"><h2 class="box-t" id="is-h">What it is</h2></div>
		<Detail
			name="name"
			label="Name"
			value={s.name}
			required
			{endpoint}
			validate={parseServiceField}
			onsaved={refreshAll}
		/>
		<Detail
			name="unit"
			label="Charged per"
			value={s.unit}
			options={[
				{ value: 'hour', label: 'Hour' },
				{ value: 'mile', label: 'Mile' },
				{ value: 'each', label: 'Each, a flat rate' }
			]}
			{endpoint}
			validate={parseServiceField}
			onsaved={refreshAll}
		/>
		{#if s.unit === 'hour'}
			<Detail
				name="bill_to_nearest_seconds"
				label="Billed to"
				value={s.bill_to_nearest_seconds === null ? '' : String(s.bill_to_nearest_seconds)}
				options={steps}
				hint="Pay is never rounded: it is counted as worked."
				{endpoint}
				validate={parseServiceField}
				onsaved={refreshAll}
			/>
		{/if}
		<Detail
			name="minimum_charge"
			label="Minimum charge"
			value={forInput(s.minimum_charge)}
			shown={s.minimum_charge ? money(s.minimum_charge) : ''}
			inputmode="decimal"
			hint="The least one entry bills, however short."
			{endpoint}
			validate={parseServiceField}
			onsaved={refreshAll}
		/>
		<Detail
			name="time_tracked"
			label="On the timer"
			value={String(s.time_tracked)}
			options={YES_NO}
			{endpoint}
			validate={parseServiceField}
			onsaved={refreshAll}
		/>
		<Detail
			name="taxable"
			label="Taxable"
			value={String(s.taxable)}
			options={YES_NO}
			{endpoint}
			validate={parseServiceField}
			onsaved={refreshAll}
		/>
	</section>
</div>

<Dialog
	open={deleting !== 'idle'}
	title="Delete {s.name}?"
	go="Delete"
	going="Deleting…"
	working={deleting === 'working'}
	tone="danger"
	ongo={remove}
	onclose={() => (deleting = 'idle')}
>
	<p>Its prices and pay rules go with it. This can’t be undone.</p>
</Dialog>

<Dialog
	open={retiring}
	title="Retire {s.name}?"
	go="Retire"
	going="Retiring…"
	working={offering}
	ongo={async () => {
		await setOffered(false);
		retiring = false;
	}}
	onclose={() => (retiring = false)}
>
	<p>
		It can no longer be chosen for new work or covered by an agreement{s.time_tracked
			? ', and it leaves the timer'
			: ''}. What it has billed keeps its name{usedBy ? `: ${usedBy}` : ''}.
	</p>
	{#if s.unit === 'mile'}
		<p>
			While it is retired, a trip that bills its miles as {s.name} is refused, including one still waiting
			to send from someone’s phone.
		</p>
	{/if}
	<p>Offer it again to put it back as it was.</p>
</Dialog>

<Dialog
	open={taking !== null}
	title="Take back {taking?.what ?? ''}?"
	go="Take back"
	going="Taking back…"
	working={takingBack}
	tone="danger"
	ongo={async () => {
		if (!taking) return;
		takingBack = true;
		await takeBack(taking.kind, taking.id);
		takingBack = false;
		taking = null;
	}}
	onclose={() => (taking = null)}
>
	<p>
		It has been in force since today. Today’s work not yet {taking?.kind === 'prices'
			? 'billed goes back to the price'
			: 'paid goes back to the rule'} before it, if there was one. It isn’t kept anywhere: to have it
		again, it is entered again.
	</p>
</Dialog>

<style>
	.box-row {
		margin: 0;
	}
	.fig {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		box-sizing: border-box;
	}
	.fig .v,
	.end-fig .v {
		font-family: var(--f-mono);
		font-weight: 600;
		text-align: right;
	}
	.v.good {
		color: var(--good);
	}
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		box-sizing: border-box;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 6px;
	}
	.lab {
		flex: 0 0 auto;
	}
	.end-fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}
	/* Figures line up by column; the kept column is the answer. */
	.tbl {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	th {
		font-size: 12px;
		font-weight: 600;
		color: var(--ink-3);
		text-align: right;
		padding: 8px 16px;
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}
	td {
		padding: 10px 16px;
		border-bottom: 1px solid var(--line-soft);
		text-align: right;
		font-family: var(--f-mono);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	th:first-child,
	td:first-child {
		text-align: left;
		font-family: inherit;
		white-space: normal;
	}
	tr:last-child td {
		border-bottom: 0;
	}
	td.kept {
		font-weight: 700;
		color: var(--good);
	}
</style>
