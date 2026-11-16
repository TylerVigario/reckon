<script lang="ts">
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import { dated, miles } from '#lib/format.ts';
	import type { PageProps } from './$types';

	/**
	 * The vehicles trips are driven in, each opening its own page: whose it is
	 * and the miles driven in it this year, the retired after the rest.
	 */
	let { data }: PageProps = $props();
	const about = (v: { owner: string | null; retired_on: string | null; miles: string }) =>
		[
			v.owner ? `${v.owner}’s` : 'The business’s',
			`${miles(v.miles)} on trips this year`,
			v.retired_on ? `retired ${dated(v.retired_on)}` : null
		]
			.filter(Boolean)
			.join(' · ');
</script>

<Top
	title="Vehicles"
	sub="What trips are driven in, and whose"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<section class="box" aria-labelledby="vehicles-h">
		<div class="box-h">
			<h2 class="box-t" id="vehicles-h">Vehicles</h2>
			<a class="btn sm" href={resolve('/settings/vehicles/new')}>Add vehicle</a>
		</div>
		{#each data.vehicles as v (v.id)}
			<a class="box-row" href={resolve('/settings/vehicles/[id]', { id: v.id })}>
				<span class="what">
					<span class="n">{v.name}</span>
					<span class="sub">{about(v)}</span>
				</span>
				{#if v.retired_on}<span class="lab">Retired</span>{/if}
			</a>
		{:else}
			<p class="box-row muted">
				No vehicles yet. A trip names what it was driven in, and its owner is who its miles pay.
			</p>
		{/each}
	</section>

	<p class="note">
		Travel’s vehicle rule pays a vehicle’s owner, whoever drove it: a person’s at their rule, the
		business’s to nobody. One that changes hands is retired and added again, so trips already driven
		still pay who they paid.
	</p>
</div>

<style>
	.box-row {
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
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
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.lab {
		flex: 0 0 auto;
	}
</style>
