<script lang="ts">
	import Top from '$lib/Top.svelte';
	import Setting from '$lib/Setting.svelte';
	import PriceForm from '$lib/service/PriceForm.svelte';
	import RuleForm from '$lib/service/RuleForm.svelte';
	import SubscriptionForm from '$lib/service/SubscriptionForm.svelte';
	import { dated, increment } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import { PAYS_FOR, paysWhat } from '$lib/pay-words';
	import { parseServiceField } from '$lib/service-fields';
	import { readProblem } from '$lib/json';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

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
			`Charged per ${s.unit}`,
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
		await invalidateAll();
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
		await invalidateAll();
	}

	// What happens to the service as a whole lives in the header: delete one
	// nothing has used, retire one that has, offer a retired one again.
	// Deleting asks twice: the first tap says what will happen and offers a way
	// out at the top of the page, and only the second sends anything.
	let deleting = $state<'idle' | 'asking' | 'working'>('idle');
	let offering = $state(false);
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
		await invalidateAll();
	}

	async function remove() {
		deleting = 'working';
		problem = '';
		const r = await fetch(endpoint, { method: 'DELETE' }).catch(() => null);
		if (r?.ok) {
			await goto(resolve('/services'));
			return;
		}
		deleting = 'idle';
		problem = r
			? ((await readProblem(r)).detail ?? 'It was not deleted.')
			: 'Not deleted — no connection.';
	}

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

