<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Detail from '#lib/Detail.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { parseClientField } from '#lib/client-fields.ts';
	import { reasonSaid } from '#lib/exemption-fields.ts';
	import { count, dated, names } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * A client's Details, each changed in place (#lib/Detail): their address in
	 * the app, and how long they have to pay and how they usually do. Each save
	 * says the version of the client this screen read, so one somebody saved
	 * since is not written over unseen. Then where they are exempt from tax,
	 * each state's exemption added on a screen of its own and ended or taken
	 * off from its menu, asking first.
	 *
	 * Their own terms, or none to follow the house default, which lives on
	 * Invoicing and is only named here.
	 */
	let { data }: PageProps = $props();
	const c = $derived(data.details);
	const endpoint = $derived(`/api/clients/${c.id}`);
	const again = () => refreshAll();
	const PAYS_BY = [
		{ value: '', label: 'Not recorded' },
		{ value: 'cheque', label: 'Cheque' },
		{ value: 'card', label: 'Card' },
		{ value: 'transfer', label: 'Transfer' },
		{ value: 'cash', label: 'Cash' },
		{ value: 'other', label: 'Something else' }
	];

	type Exemption = (typeof data.exemptions)[number];
	/** What an exemption covers, by the business's names for its kinds. */
	const covers = (x: Exemption) =>
		x.kinds === null
			? 'Every kind of sale'
			: names(x.kinds.map((k) => data.kinds[k] ?? 'a kind no longer there'));
	/** Ending it, or taking it off: asked first, as each reaches its drafts. */
	let asking = $state<{ x: Exemption; end: boolean } | null>(null);
	let working = $state(false);
	let problem = $state('');
	async function change() {
		if (!asking) return;
		const { x, end } = asking;
		working = true;
		problem = '';
		const at = `/api/clients/${c.id}/exemptions/${x.id}`;
		const r = await fetch(end ? `${at}/end` : at, { method: end ? 'POST' : 'DELETE' }).catch(
			() => null
		);
		working = false;
		asking = null;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			problem = r
				? (Object.values(p?.errors ?? {})[0] ?? p?.detail ?? 'Not saved.')
				: 'Not saved — no connection.';
			return;
		}
		await refreshAll();
	}
	const menu = (x: Exemption) => [
		...(x.ended_on
			? []
			: [
					{ label: 'End it today', onselect: () => void (asking = { x, end: true }) },
					'divider' as const
				]),
		{
			label: 'Take it off',
			danger: true,
			inactive: x.billed ? 'An invoice that went out was untaxed by it.' : undefined,
			onselect: () => void (asking = { x, end: false })
		}
	];
</script>

<section class="box" aria-labelledby="who-h">
	<div class="box-h"><h2 class="box-t" id="who-h">Who they are</h2></div>
	<Detail
		name="slug"
		label="In the URL"
		value={c.slug}
		required
		{endpoint}
		ifMatch={c.version}
		onconflict={again}
		validate={parseClientField}
		onsaved={(slug) => goto(resolve('/clients/[id]/details', { id: slug }), { replace: true })}
	>
		{#snippet caption()}
			Their screens’ address. A link somebody kept stops working once it changes.
		{/snippet}
	</Detail>
</section>

<section class="box" aria-labelledby="pay-h">
	<div class="box-h"><h2 class="box-t" id="pay-h">How they pay</h2></div>
	<Detail
		name="terms_days"
		label="Terms"
		value={c.terms === null ? '' : String(c.terms)}
		shown={c.terms === null
			? `The house default of ${count(c.default_terms, 'day')}`
			: count(c.terms, 'day')}
		inputmode="numeric"
		{endpoint}
		ifMatch={c.version}
		onconflict={again}
		validate={parseClientField}
		onsaved={again}
	>
		{#snippet caption()}
			Days from the invoice date to when it is due. Empty follows the house default, set on
			<a href={resolve('/settings/invoicing')}>Invoicing</a>.
		{/snippet}
	</Detail>
	<Detail
		name="payment_method"
		label="Pays by"
		value={c.payment_method ?? ''}
		options={PAYS_BY}
		{endpoint}
		ifMatch={c.version}
		onconflict={again}
		validate={parseClientField}
		onsaved={again}
	>
		{#snippet caption()}How they usually settle, not how any one invoice was paid.{/snippet}
	</Detail>
</section>

<!-- Where this client is exempt is each state's. What it is taxed at is each site's. -->
<section class="box" aria-labelledby="tax-h">
	<div class="box-h">
		<h2 class="box-t" id="tax-h">Sales tax</h2>
		{#if data.collects.length}
			<a class="btn sm" href={resolve('/clients/[id]/exemptions/new', { id: c.slug })}
				>Add exemption</a
			>
		{/if}
	</div>
	{#if problem}<p class="box-row im crit" role="alert"><Octicon name="alert" />{problem}</p>{/if}
	{#each data.exemptions as x (x.id)}
		<div class="box-row exemption">
			<span class="what">
				<span class="n">{stateName(x.state)} · {reasonSaid(x.reason)}</span>
				<span class="sub"
					>{[x.explanation, x.supported_by, covers(x)].filter(Boolean).join(' · ')}</span
				>
				{#if x.ended_on}<span class="sub">Ended {dated(x.ended_on)}</span>{/if}
			</span>
			{#if !x.ended_on || !x.billed}
				<ActionMenu label="Actions for the {stateName(x.state)} exemption" items={menu(x)} />
			{/if}
		</div>
	{:else}
		<p class="box-row none">
			{data.collects.length
				? 'Exempt nowhere: taxed as usual wherever the business collects.'
				: 'The business collects tax nowhere, so there is nothing to be exempt from.'}
		</p>
	{/each}
</section>
<p class="note">
	An exemption is claimed in a state, as its certificate gives it. A line it covers is not taxed,
	and keeps which exemption it was; one purchase under a certificate is that line’s tax set by hand.
</p>

<Dialog
	open={asking !== null}
	title={asking?.end ? 'End the exemption today?' : 'Take the exemption off?'}
	go={asking?.end ? 'End it' : 'Take it off'}
	going={asking?.end ? 'Ending it' : 'Taking it off'}
	tone={asking?.end ? 'plain' : 'danger'}
	{working}
	ongo={change}
	onclose={() => (asking = null)}
>
	{#if asking}
		<p>
			{asking.end
				? `From today, what it covers in ${stateName(asking.x.state)} is taxed as its kind is.`
				: `Recorded by mistake, it goes, as if it never was.`}
			Lines on drafts there that it untaxed are taxed again; what has gone out keeps what it was billed.
		</p>
	{/if}
</Dialog>

<style>
	.exemption {
		display: flex;
		align-items: center;
		gap: 8px 12px;
	}
	.what {
		flex: 1 1 12rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
		overflow-wrap: anywhere;
	}
	.none {
		margin: 0;
		color: var(--fgColor-muted);
	}
	/* Primer's inline message: an icon and a line, in the colour of what happened. */
	.im {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
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
