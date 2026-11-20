<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Detail from '#lib/Detail.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { dated } from '#lib/format.ts';
	import { parseAnswerField, parseKindField } from '#lib/kind-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { stateName } from '#lib/us-states.ts';
	import type { PageProps } from './$types';

	/**
	 * A KIND OF SALE: what the business calls it and whether it is offered for
	 * an item, each changed in place (#lib/Detail); whether each state it
	 * collects in taxes it, saying who gave each answer and when; and the
	 * materials and services that are it. One of the business's own that nothing
	 * is or was sold as can be removed, from its menu, asking first; reckon's
	 * own four stay.
	 */
	let { data }: PageProps = $props();
	const k = $derived(data.kind);
	const endpoint = $derived(`/api/settings/tax/kinds/${data.kind.id}`);
	const again = () => refreshAll();
	const TAXED = [
		{ value: 'true', label: 'Taxed' },
		{ value: 'false', label: 'Not taxed' }
	];
	const OFFERED = [
		{ value: 'true', label: 'Yes' },
		{ value: 'false', label: 'No: retired' }
	];
	/** Who gave an answer, and when: nobody, for one carried over from before kinds of sale. */
	const said = (a: { said_by: string | null; said_on: string | null }) =>
		a.said_by && a.said_on
			? `Said by ${a.said_by}, ${dated(a.said_on)}`
			: 'As reckon taxed it before kinds of sale. Nobody has said yet.';

	let removing = $state(false);
	let working = $state(false);
	let problem = $state('');
	async function remove() {
		working = true;
		problem = '';
		const r = await fetch(endpoint, { method: 'DELETE' }).catch(() => null);
		working = false;
		if (!r?.ok) {
			removing = false;
			problem = r
				? ((await readProblem(r)).detail ?? 'Not removed.')
				: 'Not removed — no connection.';
			return;
		}
		await goto(resolve('/settings/tax'));
	}
	const removable = $derived(k.code === null && !k.sold && k.items.length === 0);
	const menu = $derived(
		removable
			? [{ label: 'Remove', danger: true, onselect: (): void => void (removing = true) }]
			: []
	);
</script>

<Top
	title={k.name}
	trail={[
		{ href: resolve('/settings'), label: 'Settings' },
		{ href: resolve('/settings/tax'), label: 'Tax' }
	]}
>
	{#snippet actions()}
		{#if menu.length}<ActionMenu label="Actions for {k.name}" items={menu} />{/if}
	{/snippet}
</Top>

<div class="pad">
	{#if problem}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}

	<section class="box" aria-labelledby="kind-h">
		<div class="box-h"><h2 class="box-t" id="kind-h">The kind</h2></div>
		<Detail
			name="name"
			label="Name"
			value={k.name}
			required
			hint={k.code ? 'One of reckon’s own: it can be renamed and retired, and stays.' : ''}
			{endpoint}
			validate={parseKindField}
			onsaved={again}
		/>
		<Detail
			name="active"
			label="Offered for an item"
			value={String(k.active)}
			options={OFFERED}
			hint={k.active ? '' : 'Not offered for an item, and it stays on what is this kind already.'}
			{endpoint}
			validate={parseKindField}
			onsaved={again}
		>
			{#snippet caption()}Retired, it stays on what is this kind already.{/snippet}
		</Detail>
	</section>

	<section class="box" aria-labelledby="taxed-h">
		<div class="box-h"><h2 class="box-t" id="taxed-h">Taxed where the business collects</h2></div>
		{#each k.answers as a (a.state)}
			<Detail
				name="taxed"
				label={stateName(a.state)}
				value={String(a.taxed)}
				options={TAXED}
				endpoint={`/api/settings/tax/${a.state}/kinds/${k.id}`}
				hint={said(a)}
				validate={parseAnswerField}
				onsaved={again}
			/>
		{:else}
			<p class="box-row muted">
				The business collects tax nowhere yet. Each state answers for it as it is collected in.
			</p>
		{/each}
	</section>

	<section class="box" aria-labelledby="items-h">
		<div class="box-h"><h2 class="box-t" id="items-h">What is this kind</h2></div>
		{#each k.items as i (i.id)}
			<a
				class="box-row item"
				href={i.is === 'material'
					? resolve('/catalogue/materials/[id]', { id: i.id })
					: resolve('/catalogue/services/[id]', { id: i.id })}
			>
				<span class="n">{i.name}</span>
				<span class="sub">{i.is === 'material' ? 'Material' : 'Service'}</span>
			</a>
		{:else}
			<p class="box-row muted">
				Nothing yet. A material or a service is made this kind on its Details tab.
			</p>
		{/each}
	</section>

	<p class="note">
		A line already on a draft keeps its tax until it is changed, and a sent one the tax it was sent
		with.
	</p>
</div>

<Dialog
	open={removing}
	title="Remove {k.name}?"
	go="Remove it"
	going="Removing…"
	tone="danger"
	{working}
	ongo={remove}
	onclose={() => (removing = false)}
>
	<p>Nothing is, or was, sold as it. Its answers go with it, and its history is kept.</p>
</Dialog>

<style>
	.item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		text-align: left;
		color: inherit;
		text-decoration: none;
	}
	.n {
		font-weight: 600;
	}
	a.item:hover .n {
		color: var(--fgColor-accent);
		text-decoration: underline;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.muted {
		margin: 0;
		color: var(--fgColor-muted);
	}
</style>