<Top title={s.name} sub={terms} back={resolve('/services')} backLabel="Services">
	{#snippet actions()}
		{#if unused}
			<button
				type="button"
				class="btn sm danger"
				onclick={() => (deleting = 'asking')}
				disabled={deleting !== 'idle'}>Delete</button
			>
		{:else if s.active}
			<button type="button" class="btn sm" onclick={() => setOffered(false)} disabled={offering}
				>Retire</button
			>
		{:else}
			<button type="button" class="btn sm pri" onclick={() => setOffered(true)} disabled={offering}
				>Offer again</button
			>
		{/if}
	{/snippet}
</Top>

<div class="pad">
	{#if deleting !== 'idle'}
		<div class="confirm">
			<p>Delete {s.name}, with its prices and pay rules? This cannot be undone.</p>
			<div class="btnrow">
				<button type="button" class="btn" onclick={() => (deleting = 'idle')}>Keep it</button>
				<button
					type="button"
					class="btn danger solid"
					onclick={remove}
					disabled={deleting === 'working'}
					>{deleting === 'working' ? 'Deleting…' : 'Delete it for good'}</button
				>
			</div>
		</div>
	{/if}
	{#if !s.active}
		<p class="retired">
			Retired: not offered for new work. It stays under its name on everything it billed{usedBy
				? ` — ${usedBy}`
				: ''}.
		</p>
	{/if}

	<div class="tiles">
		<div class="tile">
			<span class="k">{s.unit === 'hour' ? 'One person' : 'Charged'}</span>
			<span class="v">{price ? money(price.rate) : '—'}</span>
			<span class="s">{price ? per : 'not priced for every client'}</span>
		</div>
		{#if team}
			<div class="tile">
				<span class="k">The team</span>
				<span class="v">{money(team.billed)}</span>
				<span class="s">an hour, together</span>
			</div>
		{/if}
		{#if one.length === 1 && !one[0].unpaid}
			<div class="tile wide">
				<span class="k">Kept</span>
				<span class="v good">{money(one[0].kept)}</span>
				<span class="s"
					>an hour{team && team.kept === one[0].kept ? ', one person or the team' : ''}</span
				>
			</div>
		{/if}
	</div>

	{#if problem}<p class="problem">{problem}</p>{/if}

	<div class="duo">
		<div class="stack wide">
			<div class="sec">
				<div class="sec-h"><h2>What the client pays</h2></div>
				<div class="rows">
					{#each data.prices as p (p.id)}
						<div class="rec" class:acc={p.state === 'scheduled'}>
							<div class="rec-m">
								<div class="rec-t">{p.client ?? 'Every client'}</div>
								<div class="rec-s">
									{when(p)}{s.unit === 'hour'
										? Number(p.additional_rate) > 0
											? ` · +${money(p.additional_rate)} for each additional person`
											: ' · the same however many work it'
										: ''}
								</div>
								<div class="rec-c">
									{#if p.state === 'current'}
										<button
											type="button"
											class="btn sm gho"
											onclick={() => (editing = { kind: 'price', preset: p })}>Change</button
										>
									{/if}
									{#if takeable(p)}
										<button
											type="button"
											class="btn sm gho"
											onclick={() => takeBack('prices', p.id)}>Take back</button
										>
									{/if}
								</div>
							</div>
							<div class="rec-n">
								<span class="rec-v">{money(p.rate)}</span>
								<span class="rec-x">{perShort}</span>
							</div>
						</div>
					{/each}

					{#each data.covered as c (c.agreement_id)}
						<a class="rec acc link" href={resolve('/catalogue/agreements')}>
							<div class="rec-m">
								<div class="rec-t">{c.who}</div>
								<div class="rec-s">Covered by their agreement — not billed by the hour</div>
							</div>
							<div class="rec-n">
								<span class="rec-v mut">{c.allotment === 'unlimited' ? '∞' : c.hours}</span>
								<span class="rec-x">{c.allotment === 'unlimited' ? 'unlimited' : 'hours'}</span>
							</div>
							<span class="arw" aria-hidden="true">›</span>
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
					{:else}
						<button
							type="button"
							class="addrow"
							onclick={() => (editing = { kind: 'price', preset: null })}
						>
							{data.prices.length ? 'A new price, or one for a client' : 'Price it'}
						</button>
					{/if}
				</div>
			</div>

			<div class="sec">
				<div class="sec-h"><h2>Who is paid, and how</h2></div>
				<div class="rows">
					{#each data.rules as r (r.id)}
						{@const w = paysWhat(r, money)}
						<div class="rec" class:acc={r.state === 'scheduled'}>
							<div class="rec-m">
								<div class="rec-t">
									{r.payee}&nbsp;<span class="lt">· {PAYS_FOR[r.pays_for]}</span>
								</div>
								<div class="rec-s">
									{r.client ?? 'Every client'} · {when(r)} · {w.v}
									{w.x}{r.pays_for === 'vehicle'
										? ' · not applied yet: a trip does not record its vehicle'
										: ''}
								</div>
								<div class="rec-c">
									{#if r.state === 'current'}
										<button
											type="button"
											class="btn sm gho"
											onclick={() => (editing = { kind: 'rule', preset: r })}>Change</button
										>
									{/if}
									{#if takeable(r)}
										<button type="button" class="btn sm gho" onclick={() => takeBack('rules', r.id)}
											>Take back</button
										>
									{/if}
								</div>
							</div>
						</div>
					{:else}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-t"><span class="lt">Nobody is paid for it</span></div>
								<div class="rec-s">Everything it charges is kept</div>
							</div>
						</div>
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
					{:else}
						<button
							type="button"
							class="addrow"
							onclick={() => (editing = { kind: 'rule', preset: null })}>Add a rule</button
						>
					{/if}
				</div>
			</div>

			{#if data.hour.length}
				<div class="sec">
					<div class="sec-h"><h2>What the business keeps</h2></div>
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
										<td class:mut={h.unpaid}>{h.unpaid ? 'no rule' : money(h.paid)}</td>
										<td class="kept">{money(h.kept)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}

			{#if data.earlier}
				<div class="rows">
					<a class="rec link" href={resolve('/services/[id]/history', { id: s.id })}>
						<div class="rec-m">
							<div class="rec-t"><span class="lt">Earlier prices and pay rules</span></div>
							<div class="rec-s">{data.earlier} no longer in force</div>
						</div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				</div>
			{/if}
		</div>

		<div class="sec">
			<div class="sec-h"><h2>What it is</h2></div>
			<div class="rows inset">
				<Setting
					name="name"
					label="Name"
					value={s.name}
					{endpoint}
					validate={parseServiceField}
					onsaved={() => invalidateAll()}
				/>
				<Setting
					name="unit"
					label="Charged per"
					value={s.unit}
					options={[
						{ value: 'hour', label: 'Hour' },
						{ value: 'mile', label: 'Mile' },
						{ value: 'each', label: 'Each — a flat rate' }
					]}
					{endpoint}
					validate={parseServiceField}
					onsaved={() => invalidateAll()}
				/>
				{#if s.unit === 'hour'}
					<Setting
						name="bill_to_nearest_seconds"
						label="Billed to"
						value={s.bill_to_nearest_seconds === null ? '' : String(s.bill_to_nearest_seconds)}
						options={steps}
						hint="Pay is never rounded: it is counted as worked."
						{endpoint}
						validate={parseServiceField}
						onsaved={() => invalidateAll()}
					/>
				{/if}
				<Setting
					name="minimum_charge"
					label="Minimum charge"
					value={s.minimum_charge ?? ''}
					placeholder="None"
					inputmode="decimal"
					hint="The least one entry bills, however short."
					{endpoint}
					validate={parseServiceField}
					onsaved={() => invalidateAll()}
				/>
				<Setting
					name="time_tracked"
					label="On the timer"
					value={String(s.time_tracked)}
					options={YES_NO}
					{endpoint}
					validate={parseServiceField}
				/>
				<Setting
					name="taxable"
					label="Taxable"
					value={String(s.taxable)}
					options={YES_NO}
					{endpoint}
					validate={parseServiceField}
				/>
				<SubscriptionForm
					serviceId={s.id}
					terms={{ basis: s.basis, hours: s.hours, period: s.period, overage: s.overage }}
					onsaved={() => invalidateAll()}
				/>
			</div>
		</div>
	</div>
</div>

<style>
	.stack.wide {
		gap: 22px;
	}
	.problem {
		color: var(--crit);
		margin: 0 0 12px;
	}
	.btn.danger {
		color: var(--crit);
		border-color: var(--crit);
	}
	.btn.danger.solid {
		background: var(--crit);
		color: var(--surface);
	}
	/* The second tap of a delete, where the first one was made. */
	.confirm {
		background: var(--surface);
		border: 1px solid var(--crit);
		border-radius: var(--r);
		padding: 14px;
		margin-bottom: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.confirm p,
	.retired {
		margin: 0;
		font-size: 14px;
	}
	.retired {
		color: var(--ink-3);
		margin-bottom: 16px;
	}
	/* The way in to a form, at the foot of the list it adds to. */
	.addrow {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 12px 14px;
		min-height: 48px;
		background: none;
		border: 0;
		border-top: 1px solid var(--line-soft);
		color: var(--accent);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
	}
	.addrow::before {
		content: '+';
		font-family: var(--f-mono);
		font-size: 17px;
		font-weight: 400;
	}
	.addrow:first-child {
		border-top: 0;
	}
	/* Figures line up by column; the kept column is the answer. */
	.tbl {
		overflow-x: auto;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r);
	}
	.tbl table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13.5px;
	}
	.tbl th {
		font-family: var(--f-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
		font-weight: 400;
		text-align: right;
		padding: 10px 10px;
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}
	.tbl td {
		padding: 10px 10px;
		border-bottom: 1px solid var(--line-soft);
		text-align: right;
		font-family: var(--f-mono);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tbl th:first-child,
	.tbl td:first-child {
		text-align: left;
		font-family: var(--f-text);
		white-space: normal;
	}
	.tbl tr:last-child td {
		border-bottom: 0;
	}
	.tbl td.kept {
		font-weight: 700;
		color: var(--good);
	}
	.tbl td.mut {
		color: var(--ink-3);
	}
</style>
