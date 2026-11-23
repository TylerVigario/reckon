<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import Outside from '#lib/Outside.svelte';
	import PiecesField, { asTyped, type PieceDraft } from '#lib/PiecesField.svelte';
	import { AREA_FIELDS, parseFrom, parsePieces } from '#lib/area-fields.ts';
	import { parseAll } from '#lib/field-rules.ts';
	import { readJson, readProblem } from '#lib/json.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import { AGENCY } from '#lib/state-agencies.ts';
	import { NO_STATE_TAX, stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * AN AREA, TYPED IN from the state's own table: what the state calls it, its
	 * code for it where the table gives one, and its rate in force today, piece
	 * by piece, from the day it took effect. Made, it opens, or goes back to the
	 * site whose Tax tab asked for it, to be chosen there.
	 */
	let { data }: PageProps = $props();
	const name = $derived(stateName(data.state));
	const agency = $derived(AGENCY[data.state]);
	const back = $derived(resolve('/settings/tax/[state]', { state: data.state }));
	// Asked for from a site's Tax tab (?for=client/site), it goes back there,
	// where the area is chosen.
	const site = $derived.by(() => {
		const [id, s] = (page.url.searchParams.get('for') ?? '').split('/');
		return id && s ? resolve('/clients/[id]/sites/[site]/tax', { id, site: s }) : null;
	});

	let area = $state('');
	let code = $state('');
	let from = $state(untrack(() => data.from));
	let pieces = $state<PieceDraft[]>(
		untrack(() =>
			NO_STATE_TAX.includes(data.state)
				? [{ level: 'local', jurisdiction: '', rate_pct: '', sale_kind_id: '' }]
				: [
						{
							level: 'state',
							jurisdiction: data.stateShare?.jurisdiction ?? stateName(data.state),
							rate_pct: data.stateShare ? asTyped(data.stateShare.rate_pct) : '',
							sale_kind_id: ''
						},
						{ level: 'local', jurisdiction: '', rate_pct: '', sale_kind_id: '' }
					]
		)
	);
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);

	async function add() {
		const fields = { name: area, code, from };
		const local = parseAll(AREA_FIELDS, fields).errors;
		const f = parseFrom(from);
		if (!f.ok) local.from = f.why;
		Object.assign(local, parsePieces(pieces, data.state).errors);
		errors = local;
		saying = '';
		if (Object.keys(local).length) return;
		saving = true;
		const r = await fetch(`/api/settings/tax/${data.state}/areas`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields, pieces })
		}).catch(() => null);
		saving = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			errors = p?.errors ?? {};
			saying = !p
				? 'Not saved — no connection.'
				: Object.keys(errors).length
					? ''
					: (p.detail ?? 'That did not save.');
			return;
		}
		const made = (await readJson(r)) as { id: string };
		await goto(
			site ?? resolve('/settings/tax/[state]/[area]', { state: data.state, area: made.id })
		);
	}
	const show = (k: string) => errors[k] ?? '';
</script>

<Top title="New area" sub={name} {back} backLabel={name} />

<div class="pad">
	<form
		class="box"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			void add();
		}}
	>
		<div class="box-row form">
			{#if agency}
				<p class="fc-c">
					Type it as <Outside href={agency.rates}>{agency.name}’s table</Outside> has it.
				</p>
			{/if}
			<div class="fc">
				<label class="fc-l" for="a-name">Name<span aria-hidden="true"> *</span></label>
				<input
					id="a-name"
					class="ti"
					autocomplete="off"
					required
					bind:value={area}
					aria-invalid={show('name') ? 'true' : undefined}
					aria-describedby={show('name') ? 'a-name-e' : 'a-name-c'}
				/>
				{#if show('name')}
					<p class="fc-e" id="a-name-e"><Octicon name="alert" />{show('name')}</p>
				{:else}
					<p class="fc-c" id="a-name-c">
						As the state’s table names it: a city, county or district.
					</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="a-code">The state’s code for it</label>
				<input
					id="a-code"
					class="ti"
					autocomplete="off"
					bind:value={code}
					aria-invalid={show('code') ? 'true' : undefined}
					aria-describedby={show('code') ? 'a-code-e' : 'a-code-c'}
				/>
				{#if show('code')}
					<p class="fc-e" id="a-code-e"><Octicon name="alert" />{show('code')}</p>
				{:else}
					<p class="fc-c" id="a-code-c">
						Where its table gives one: a location or jurisdiction code.
					</p>
				{/if}
			</div>
			<div class="fc">
				<label class="fc-l" for="a-from">Rate in force from<span aria-hidden="true"> *</span></label
				>
				<input
					id="a-from"
					class="ti"
					type="date"
					required
					max={data.today}
					bind:value={from}
					aria-invalid={show('from') ? 'true' : undefined}
					aria-describedby={show('from') ? 'a-from-e' : 'a-from-c'}
				/>
				{#if show('from')}
					<p class="fc-e" id="a-from-e"><Octicon name="alert" />{show('from')}</p>
				{:else}
					<p class="fc-c" id="a-from-c">
						The day today’s rate took effect, or this quarter’s first if the table does not say.
					</p>
				{/if}
			</div>
			<PiecesField bind:pieces state={data.state} kinds={data.kinds} {errors} id="a-p" />
		</div>
		<div class="box-row keep">
			<button type="submit" class="btn pri" {@attach busy(saving && 'Adding the area')}
				>Add area</button
			>
			<a class="btn" href={site ?? back}>Cancel</a>
			{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
		</div>
	</form>
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fc,
	.form > :global(.pieces) {
		max-width: 440px;
	}
	.form > .fc-c {
		margin: 0;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--bgColor-muted);
	}
	.keep .fc-e {
		flex: 1 0 100%;
	}
</style>
