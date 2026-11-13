<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Detail from '#lib/Detail.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import CoverageForm from '#lib/agreement/CoverageForm.svelte';
	import { dated, hours, span } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { forInput } from '#lib/currency.ts';
	import { paysWhat } from '#lib/pay-words.ts';
	import { parseAgreementField } from '#lib/agreement-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto, refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * An agreement, as Primer boxes: what it charges and for where, what it
	 * covers and how much of that this month has used, who is paid differently
	 * under it, what it has charged, and its terms -- each changed in place.
	 * Ending, carrying on and deleting are in its menu, each asking first in a
	 * dialog.
	 */
	let { data }: PageProps = $props();

	const a = $derived(data.agreement);
	const endpoint = $derived(`/api/agreements/${data.agreement.id}`);

	type Cover = (typeof data.covers)[number];

	const PERIOD: Record<string, string> = {
		weekly: 'week',
		monthly: 'month',
		quarterly: 'quarter',
		annually: 'year'
	};
	const period = $derived(PERIOD[a.billing_interval] ?? 'period');
	/** Whose it is: one site, or the client wherever the work is. */
	const where = $derived(a.site ?? 'The whole client');

	const sub = $derived(
		[
			where,
			`${money(a.price)} a ${period}`,
			a.ended
				? `ended ${dated(a.ends_on)}`
				: a.ends_on
					? `until ${dated(a.ends_on)}`
					: `since ${dated(a.starts_on)}`
		].join(' · ')
	);

	/** An allotment said the way it would be read out. */
	function allotment(c: Cover): string {
		if (c.allotment === 'unlimited') return 'Unlimited';
		const past =
			c.overage === 'bill'
				? 'then billed'
				: c.overage === 'no_charge'
					? 'then free'
					: 'then refused';
		return `${Number(c.included_hours)} hours a ${period}${a.site ? '' : ' across its sites'}, ${past}`;
	}

	let editing = $state<null | { preset: Cover | null }>(null);
	let problem = $state('');
	let asking = $state<'idle' | 'delete' | 'end' | 'carry' | 'working'>('idle');
	// Stopping covering a service asks first: its unbilled work under this
	// agreement is billed by the hour instead, and its terms are not kept.
	let uncovering = $state<Cover | null>(null);
	let stopping = $state(false);
	let endOn = $state('');

	async function refresh() {
		editing = null;
		await refreshAll();
	}

	/** Every write on this screen answers the same way: reload, or say why not. */
	async function send(url: string, init: RequestInit, failed: string) {
		problem = '';
		const r = await fetch(url, init).catch(() => null);
		if (!r) {
			problem = `${failed} — no connection.`;
			return false;
		}
		if (!r.ok) {
			const b = await readProblem(r);
			problem = b.detail ?? Object.values(b.errors ?? {})[0] ?? b.title ?? `${failed}.`;
			return false;
		}
		return true;
	}

	async function uncover(serviceId: string) {
		const ok = await send(`${endpoint}/coverage/${serviceId}`, { method: 'DELETE' }, 'Not removed');
		if (ok) await refreshAll();
	}

	async function setEnd(value: string) {
		asking = 'working';
		const ok = await send(
			endpoint,
			{
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fields: { ends_on: value } })
			},
			'Not saved'
		);
		asking = 'idle';
		if (ok) await refreshAll();
	}

	async function remove() {
		asking = 'working';
		const ok = await send(endpoint, { method: 'DELETE' }, 'Not deleted');
		if (ok) await goto(resolve('/catalogue/agreements'));
		else asking = 'idle';
	}

	const menu = $derived(
		data.periods.length === 0
			? [{ label: 'Delete', danger: true, onselect: (): void => void (asking = 'delete') }]
			: a.ends_on
				? [{ label: 'Carry on', onselect: (): void => void (asking = 'carry') }]
				: [
						{
							label: 'End',
							onselect: (): void => {
								endOn = data.today;
								asking = 'end';
							}
						}
					]
	);
	const INTERVALS = [
		{ value: 'weekly', label: 'Week' },
		{ value: 'monthly', label: 'Month' },
		{ value: 'quarterly', label: 'Quarter' },
		{ value: 'annually', label: 'Year' }
	];
	const PRORATIONS = [
		{ value: 'daily', label: 'Charge the days it ran' },
		{ value: 'none', label: 'Charge the whole period' }
	];

	const pays = (r: { pays_for: string; method: string; amount: string | null }) => {
		const w = paysWhat(r, { money, unitPrice });
		return w.x ? `${w.v} ${w.x}` : w.v;
	};
	const FOR: Record<string, string> = {
		time: 'for their time',
		covered_time: 'for covered time',
		vehicle: 'for their vehicle'
	};
