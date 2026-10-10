<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
	import { parseVehicleChange } from '#lib/vehicle-fields.ts';
	import { vehicleWords } from '#lib/pay-words.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { dated, miles } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto, refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
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

	async function remove() {
		problem = '';
		const r = await fetch(`/api/vehicles/${v.id}`, { method: 'DELETE' }).catch(() => null);
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).detail ?? 'Not removed.')
				: 'Not removed — no connection.';
			return;
		}
		await goto(resolve('/settings/travel'));
	}
</script>

<Top
	title={v.name}
	sub={v.retired_on ? `${whose} · retired ${dated(v.retired_on)}` : whose}
	trail={[
		{ href: resolve('/settings'), label: 'Settings' },
		{ href: resolve('/settings/travel'), label: 'Travel' }
	]}
/>

<div class="pad">
	<div class="sec">
		<div class="rows inset">
			<Setting
				name="name"
				key={v.id}
				label="Name"
				value={v.name}
				endpoint="/api/vehicles/{v.id}"
				validate={parseVehicleChange}
				onsaved={() => refreshAll()}
			/>
		</div>
	</div>

	<div class="sec">
		<div class="rows">
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">{whose}</div>
					<div class="rec-s">{pays}</div>
				</div>
			</div>
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">Driven</div>
					<div class="rec-s">{driven}</div>
				</div>
			</div>
		</div>
		<p class="aside">
			Whose it is never changes. One that changes hands is retired and added again under its new
			owner, so the trips already driven in it still pay who they paid.
		</p>
	</div>

	<div class="btnrow">
		{#if v.retired_on}
			<button type="button" class="btn" onclick={() => retire(false)}>Back in use</button>
		{:else}
			<button type="button" class="btn" onclick={() => retire(true)}>Retire it</button>
		{/if}
		{#if v.trips === 0}
			<button type="button" class="btn gho" onclick={remove}>Remove it</button>
		{/if}
	</div>
	{#if problem}<p class="why bad">{problem}</p>{/if}
</div>

<style>
	.aside {
		margin: 8px 0 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.why {
		margin: 0;
	}
	.why.bad {
		color: var(--crit);
	}
</style>
