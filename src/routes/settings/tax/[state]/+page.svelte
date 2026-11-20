<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import Outside from '#lib/Outside.svelte';
	import { dated, pct } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { parseAnswerField } from '#lib/kind-fields.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import { AGENCY } from '#lib/state-agencies.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * A STATE THE BUSINESS COLLECTS IN: whether it taxes each kind of sale,
	 * each answer changed in place (#lib/Detail) and saying who gave it and
	 * when. Where no authority answers for an address, its areas too, as the
	 * business has typed them in from the state's own table: each with its rate
	 * today, opening its own page. One nobody has confirmed since this quarter
	 * began is confirmed beside the state's table, one action, where rates and
	 * boundaries change on a quarter's first day.
	 */
	let { data }: PageProps = $props();
	const name = $derived(stateName(data.state));
	const agency = $derived(AGENCY[data.state]);
	const TAXED = [
		{ value: 'true', label: 'Taxed' },
		{ value: 'false', label: 'Not taxed' }
	];
	/** Who gave an answer, and when: nobody, for one carried over from before kinds of sale. */
	const said = (a: { said_by: string | null; said_on: string | null }) =>
		a.said_by && a.said_on
			? `Said by ${a.said_by}, ${dated(a.said_on)}`
			: 'As reckon taxed it before kinds of sale. Nobody has said yet.';

	let confirming = $state<string | null>(null);
	let why = $state('');
	async function confirm(id: string) {
		confirming = id;
		why = '';
		const r = await fetch(`/api/settings/tax/${data.state}/areas/${id}/confirm`, {
			method: 'POST'
		}).catch(() => null);
		confirming = null;
		if (!r?.ok) {
			why = r
				? ((await readProblem(r)).detail ?? 'Not confirmed.')
				: 'Not confirmed — no connection.';
			return;
		}
		await refreshAll();
	}
	const about = (a: { code: string | null; rate_pct: string; sites: number }) =>
		[
			pct(a.rate_pct),
			a.code ? `code ${a.code}` : null,
			a.sites ? `${a.sites} ${a.sites === 1 ? 'site' : 'sites'}` : null
		]
			.filter(Boolean)
			.join(' · ');
</script>

<Top
	title={name}
	sub={data.typed ? 'What it taxes, and its tax areas' : 'What it taxes'}
	back={resolve('/settings/tax')}
	backLabel="Tax"
/>

<div class="pad">
	<section class="box" aria-labelledby="taxes-h">
		<div class="box-h"><h2 class="box-t" id="taxes-h">What it taxes</h2></div>
		{#each data.answers as a (a.kind)}
			<Detail
				name="taxed"
				label={a.active ? a.name : `${a.name}, retired`}
				value={String(a.taxed)}
				options={TAXED}
				endpoint={`/api/settings/tax/${data.state}/kinds/${a.kind}`}
				hint={said(a)}
				validate={parseAnswerField}
				onsaved={() => refreshAll()}
			/>
		{/each}
	</section>

	{#if data.typed}
		{#if agency}
			<section class="box" aria-labelledby="source-h">
				<div class="box-h"><h2 class="box-t" id="source-h">Where to look</h2></div>
				<Outside class="box-row" href={agency.rates}>
					<span class="what">
						<span class="n">Rates by jurisdiction</span>
						<span class="sub">{agency.name}</span>
					</span>
				</Outside>
				{#if agency.lookup}
					<Outside class="box-row" href={agency.lookup}>
						<span class="what">
							<span class="n">Which apply at an address</span>
							<span class="sub">{agency.name}</span>
						</span>
					</Outside>
				{/if}
			</section>
		{/if}

		<section class="box" aria-labelledby="areas-h">
			<div class="box-h">
				<h2 class="box-t" id="areas-h">Areas</h2>
				<a class="btn sm" href={resolve('/settings/tax/[state]/new', { state: data.state })}
					>New area</a
				>
			</div>
			{#if why}<p class="box-row im crit" role="alert"><Octicon name="alert" />{why}</p>{/if}
			{#each data.areas as a (a.id)}
				<div class="box-row area">
					<a
						class="what"
						href={resolve('/settings/tax/[state]/[area]', { state: data.state, area: a.id })}
					>
						<span class="n">{a.name}</span>
						<span class="sub">{about(a)}</span>
					</a>
					{#if a.stale}
						<span class="end">
							<span class="lab warn">Not confirmed this quarter</span>
							<button
								type="button"
								class="btn sm"
								onclick={() => confirm(a.id)}
								{@attach busy(confirming === a.id && 'Confirming')}>Confirm</button
							>
						</span>
					{:else}
						<span class="lab">Confirmed {dated(a.confirmed_on)}</span>
					{/if}
				</div>
			{:else}
				<p class="box-row muted">
					None yet. Each place with its own combination of state and local taxes is an area, and a
					site in {name} is taxed at the rate of the one it is in.
				</p>
			{/each}
		</section>

		<p class="note">
			Rates and boundaries change on the first day of a quarter. An area nobody has confirmed since
			this one began is flagged here and on Today: check it against {agency?.short ?? 'the state'}’s
			table, then confirm it or type its new rate.
		</p>
	{/if}
</div>

<style>
	.box-row {
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.area {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
	.what {
		flex: 1 1 12rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: inherit;
		text-decoration: none;
	}
	.n {
		font-weight: 600;
	}
	a.what:hover .n {
		color: var(--fgColor-accent);
		text-decoration: underline;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.end {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.lab {
		flex: 0 0 auto;
	}
	/* Primer's inline message: an icon and a line, in the colour of what happened. */
	.im {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		min-height: 0;
		font-size: 14px;
		line-height: 20px;
	}
	.im :global(svg) {
		margin-top: 2px;
	}
	.im.crit {
		color: var(--fgColor-danger);
	}
</style>