</script>

<Top title={a.client} {sub} back={resolve('/catalogue/agreements')} backLabel="Agreements">
	{#snippet actions()}
		<ActionMenu label="Actions for this agreement" items={menu} />
	{/snippet}
</Top>

<div class="pad primer">
	{#if problem}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}

	<section class="box" aria-labelledby="glance-h">
		<div class="box-h"><h2 class="box-t" id="glance-h">At a glance</h2></div>
		<div class="box-row fig">
			<span>Charged</span>
			<span><span class="v">{money(a.price)}</span> a {period}, in advance</span>
		</div>
		<div class="box-row fig">
			<span>For</span>
			<span>{where}: {a.site ? 'work at this site' : 'work at any of its sites'}</span>
		</div>
		<div class="box-row fig">
			<span>This {period}</span>
			{#if data.now?.given}
				<span><span class="v good">Given freely</span>, worth {money(a.price)}</span>
			{:else if data.now}
				<span><span class="v">{money(data.now.amount)}</span>, charged in advance</span>
			{:else}
				<span class="muted">Not charged yet: the invoice builder will charge it</span>
			{/if}
		</div>
	</section>

	<section class="box" aria-labelledby="covers-h">
		<div class="box-h">
			<h2 class="box-t" id="covers-h">What it covers</h2>
			{#if !editing && data.services.length}
				<button type="button" class="btn sm" onclick={() => (editing = { preset: null })}
					>Cover a service</button
				>
			{/if}
		</div>
		{#each data.covers as c (c.service_id)}
			<div class="box-row line">
				<span class="what">
					<span class="n">{c.service}</span>
					<span class="sub">{allotment(c)} · {hours(c.used, 'allotted')} used this month</span>
					<span class="acts">
						<button type="button" class="btn sm" onclick={() => (editing = { preset: c })}
							>Change</button
						>
						<button type="button" class="btn sm" onclick={() => (uncovering = c)}
							>Stop covering</button
						>
					</span>
				</span>
				<span class="end-fig">
					<span class="v">{c.allotment === 'unlimited' ? 'Unlimited' : c.pooled}</span>
					{#if c.allotment !== 'unlimited'}<span class="sub">hours</span>{/if}
				</span>
			</div>
		{:else}
			{#if !editing}
				<p class="box-row muted">
					Covers nothing yet: every hour for this client is billed until a service is covered.
				</p>
			{/if}
		{/each}
		{#if editing}
			{#key editing.preset?.service_id ?? 'new'}
				<CoverageForm
					agreementId={a.id}
					services={data.services}
					preset={editing.preset}
					onsaved={refresh}
					oncancel={() => (editing = null)}
				/>
			{/key}
		{/if}
	</section>

	<section class="box" aria-labelledby="rules-h">
		<div class="box-h"><h2 class="box-t" id="rules-h">Paid differently for {a.client}</h2></div>
		{#each data.rules as r (r.id)}
			<a class="box-row line" href={resolve('/catalogue/services/[id]', { id: r.service_id })}>
				<span class="what">
					<span class="n">{r.payee} · {FOR[r.pays_for]}</span>
					<span class="sub">{r.service} · {pays(r)}</span>
				</span>
			</a>
		{:else}
			<p class="box-row muted">Every service pays here as it does for any client.</p>
		{/each}
	</section>

	<section class="box" aria-labelledby="charged-h">
		<div class="box-h">
			<h2 class="box-t" id="charged-h">What it has charged</h2>
			<span class="count">{data.periods.length}</span>
		</div>
		{#each data.periods as p (p.id)}
			<div class="box-row line">
				<span class="what">
					<span class="n">{span(p.period_start, p.period_end)}</span>
				</span>
				{#if p.given}<span class="lab good">Given freely</span>{/if}
				<span class="end-fig"><span class="v" class:muted={p.given}>{money(p.amount)}</span></span>
			</div>
		{:else}
			<p class="box-row muted">
				Nothing charged yet. Charging a {period} from here is not built yet.
			</p>
		{/each}
	</section>

	<section class="box" aria-labelledby="terms-h">
		<div class="box-h"><h2 class="box-t" id="terms-h">What it charges</h2></div>
		<Detail
			name="price"
			label="Price"
			value={forInput(a.price)}
			shown={money(a.price)}
			inputmode="decimal"
			required
			{endpoint}
			validate={parseAgreementField}
			onsaved={refreshAll}
		/>
		<Detail
			name="billing_interval"
			label="Every"
			value={a.billing_interval}
			options={INTERVALS}
			{endpoint}
			validate={parseAgreementField}
			onsaved={refreshAll}
		/>
		<Detail
			name="billing_anchor_day"
			label="Charged on day"
			value={String(a.billing_anchor_day)}
			inputmode="numeric"
			hint="Of each period. A 31st charges on the last day of a shorter month."
			{endpoint}
			validate={parseAgreementField}
			onsaved={refreshAll}
		/>
		<Detail
			name="starts_on"
			label="Starts"
			type="date"
			value={a.starts_on}
			shown={dated(a.starts_on)}
			{endpoint}
			validate={parseAgreementField}
			onsaved={refreshAll}
		/>
		<Detail
			name="final_period_proration"
			label="If it ends part way through a period"
			value={a.final_period_proration}
			options={PRORATIONS}
			{endpoint}
			validate={parseAgreementField}
			onsaved={refreshAll}
		/>
		<Detail
			name="contact_id"
			label="Agreed with"
			value={a.contact_id ?? ''}
			options={[
				{ value: '', label: 'Nobody in particular' },
				...data.contacts.map((c) => ({ value: c.id, label: c.name }))
			]}
			{endpoint}
			validate={parseAgreementField}
			onsaved={refreshAll}
		/>
	</section>
</div>

<Dialog
	open={asking === 'delete' || (asking === 'working' && data.periods.length === 0)}
	title="Delete this agreement?"
	go="Delete"
	going="Deleting…"
	working={asking === 'working'}
	tone="danger"
	ongo={remove}
	onclose={() => (asking = 'idle')}
>
	<p>
		The agreement for {a.site ? `${a.client} at ${a.site}` : a.client}, and what it covers. Nothing
		has been charged under it. This can’t be undone.
	</p>
</Dialog>

<Dialog
	open={asking === 'end' || (asking === 'working' && !a.ends_on && data.periods.length > 0)}
	title="End this agreement?"
	go="End it then"
	going="Ending…"
	working={asking === 'working'}
	ongo={() => {
		if (endOn) void setEnd(endOn);
	}}
	onclose={() => (asking = 'idle')}
>
	<div class="fc">
		<label class="fc-l" for="a-end">Its last day</label>
		<input id="a-end" class="ti" type="date" min={a.starts_on} bind:value={endOn} />
		<p class="fc-c">Work after this day is billed by the hour.</p>
	</div>
</Dialog>

<Dialog
	open={asking === 'carry' || (asking === 'working' && !!a.ends_on)}
	title="Carry it on past {dated(a.ends_on)}?"
	go="Carry it on"
	going="Carrying it on…"
	working={asking === 'working'}
	ongo={() => setEnd('')}
	onclose={() => (asking = 'idle')}
>
	<p>
		Work after that day is covered by it again rather than billed by the hour. Ending it again means
		choosing the day again.
	</p>
</Dialog>

<Dialog
	open={uncovering !== null}
	title="Stop covering {uncovering?.service ?? ''}?"
	go="Stop covering"
	going="Stopping…"
	working={stopping}
	tone="danger"
	ongo={async () => {
		if (!uncovering) return;
		stopping = true;
		await uncover(uncovering.service_id);
		stopping = false;
		uncovering = null;
	}}
	onclose={() => (uncovering = null)}
>
	{#if uncovering}
		<p>
			Its work under this agreement that is not yet billed, {hours(uncovering.used, 'allotted')} this
			month and any from before, is billed by the hour instead, and no longer pays as covered time.
		</p>
		<p>
			Its terms, {allotment(uncovering).toLowerCase()}, aren’t kept: covering it again means
			entering them again.
		</p>
	{/if}
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
	.fig > span:last-child {
		text-align: right;
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
	}
	.v.good {
		color: var(--good);
	}
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
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
		text-align: right;
	}
</style>
