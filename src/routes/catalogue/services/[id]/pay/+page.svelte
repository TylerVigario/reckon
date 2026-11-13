<script lang="ts">
	import Dialog from '#lib/Dialog.svelte';
	import RuleForm from '#lib/service/RuleForm.svelte';
	import { dated } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { PAYS_FOR, paysWhat } from '#lib/pay-words.ts';
	import { readProblem } from '#lib/json.ts';
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';

	/**
	 * A service's Pay tab: whom it pays and how, in force or scheduled, and what
	 * the business keeps of an hour of it, worked by each person and by a team.
	 * A rule is added or changed in a dialog (#lib/service/RuleForm); one in
	 * force since today asks before it is taken back.
	 */
	let { data }: PageProps = $props();
	const s = $derived(data.service);

	type Rule = (typeof data.rules)[number];
	let editing = $state<{ preset: Rule | null } | null>(null);
	let form = $state<RuleForm>();
	let saving = $state(false);
	let problem = $state('');

	const when = (r: { state: string; effective_from: string }) =>
		r.state === 'scheduled'
			? `Takes over ${dated(r.effective_from)}`
			: `Since ${dated(r.effective_from)}`;
	const takeable = (r: { state: string; effective_from: string }) =>
		r.state === 'scheduled' || r.effective_from === data.today;

	let taking = $state<Rule | null>(null);
	let takingBack = $state(false);
	async function takeBack(r: Rule) {
		problem = '';
		takingBack = true;
		const res = await fetch(`/api/services/${s.id}/rules/${r.id}`, { method: 'DELETE' }).catch(
			() => null
		);
		takingBack = false;
		taking = null;
		if (!res?.ok)
			problem = res
				? ((await readProblem(res)).detail ?? 'That was not taken back.')
				: 'Not taken back — no connection.';
		else await refreshAll();
	}
	async function saved() {
		editing = null;
		await refreshAll();
	}
</script>

{#if problem}<p class="fc-e">{problem}</p>{/if}

<section class="box" aria-labelledby="rules-h">
	<div class="box-h">
		<h2 class="box-t" id="rules-h">Who is paid, and how</h2>
		<button type="button" class="btn sm" onclick={() => (editing = { preset: null })}
			>Add a rule</button
		>
	</div>
	{#each data.rules as r (r.id)}
		{@const w = paysWhat(r, { money, unitPrice })}
		<div class="box-row line">
			<span class="what">
				<span class="n">{r.payee} · {PAYS_FOR[r.pays_for]}</span>
				<span class="sub">{r.client ?? 'Every client'} · {when(r)} · {w.v} {w.x}</span>
			</span>
			{#if r.state === 'scheduled'}<span class="lab acc">Scheduled</span>{/if}
			<span class="acts">
				{#if r.state === 'current'}
					<button type="button" class="btn sm" onclick={() => (editing = { preset: r })}
						>Change</button
					>
				{/if}
				{#if takeable(r)}
					<button
						type="button"
						class="btn sm"
						onclick={() => (r.state === 'scheduled' ? takeBack(r) : (taking = r))}>Take back</button
					>
				{/if}
			</span>
		</div>
	{:else}
		<p class="box-row muted">Nobody is paid for it: everything it charges is kept.</p>
	{/each}
</section>

{#if data.hour.length}
	<section class="box" aria-labelledby="kept-h">
		<div class="box-h"><h2 class="box-t" id="kept-h">What the business keeps of an hour</h2></div>
		<div class="tbl">
			<table>
				<thead>
					<tr><th>Worked by</th><th>Billed</th><th>Paid out</th><th>Kept</th></tr>
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

<Dialog
	open={editing !== null}
	title={editing?.preset ? `Change ${editing.preset.payee}’s rule` : 'Add a pay rule'}
	go="Save rule"
	going="Saving…"
	working={saving}
	ongo={() => void form?.save()}
	onclose={() => (editing = null)}
>
	{#if editing}
		{#key editing.preset?.id ?? 'new'}
			<RuleForm
				bind:this={form}
				onsaving={(busy) => (saving = busy)}
				serviceId={s.id}
				roles={data.roles}
				people={data.people}
				clients={data.clients}
				today={data.today}
				preset={editing.preset}
				onsaved={saved}
			/>
		{/key}
	{/if}
</Dialog>

<Dialog
	open={taking !== null}
	title="Take back this pay rule?"
	go="Take back"
	going="Taking back…"
	working={takingBack}
	tone="danger"
	ongo={() => taking && takeBack(taking)}
	onclose={() => (taking = null)}
>
	<p>
		It has been in force since today. Today’s work not yet paid goes back to the rule before it, if
		there was one. It isn’t kept anywhere: to have it again, it is entered again.
	</p>
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
	.lab {
		flex: 0 0 auto;
	}
	.acts {
		flex: 1 0 100%;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.acts:empty {
		display: none;
	}
	.fc-e {
		margin: 0;
	}
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
