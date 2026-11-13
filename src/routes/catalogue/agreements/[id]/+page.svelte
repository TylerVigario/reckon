<script lang="ts">
	import Dialog from '#lib/Dialog.svelte';
	import CoverageForm from '#lib/agreement/CoverageForm.svelte';
	import { hours } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';

	/**
	 * An agreement's Covers tab: each service it covers, its allotment and how
	 * much of it this month has used. A service is covered, or its terms
	 * changed, in a dialog (#lib/agreement/CoverageForm); no longer covering one
	 * asks first, since its unbilled work goes back to being billed by the hour.
	 */
	let { data }: PageProps = $props();
	const a = $derived(data.agreement);
	const PERIOD: Record<string, string> = {
		weekly: 'week',
		monthly: 'month',
		quarterly: 'quarter',
		annually: 'year'
	};
	const period = $derived(PERIOD[a.billing_interval] ?? 'period');

	type Cover = (typeof data.covers)[number];
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

	let editing = $state<{ preset: Cover | null } | null>(null);
	let form = $state<CoverageForm>();
	let saving = $state(false);
	let problem = $state('');
	let uncovering = $state<Cover | null>(null);
	let stopping = $state(false);

	async function saved() {
		editing = null;
		await refreshAll();
	}
	async function uncover(c: Cover) {
		problem = '';
		stopping = true;
		const r = await fetch(`/api/agreements/${a.id}/coverage/${c.service_id}`, {
			method: 'DELETE'
		}).catch(() => null);
		stopping = false;
		uncovering = null;
		if (!r?.ok)
			problem = r
				? ((await readProblem(r)).detail ?? 'Not removed.')
				: 'Not removed — no connection.';
		else await refreshAll();
	}
</script>

{#if problem}<p class="fc-e">{problem}</p>{/if}

<section class="box" aria-labelledby="covers-h">
	<div class="box-h">
		<h2 class="box-t" id="covers-h">What it covers</h2>
		{#if data.services.length}
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
			</span>
			<span class="fig">
				<span class="v">{c.allotment === 'unlimited' ? 'Unlimited' : c.pooled}</span>
				{#if c.allotment !== 'unlimited'}<span class="sub">hours</span>{/if}
			</span>
			<span class="acts">
				<button type="button" class="btn sm" onclick={() => (editing = { preset: c })}
					>Change</button
				>
				<button type="button" class="btn sm" onclick={() => (uncovering = c)}>Stop covering</button>
			</span>
		</div>
	{:else}
		<p class="box-row muted">
			Covers nothing yet: every hour for this client is billed until a service is covered.
		</p>
	{/each}
</section>

<Dialog
	open={editing !== null}
	title={editing?.preset ? `Change what ${editing.preset.service} covers` : 'Cover a service'}
	go={editing?.preset ? 'Save' : 'Cover it'}
	going="Saving…"
	working={saving}
	ongo={() => void form?.save()}
	onclose={() => (editing = null)}
>
	{#if editing}
		{#key editing.preset?.service_id ?? 'new'}
			<CoverageForm
				bind:this={form}
				onsaving={(busy) => (saving = busy)}
				agreementId={a.id}
				services={data.services}
				preset={editing.preset}
				onsaved={saved}
			/>
		{/key}
	{/if}
</Dialog>

<Dialog
	open={uncovering !== null}
	title="Stop covering {uncovering?.service ?? ''}?"
	go="Stop covering"
	going="Stopping…"
	working={stopping}
	tone="danger"
	ongo={() => uncovering && uncover(uncovering)}
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
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		min-height: 64px;
		box-sizing: border-box;
	}
	.what {
		flex: 1 1 12rem;
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
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
	}
	.acts {
		flex: 1 0 100%;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.fc-e {
		margin: 0;
	}
</style>
