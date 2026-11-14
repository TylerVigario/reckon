<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Detail from '#lib/Detail.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { parseVehicleChange } from '#lib/vehicle-fields.ts';
	import { vehicleWords } from '#lib/pay-words.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { dated, miles } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto, refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	/**
	 * A vehicle, as Primer draws a record: its name, whose it is and who its
	 * miles pay, and what has been driven in it. Its name is changed in place
	 * (#lib/Detail); retiring it, putting it back in use, and removing one
	 * nothing was driven in are in its menu, removing asking first.
	 */
	let { data }: PageProps = $props();
	const v = $derived(data.vehicle);
	const whose = $derived(v.owner ? `${v.owner}'s` : "The business's");
	const pays = $derived(vehicleWords(v.owner, data.terms, { money, unitPrice }));
	const driven = $derived(
		v.trips === 0
			? 'No trips yet'
			: `${v.trips} ${v.trips === 1 ? 'trip' : 'trips'} · ${miles(v.miles)}`
	);
	let problem = $state('');

	async function retire(retired: boolean) {
		problem = '';
		const r = await fetch(`/api/vehicles/${v.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { retired: String(retired) } })
		}).catch(() => null);
		if (!r?.ok) {
			problem = r ? ((await readProblem(r)).detail ?? 'Not saved.') : 'Not saved — no connection.';
			return;
		}
		await refreshAll();
	}

	// Removing one nothing was driven in asks first, as every delete does: it
	// cannot be undone, and adding it again makes another vehicle.
	let removing = $state(false);
	let working = $state(false);
	async function remove() {
		problem = '';
		working = true;
		const r = await fetch(`/api/vehicles/${v.id}`, { method: 'DELETE' }).catch(() => null);
		working = false;
		if (!r?.ok) {
			removing = false;
			problem = r
				? ((await readProblem(r)).detail ?? 'Not removed.')
				: 'Not removed — no connection.';
			return;
		}
		await goto(resolve('/settings/vehicles'));
	}
	const menu = $derived([
		v.retired_on
			? { label: 'Back in use', onselect: (): void => void retire(false) }
			: { label: 'Retire', onselect: (): void => void retire(true) },
		...(v.trips === 0
			? [
					'divider' as const,
					{ label: 'Remove', danger: true, onselect: (): void => void (removing = true) }
				]
			: [])
	]);
</script>

<Top
	title={v.name}
	trail={[
		{ href: resolve('/settings'), label: 'Settings' },
		{ href: resolve('/settings/vehicles'), label: 'Vehicles' }
	]}
>
	{#snippet actions()}
		<ActionMenu label="Actions for {v.name}" items={menu} />
	{/snippet}
</Top>

<div class="pad primer">
	{#if v.retired_on}
		<div class="state"><span class="lab">Retired {dated(v.retired_on)}</span></div>
	{/if}

	{#if problem}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}

	<section class="box" aria-labelledby="vehicle-h">
		<div class="box-h"><h2 class="box-t" id="vehicle-h">Vehicle</h2></div>
		<Detail
			name="name"
			label="Name"
			value={v.name}
			required
			endpoint="/api/vehicles/{v.id}"
			validate={parseVehicleChange}
			onsaved={() => refreshAll()}
		/>
		<div class="box-row kv">
			<span class="kv-l">Whose</span>
			<span class="kv-v">
				<span>{whose}</span>
				<span class="kv-s">{pays}</span>
			</span>
		</div>
		<div class="box-row kv">
			<span class="kv-l">Driven</span>
			<span class="kv-v"><span>{driven}</span></span>
		</div>
	</section>

	<p class="note">
		Whose it is never changes. One that changes hands is retired and added again under its new
		owner, so the trips already driven in it still pay who they paid.
	</p>
</div>

<Dialog
	open={removing}
	title="Remove {v.name}?"
	go="Remove it"
	going="Removing…"
	tone="danger"
	{working}
	ongo={remove}
	onclose={() => (removing = false)}
>
	<p>Nothing has been driven in it. It cannot be put back: adding it again makes another.</p>
</Dialog>

<style>
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
</style>
