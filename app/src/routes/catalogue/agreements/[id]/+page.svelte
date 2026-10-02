<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
	import CoverageForm from '#lib/agreement/CoverageForm.svelte';
	import { dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { paysWhat } from '#lib/pay-words.ts';
	import { parseAgreementField } from '#lib/agreement-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

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
	let asking = $state<'idle' | 'delete' | 'end' | 'working'>('idle');
	let endOn = $state('');

	async function refresh() {
		editing = null;
		await invalidateAll();
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
		if (ok) await invalidateAll();
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
		if (ok) await invalidateAll();
	}

	async function remove() {
		asking = 'working';
		const ok = await send(endpoint, { method: 'DELETE' }, 'Not deleted');
		if (ok) await goto(resolve('/catalogue/agreements'));
		else asking = 'idle';
	}

	const pays = (r: { pays_for: string; method: string; amount: string | null }) => {
		const w = paysWhat(r, money);
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
		{#if data.periods.length === 0}
			<button
				type="button"
				class="btn sm danger"
				onclick={() => (asking = 'delete')}
				disabled={asking !== 'idle'}>Delete</button
			>
		{:else if a.ends_on}
			<button
				type="button"
				class="btn sm pri"
				onclick={() => setEnd('')}
				disabled={asking !== 'idle'}>Carry on</button
			>
		{:else}
			<button
				type="button"
				class="btn sm"
				onclick={() => {
					endOn = data.today;
					asking = 'end';
				}}
				disabled={asking !== 'idle'}>End</button
			>
		{/if}
	{/snippet}
</Top>

<div class="pad">
	{#if asking === 'delete' || (asking === 'working' && data.periods.length === 0)}
		<div class="confirm">
			<p>
				Delete this agreement for {a.site ? `${a.client} at ${a.site}` : a.client}, and what it
				covers? Nothing has been charged under it. This cannot be undone.
			</p>
			<div class="btnrow">
				<button type="button" class="btn" onclick={() => (asking = 'idle')}>Keep it</button>
				<button
					type="button"
					class="btn danger solid"
					onclick={remove}
					disabled={asking === 'working'}
					>{asking === 'working' ? 'Deleting…' : 'Delete it for good'}</button
				>
			</div>
		</div>
	{:else if asking === 'end'}
		<div class="confirm plain">
			<div class="fld">
				<label for="a-end">Its last day</label>
				<input id="a-end" class="inp" type="date" min={a.starts_on} bind:value={endOn} />
			</div>
			<div class="btnrow">
				<button type="button" class="btn" onclick={() => (asking = 'idle')}>Keep it running</button>
				<button type="button" class="btn pri" onclick={() => setEnd(endOn)} disabled={!endOn}
					>End it then</button
				>
			</div>
		</div>
	{/if}
	{#if problem}<p class="problem">{problem}</p>{/if}

	<div class="tiles">
		<div class="tile">
			<span class="k">Charged</span>
			<span class="v">{money(a.price)}</span>
			<span class="s">a {period}, in advance</span>
		</div>
		<div class="tile">
			<span class="k">For</span>
			<span class="v sm">{where}</span>
			<span class="s">{a.site ? 'work at this site' : 'work at any of its sites'}</span>
		</div>
		<div class="tile wide">
			<span class="k">This {period}</span>
			<span class="v sm" class:good={data.now?.given}>
				{data.now ? (data.now.given ? 'Given freely' : money(data.now.amount)) : 'Not charged yet'}
			</span>
			<span class="s">
				{data.now
					? data.now.given
						? `worth ${money(a.price)}`
						: 'charged in advance'
					: 'the invoice builder will charge it'}
			</span>
		</div>
	</div>

	<div class="duo">
		<div class="stack wide">
			<div class="sec">
				<div class="sec-h"><h2>What it covers</h2></div>
				<div class="rows">
					{#each data.covers as c (c.service_id)}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-t">{c.service}</div>
								<div class="rec-s">
									{allotment(c)} · {Number(c.used).toFixed(2)} h used this month
								</div>
								<div class="rec-c">
									<button type="button" class="btn sm gho" onclick={() => (editing = { preset: c })}
										>Change</button
									>
									<button type="button" class="btn sm gho" onclick={() => uncover(c.service_id)}
										>Stop covering</button
									>
								</div>
							</div>
							<div class="rec-n">
								<span class="rec-v mut">{c.allotment === 'unlimited' ? '∞' : c.pooled}</span>
								<span class="rec-x">{c.allotment === 'unlimited' ? 'unlimited' : 'hours'}</span>
							</div>
						</div>
					{:else}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-t"><span class="lt">Covers nothing yet</span></div>
								<div class="rec-s">
									Every hour for this client is billed until a service is covered
								</div>
							</div>
						</div>
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
					{:else if data.services.length}
						<button type="button" class="addrow" onclick={() => (editing = { preset: null })}
							>Cover a service</button
						>
					{/if}
				</div>
			</div>

			<div class="sec">
				<div class="sec-h"><h2>Paid differently for {a.client}</h2></div>
				<div class="rows">
					{#each data.rules as r (r.id)}
						<a class="rec link" href={resolve('/services/[id]', { id: r.service_id })}>
							<div class="rec-m">
								<div class="rec-t">{r.payee}&nbsp;<span class="lt">· {FOR[r.pays_for]}</span></div>
								<div class="rec-s">{r.service} · {pays(r)}</div>
							</div>
							<span class="arw" aria-hidden="true">›</span>
						</a>
					{:else}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-s">Every service pays here as it does for any client.</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="sec">
				<div class="sec-h"><h2>What it has charged</h2></div>
				<div class="rows">
					{#each data.periods as p (p.id)}
						<div class="rec" class:gone={p.given}>
							<div class="rec-m">
								<div class="rec-t">{dated(p.period_start)} – {dated(p.period_end)}</div>
								{#if p.given}<div class="rec-s">Given freely</div>{/if}
							</div>
							<div class="rec-n">
								<span class="rec-v" class:mut={p.given}>{money(p.amount)}</span>
							</div>
						</div>
					{:else}
						<div class="rec">
							<div class="rec-m">
								<div class="rec-s">
									Nothing charged yet. Charging a {period} from here is not built yet.
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<div class="sec">
			<div class="sec-h"><h2>What it charges</h2></div>
			<div class="rows inset">
				<Setting
					name="price"
					label="Price"
					value={a.price}
					inputmode="decimal"
					{endpoint}
					validate={parseAgreementField}
					onsaved={() => invalidateAll()}
				/>
				<Setting
					name="billing_interval"
					label="Every"
					value={a.billing_interval}
					options={[
						{ value: 'weekly', label: 'Week' },
						{ value: 'monthly', label: 'Month' },
						{ value: 'quarterly', label: 'Quarter' },
						{ value: 'annually', label: 'Year' }
					]}
					{endpoint}
					validate={parseAgreementField}
					onsaved={() => invalidateAll()}
				/>
				<Setting
					name="billing_anchor_day"
					label="Charged on day"
					value={String(a.billing_anchor_day)}
					inputmode="numeric"
					hint="Of each period. A 31st charges on the last day of a shorter month."
					{endpoint}
					validate={parseAgreementField}
				/>
				<Setting
					name="starts_on"
					label="Starts"
					type="date"
					value={a.starts_on}
					{endpoint}
					validate={parseAgreementField}
					onsaved={() => invalidateAll()}
				/>
				<Setting
					name="final_period_proration"
					label="If it ends part way through a period"
					value={a.final_period_proration}
					options={[
						{ value: 'daily', label: 'Charge the days it ran' },
						{ value: 'none', label: 'Charge the whole period' }
					]}
					{endpoint}
					validate={parseAgreementField}
				/>
				<Setting
					name="contact_id"
					label="Agreed with"
					value={a.contact_id ?? ''}
					options={[
						{ value: '', label: 'Nobody in particular' },
						...data.contacts.map((c) => ({ value: c.id, label: c.name }))
					]}
					{endpoint}
					validate={parseAgreementField}
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
	/* The second tap of a delete, or the day it ends, where the first was made. */
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
	.confirm.plain {
		border-color: var(--line);
	}
	.confirm p {
		margin: 0;
		font-size: 14px;
	}
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
</style>
