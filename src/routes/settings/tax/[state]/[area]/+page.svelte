<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Detail from '#lib/Detail.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import Outside from '#lib/Outside.svelte';
	import PiecesField, { asTyped, type PieceDraft } from '#lib/PiecesField.svelte';
	import { parseAreaField, parseFrom, parsePieces } from '#lib/area-fields.ts';
	import { Decimal } from '#lib/decimal.ts';
	import { dated, levied, pct } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { busy } from '#lib/busy.svelte.ts';
	import { AGENCY } from '#lib/state-agencies.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * A TYPED AREA, as Primer draws a record: its rate today and when it was
	 * last confirmed, confirmed again in one action beside the state's own
	 * table; what the state calls it and its code, changed in place
	 * (#lib/Detail); every rate it has had or will have from a day, a new one
	 * typed here; and the sites in it. Removing it, where no site has ever been
	 * in it, is in its menu, asking first.
	 */
	let { data }: PageProps = $props();
	const a = $derived(data.area);
	const name = $derived(stateName(data.state));
	const agency = $derived(AGENCY[data.state]);
	const base = $derived(`/api/settings/tax/${data.state}/areas/${a.id}`);
	const again = () => refreshAll();
	let problem = $state('');

	let confirming = $state(false);
	async function confirm() {
		confirming = true;
		problem = '';
		const r = await fetch(`${base}/confirm`, { method: 'POST' }).catch(() => null);
		confirming = false;
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).detail ?? 'Not confirmed.')
				: 'Not confirmed — no connection.';
			return;
		}
		await refreshAll();
	}

	// A NEW RATE FROM A DAY, the coming quarter's first unless said otherwise,
	// starting from the pieces in force today.
	let typing = $state(false);
	let from = $state('');
	let pieces = $state<PieceDraft[]>([]);
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);
	function startTyping() {
		from = data.next;
		pieces = a.pieces.map((p) => ({
			level: p.level === 'state' ? 'state' : 'local',
			jurisdiction: p.jurisdiction,
			rate_pct: asTyped(p.rate),
			sale_kind_id: p.kind ?? ''
		}));
		errors = {};
		typing = true;
	}
	async function saveRate() {
		const local: Record<string, string> = {};
		const f = parseFrom(from);
		if (!f.ok) local.from = f.why;
		Object.assign(local, parsePieces(pieces, data.state).errors);
		errors = local;
		if (Object.keys(local).length) return;
		saving = true;
		const r = await fetch(`${base}/rates/${from}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pieces })
		}).catch(() => null);
		saving = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			errors = p?.errors ?? { pieces: p?.detail ?? 'Not saved — no connection.' };
			return;
		}
		typing = false;
		await refreshAll();
	}

	// Taking a rate away, or the area, asks first.
	let dropping = $state<string | null>(null);
	let removing = $state(false);
	let working = $state(false);
	async function dropRate() {
		working = true;
		problem = '';
		const r = await fetch(`${base}/rates/${dropping}`, { method: 'DELETE' }).catch(() => null);
		working = false;
		dropping = null;
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).detail ?? 'Not taken away.')
				: 'Not taken away — no connection.';
			return;
		}
		await refreshAll();
	}
	async function remove() {
		working = true;
		problem = '';
		const r = await fetch(base, { method: 'DELETE' }).catch(() => null);
		working = false;
		if (!r?.ok) {
			removing = false;
			problem = r
				? ((await readProblem(r)).detail ?? 'Not removed.')
				: 'Not removed — no connection.';
			return;
		}
		await goto(resolve('/settings/tax/[state]', { state: data.state }));
	}
	const menu = $derived(
		a.placed
			? []
			: [{ label: 'Remove', danger: true, onselect: (): void => void (removing = true) }]
	);
	// What a set's pieces on every kind come to; one for a kind alone is that kind's.
	const total = (ps: { rate: string; kind: string | null }[]) =>
		ps
			.filter((p) => !p.kind)
			.reduce((t, p) => t.add(p.rate), Decimal.from('0'))
			.toString();
	const names = $derived(Object.fromEntries(data.kinds.map((k) => [k.id, k.name])));
	const WHEN = { coming: 'Coming', now: 'In force', was: 'Replaced' } as const;
</script>

<Top
	title={a.name}
	trail={[
		{ href: resolve('/settings'), label: 'Settings' },
		{ href: resolve('/settings/tax'), label: 'Tax' },
		{ href: resolve('/settings/tax/[state]', { state: data.state }), label: name }
	]}
>
	{#snippet actions()}
		{#if menu.length}<ActionMenu label="Actions for {a.name}" items={menu} />{/if}
	{/snippet}
</Top>

<div class="pad">
	{#if problem}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}

	<section class="box" aria-labelledby="rate-h">
		<div class="box-h">
			<h2 class="box-t" id="rate-h">Rate today</h2>
			<button
				type="button"
				class="btn sm"
				onclick={confirm}
				{@attach busy(confirming && 'Confirming')}>Confirm</button
			>
		</div>
		<div class="box-row kv">
			<span class="kv-l">Rate</span>
			<span class="kv-v">
				<span class="num">{pct(a.rate_pct)}</span>
				<span class="kv-s">{levied(a.every)}</span>
			</span>
		</div>
		{#each a.byKind as k (k.kind)}
			<div class="box-row kv">
				<span class="kv-l">On {k.name}</span>
				<span class="kv-v">
					<span class="num">{pct(k.rate)}</span>
					<span class="kv-s">{levied(k.pieces)}</span>
				</span>
			</div>
		{/each}
		<div class="box-row kv">
			<span class="kv-l">Confirmed</span>
			<span class="kv-v">
				<span>{dated(a.confirmed_on)}, by {a.confirmed_by}</span>
				{#if a.stale}
					<span class="im warn"
						><Octicon name="alert" />Not since this quarter began, when rates and boundaries change.</span
					>
				{/if}
				{#if agency}
					<span class="kv-s"
						>Against <Outside href={agency.rates}>{agency.name}’s table</Outside></span
					>
				{/if}
			</span>
		</div>
	</section>

	<section class="box" aria-labelledby="area-h">
		<div class="box-h"><h2 class="box-t" id="area-h">Area</h2></div>
		<Detail
			name="name"
			label="Name"
			value={a.name}
			required
			endpoint={base}
			validate={parseAreaField}
			onsaved={again}
		/>
		<Detail
			name="code"
			label="The state’s code"
			value={a.code ?? ''}
			placeholder="None"
			endpoint={base}
			validate={parseAreaField}
			onsaved={again}
		/>
		<div class="box-row kv">
			<span class="kv-l">Typed</span>
			<span class="kv-v"><span>{dated(a.typed_on)}, by {a.typed_by}</span></span>
		</div>
	</section>

	<section class="box" aria-labelledby="rates-h">
		<div class="box-h">
			<h2 class="box-t" id="rates-h">Rates</h2>
			{#if !typing}
				<button type="button" class="btn sm" onclick={startTyping}>New rate</button>
			{/if}
		</div>
		{#if typing}
			<form
				class="box-row form"
				novalidate
				onsubmit={(e) => {
					e.preventDefault();
					void saveRate();
				}}
			>
				<div class="fc">
					<label class="fc-l" for="r-from">From<span aria-hidden="true"> *</span></label>
					<input
						id="r-from"
						class="ti"
						type="date"
						required
						bind:value={from}
						aria-invalid={errors.from ? 'true' : undefined}
						aria-describedby={errors.from ? 'r-from-e' : 'r-from-c'}
					/>
					{#if errors.from}
						<p class="fc-e" id="r-from-e"><Octicon name="alert" />{errors.from}</p>
					{:else}
						<p class="fc-c" id="r-from-c">
							The day it takes effect: a quarter’s first. A rate from a day it already has replaces
							it.
						</p>
					{/if}
				</div>
				<PiecesField bind:pieces state={data.state} kinds={data.kinds} {errors} id="r-p" />
				<div class="keep">
					<button type="submit" class="btn pri" {@attach busy(saving && 'Saving the rate')}
						>Save rate</button
					>
					<button type="button" class="btn" onclick={() => (typing = false)}>Cancel</button>
				</div>
			</form>
		{/if}
		{#each data.rates as r (r.from)}
			<div class="box-row set">
				<span class="what">
					<span class="n"
						>From {dated(r.from)}
						<span class="lab" class:acc={r.when === 'coming'}>{WHEN[r.when]}</span></span
					>
					<span class="sub"
						>{levied(r.pieces, names)}{r.typed_by ? ` · typed by ${r.typed_by}` : ''}</span
					>
				</span>
				<span class="num">{pct(total(r.pieces))}</span>
				{#if r.removable}
					<button
						type="button"
						class="btn gho sm"
						aria-label="Take away the rate from {dated(r.from)}"
						onclick={() => (dropping = r.from)}><Octicon name="x" /></button
					>
				{/if}
			</div>
		{/each}
	</section>

	<section class="box" aria-labelledby="sites-h">
		<div class="box-h"><h2 class="box-t" id="sites-h">Sites in it</h2></div>
		{#each data.sites as s (s.id)}
			<a
				class="box-row"
				href={resolve('/clients/[id]/sites/[site]/tax', { id: s.client_slug, site: s.slug })}
			>
				<span class="what">
					<span class="n">{s.display}</span>
					<span class="sub">{s.client}</span>
				</span>
			</a>
		{:else}
			<p class="box-row muted">None yet. A site is put in its area from its Tax tab.</p>
		{/each}
	</section>
</div>

<Dialog
	open={dropping !== null}
	title="Take away the rate from {dropping ? dated(dropping) : ''}?"
	go="Take it away"
	going="Taking it away…"
	tone="danger"
	{working}
	ongo={dropRate}
	onclose={() => (dropping = null)}
>
	<p>
		From then the rate before it is in force. A line already billed keeps the rate it was billed at.
	</p>
</Dialog>

<Dialog
	open={removing}
	title="Remove {a.name}?"
	go="Remove it"
	going="Removing…"
	tone="danger"
	{working}
	ongo={remove}
	onclose={() => (removing = false)}
>
	<p>No site has ever been in it. Its history is kept.</p>
</Dialog>

<style>
	.box-row {
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px;
	}
	.fc,
	.form > :global(.pieces) {
		max-width: 440px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
	}
	.set {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-weight: 600;
	}
	.n .lab {
		margin-left: 4px;
		font-weight: 400;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
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
	.im.warn {
		color: var(--fgColor-attention);
	}
</style>
